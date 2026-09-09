// ซิงก์ผ่าน GitHub contents API — fetch จำลอง ไม่แตะเน็ตจริง
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDB, deleteDatabase } from '../js/db.js';
import * as repo from '../js/repo.js';
import { SYNC_KEYS, enqueueSession, listQueue, processQueue, pullCards, pullLibrary, syncAll, testConnection, getSyncConfig } from '../js/sync.js';
import { b64EncodeUtf8, b64DecodeUtf8 } from '../js/util.js';

let n = 0;
async function fresh() {
  const name = `liftlog-sync-${process.pid}-${Date.now()}-${n++}`;
  const db = await openDB({ name });
  return { db, name, close: async () => { db.close(); await deleteDatabase({ name }); } };
}
const CARD = { id: 'card-a', date: '2026-09-09', who: 'rock', title: 'ทดสอบ', blocks: [{ name: 'หลัก', items: [{ name: 'Leg Press', dose: '3×12', sets: 3, weight: true }] }] };

async function configure(db) {
  await repo.setSetting(db, SYNC_KEYS.owner, 'rock');
  await repo.setSetting(db, SYNC_KEYS.repo, 'liftlog-data');
  await repo.setSetting(db, SYNC_KEYS.token, 'github_pat_TEST');
}
function mockFetch(handlers) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = url.replace(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\/?/, '');
    calls.push({ method, path, init });
    const key = `${method} ${path}`;
    const handler = handlers[key] || handlers[`${method} *`];
    if (!handler) return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
    const res = typeof handler === 'function' ? await handler({ url, init, path }) : handler;
    return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.body };
  };
  return { fn, calls };
}

test('ยังไม่ตั้งค่า → รายงานชัด ไม่โยน error', async () => {
  const t = await fresh();
  try {
    assert.equal(await getSyncConfig(t.db), null);
    const r = await processQueue(t.db, { fetchImpl: async () => { throw new Error('ห้ามเรียก'); } });
    assert.equal(r.failed.length, 1);
    const c = await testConnection(t.db);
    assert.equal(c.ok, false);
  } finally { await t.close(); }
});

test('push: ไฟล์ใหม่ (GET 404 → PUT 201) → sha บันทึก คิวว่าง · header/เนื้อหาถูก', async () => {
  const t = await fresh();
  try {
    await configure(t.db);
    const s = await repo.startSession(t.db, CARD);
    await repo.logExercise(t.db, s.id, s.exercises[0].id, { kg: 50, reps: 12, sets: 3 });
    await repo.endSession(t.db, s.id);
    await enqueueSession(t.db, s.id);
    await enqueueSession(t.db, s.id); // ซ้ำ = รายการเดียว
    assert.equal((await listQueue(t.db)).length, 1);
    const m = mockFetch({
      [`GET sessions/${s.id}.json`]: { status: 404, body: { message: 'Not Found' } },
      [`PUT sessions/${s.id}.json`]: ({ init }) => {
        const body = JSON.parse(init.body);
        const decoded = JSON.parse(b64DecodeUtf8(body.content));
        assert.equal(decoded.session.id, s.id);
        assert.equal(decoded.sets.length, 3);
        assert.equal(body.branch, 'main');
        assert.equal(body.sha, undefined);
        assert.equal(init.headers.Authorization, 'Bearer github_pat_TEST');
        return { status: 201, body: { content: { sha: 'sha-1', path: `sessions/${s.id}.json` } } };
      },
    });
    const r = await processQueue(t.db, { fetchImpl: m.fn });
    assert.deepEqual(r.pushed, [s.id]);
    assert.equal(r.failed.length, 0);
    assert.equal((await listQueue(t.db)).length, 0);
    const after = await repo.getSession(t.db, s.id);
    assert.equal(after.sync.sha, 'sha-1');
    assert.ok(await repo.getSetting(t.db, SYNC_KEYS.lastPush));
    // ส่งซ้ำหลังแก้: ใช้ sha เดิม ไม่ต้อง GET
    m.calls.length = 0;
    await enqueueSession(t.db, s.id);
    const m2 = mockFetch({ [`PUT sessions/${s.id}.json`]: ({ init }) => { assert.equal(JSON.parse(init.body).sha, 'sha-1'); return { status: 200, body: { content: { sha: 'sha-2' } } }; } });
    const r2 = await processQueue(t.db, { fetchImpl: m2.fn });
    assert.equal(r2.pushed.length, 1);
    assert.equal(m2.calls.filter((c) => c.method === 'GET').length, 0);
    assert.equal((await repo.getSession(t.db, s.id)).sync.sha, 'sha-2');
  } finally { await t.close(); }
});

test('push ล้มเหลว (401) → คิวยังอยู่ attempts+1 last_error · ไม่ทำเป็นว่าส่งแล้ว', async () => {
  const t = await fresh();
  try {
    await configure(t.db);
    const s = await repo.startSession(t.db, CARD);
    await repo.endSession(t.db, s.id);
    await enqueueSession(t.db, s.id);
    const m = mockFetch({ 'GET *': { status: 401, body: { message: 'Bad credentials' } } });
    const r = await processQueue(t.db, { fetchImpl: m.fn });
    assert.equal(r.pushed.length, 0);
    assert.equal(r.failed.length, 1);
    const q = await listQueue(t.db);
    assert.equal(q.length, 1);
    assert.equal(q[0].attempts, 1);
    assert.match(q[0].last_error, /401/);
    assert.equal((await repo.getSession(t.db, s.id)).sync, null);
    // sha ชน (409) → GET ใหม่แล้ว PUT ซ้ำหนึ่งครั้ง
    const m3 = mockFetch({
      [`GET sessions/${s.id}.json`]: { status: 200, body: { sha: 'remote-sha' } },
      [`PUT sessions/${s.id}.json`]: ({ init }) => (JSON.parse(init.body).sha === 'remote-sha' ? { status: 200, body: { content: { sha: 'ok-sha' } } } : { status: 409, body: { message: 'conflict' } }),
    });
    const r3 = await processQueue(t.db, { fetchImpl: m3.fn });
    assert.equal(r3.pushed.length, 1);
    assert.equal((await repo.getSession(t.db, s.id)).sync.sha, 'ok-sha');
  } finally { await t.close(); }
});

test('pullCards: ดึงเฉพาะที่ sha เปลี่ยน · ไฟล์ที่ไม่ใช่การ์ดถูกข้าม', async () => {
  const t = await fresh();
  try {
    await configure(t.db);
    const card = { ...CARD, id: 'c9', title: 'จาก Life OS' };
    const m = mockFetch({
      'GET cards': { status: 200, body: [{ type: 'file', name: 'c9.json', sha: 's1' }, { type: 'file', name: 'bad.json', sha: 's2' }, { type: 'file', name: 'readme.md', sha: 's3' }] },
      'GET cards/c9.json': { status: 200, body: { sha: 's1', content: b64EncodeUtf8(JSON.stringify(card)).replace(/(.{60})/g, '$1\n') } },
      'GET cards/bad.json': { status: 200, body: { sha: 's2', content: b64EncodeUtf8('{"nope":true}') } },
    });
    const r = await pullCards(t.db, { fetchImpl: m.fn });
    assert.equal(r.updated, 1);
    assert.equal(r.ok, false); // bad.json รายงาน ไม่ทำให้ทั้งรอบล้ม
    assert.match(r.message, /bad\.json/);
    const got = await repo.getCard(t.db, 'c9');
    assert.equal(got.title, 'จาก Life OS');
    assert.equal(got.sync_sha, 's1');
    const m2 = mockFetch({ 'GET cards': { status: 200, body: [{ type: 'file', name: 'c9.json', sha: 's1' }] } });
    const r2 = await pullCards(t.db, { fetchImpl: m2.fn });
    assert.equal(r2.updated, 0);
    assert.equal(m2.calls.length, 1);
    const m3 = mockFetch({});
    const r3 = await pullCards(t.db, { fetchImpl: m3.fn });
    assert.equal(r3.ok, true); assert.match(r3.message, /ยังไม่มีโฟลเดอร์/);
  } finally { await t.close(); }
});

test('pullLibrary: sha เดิมไม่ดึงซ้ำ · รวมกับฟิลด์ผู้ใช้', async () => {
  const t = await fresh();
  try {
    await configure(t.db);
    const lib = { exercises: [{ key: 'Leg Press', name: 'Leg Press', group: 'ขา', knee_load: 'MEDIUM' }] };
    const m = mockFetch({ 'GET library.json': { status: 200, body: { sha: 'L1', content: b64EncodeUtf8(JSON.stringify(lib)) } } });
    const r = await pullLibrary(t.db, { fetchImpl: m.fn });
    assert.equal(r.updated, 1);
    const ex = await repo.getExercise(t.db, 'Leg Press');
    ex.machine_notes = 'เบาะ 3';
    await repo.putExercise(t.db, ex);
    const r2 = await pullLibrary(t.db, { fetchImpl: m.fn });
    assert.equal(r2.updated, 0);
    const lib2 = { exercises: [{ key: 'Leg Press', name: 'Leg Press', group: 'ขา', knee_load: 'LOW' }] };
    const m2 = mockFetch({ 'GET library.json': { status: 200, body: { sha: 'L2', content: b64EncodeUtf8(JSON.stringify(lib2)) } } });
    const r3 = await pullLibrary(t.db, { fetchImpl: m2.fn });
    assert.equal(r3.updated, 1);
    const after = await repo.getExercise(t.db, 'Leg Press');
    assert.equal(after.knee_load, 'LOW');
    assert.equal(after.machine_notes, 'เบาะ 3');
  } finally { await t.close(); }
});

test('syncAll: รวมรายงาน · error ไม่โยนออก', async () => {
  const t = await fresh();
  try {
    await configure(t.db);
    const m = mockFetch({ 'GET *': { status: 403, body: { message: 'forbidden' } } });
    const r = await syncAll(t.db, { fetchImpl: m.fn });
    assert.ok(r.errors.length >= 1);
    assert.ok(r.errors.some((e) => /cards/.test(e)));
    const ok = mockFetch({ 'GET ': { status: 200, body: [] } });
    const c = await testConnection(t.db, { fetchImpl: ok.fn });
    assert.equal(c.ok, true);
  } finally { await t.close(); }
});
