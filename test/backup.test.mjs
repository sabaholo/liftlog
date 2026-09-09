// export/import: กู้ครบ · ตรวจก่อนเขียน · atomic rollback · ซ้ำไม่เพิ่ม · token ไม่ออกไปกับไฟล์
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDB, deleteDatabase } from '../js/db.js';
import * as repo from '../js/repo.js';
import { exportAll, validateBackup, restoreReplace, exportCsv, exportSession } from '../js/backup.js';

let n = 0;
async function fresh() {
  const name = `liftlog-bk-${process.pid}-${Date.now()}-${n++}`;
  const db = await openDB({ name });
  return { db, name, close: async () => { db.close(); await deleteDatabase({ name }); } };
}
const CARD = {
  id: 'card-a', date: '2026-09-09', who: 'rock', title: 'ทดสอบ',
  blocks: [{ name: 'หลัก', items: [
    { name: 'Incline Bench Press (bar)', dose: '3×8', sets: 3, weight: true },
    { name: 'Leg Press', dose: '3×12', sets: 3, weight: true },
  ] }],
};
async function seed(db) {
  await repo.putCard(db, CARD);
  await repo.upsertLibrary(db, [{ key: 'Leg Press', name: 'Leg Press', group: 'ขา' }]);
  await repo.setSetting(db, 'kg_step', 2.5);
  await repo.setSetting(db, 'sync.token', 'SECRET');
  await repo.putBodyMetric(db, { date: '2026-09-01', weight: 70 });
  const s = await repo.startSession(db, CARD, new Date(2026, 8, 9, 19));
  const first = await repo.logExercise(db, s.id, s.exercises[0].id, { kg: 15, reps: 8, sets: 2, rir: 1 }, new Date(2026, 8, 9, 19, 10));
  await repo.updateSets(db, s.id, s.exercises[0].id, [{ id: first.sets[0].id, kg: 15, reps: 8, rir: null }, { id: first.sets[1].id, kg: 15, reps: 6, rir: 1 }]);
  await repo.logExercise(db, s.id, s.exercises[1].id, { kg: 50, reps: 12, sets: 3, rir: 2, note: 'เบาะ 4' }, new Date(2026, 8, 9, 19, 20));
  await repo.endSession(db, s.id, {}, new Date(2026, 8, 9, 20));
  // demo + discarded ไม่ควรออกไปกับ CSV
  const d = await repo.startSession(db, { ...CARD, id: 'demo', demo: true });
  await repo.logExercise(db, d.id, d.exercises[1].id, { kg: 1, reps: 1, sets: 1 });
  await repo.endSession(db, d.id);
  const x = await repo.startSession(db, CARD);
  await repo.logExercise(db, x.id, x.exercises[1].id, { kg: 999, reps: 1, sets: 1 });
  await repo.endSession(db, x.id, { discard: true });
  return s;
}

test('exportAll: ครบทุกตาราง · ไม่มี sync.* · validate ผ่าน', async () => {
  const t = await fresh();
  try {
    await seed(t.db);
    const b = await exportAll(t.db);
    assert.equal(b.app, 'liftlog');
    assert.equal(b.schema_version, 1);
    assert.equal(b.counts.sessions, 3);
    assert.equal(b.counts.sets, 7);
    assert.equal(b.counts.cards, 1);
    assert.equal(b.counts.exercises, 1);
    assert.equal(b.counts.body_metrics, 1);
    assert.ok(!b.stores.settings.some((r) => r.key.startsWith('sync.')));
    assert.ok(b.stores.settings.some((r) => r.key === 'kg_step'));
    const v = validateBackup(b);
    assert.equal(v.ok, true, v.errors.join(' | '));
  } finally { await t.close(); }
});

test('restoreReplace: กู้ลงเครื่องเปล่า → id/จำนวน/ค่าเท่าเดิม · ซ้ำสองรอบ = ชุดเดิม · token ของเครื่องปลายทางไม่หาย', async () => {
  const a = await fresh();
  const b = await fresh();
  try {
    await seed(a.db);
    const backup = await exportAll(a.db);
    await repo.setSetting(b.db, 'sync.token', 'B-SECRET');
    const counts = await restoreReplace(b.db, backup);
    assert.equal(counts.sessions, 3);
    const cA = await repo.storeCounts(a.db);
    const cB = await repo.storeCounts(b.db);
    for (const k of ['sessions', 'sets', 'cards', 'exercises', 'body_metrics']) assert.equal(cB[k], cA[k], k);
    const setsA = (await repo.allSets(a.db)).map((x) => x.id).sort();
    const setsB = (await repo.allSets(b.db)).map((x) => x.id).sort();
    assert.deepEqual(setsB, setsA);
    const sesA = await repo.listSessions(a.db);
    const sesB = await repo.listSessions(b.db);
    assert.deepEqual(sesB, sesA);
    assert.equal(await repo.getSetting(b.db, 'sync.token'), 'B-SECRET');
    assert.equal(await repo.getSetting(b.db, 'kg_step'), 2.5);
    await restoreReplace(b.db, backup);
    const cB2 = await repo.storeCounts(b.db);
    for (const k of ['sessions', 'sets', 'cards', 'exercises', 'body_metrics']) assert.equal(cB2[k], cA[k], `${k} หลังนำเข้าซ้ำ`);
    assert.deepEqual((await repo.allSets(b.db)).map((x) => x.id).sort(), setsA);
    // ครั้งก่อนอ่านได้จากข้อมูลที่กู้มา
    const lt = await repo.lastTime(b.db, 'Leg Press');
    assert.equal(lt.summary.text, '50 kg × 12 × 3 เซ็ต');
  } finally { await a.close(); await b.close(); }
});

test('validateBackup: ไฟล์ผิดรูปแบบ / ID ซ้ำ / อ้างอิงขาด = ไม่รับ และไม่แตะข้อมูลเดิม', async () => {
  const t = await fresh();
  try {
    await seed(t.db);
    const before = await repo.storeCounts(t.db);
    assert.equal(validateBackup(null).ok, false);
    assert.equal(validateBackup({ app: 'other', schema_version: 1, stores: {} }).ok, false);
    assert.equal(validateBackup({ app: 'liftlog', schema_version: 99, stores: {} }).ok, false);
    assert.equal(validateBackup({ app: 'liftlog', schema_version: 1 }).ok, false);
    const good = await exportAll(t.db);
    const dup = JSON.parse(JSON.stringify(good));
    dup.stores.sets.push({ ...dup.stores.sets[0] });
    const vd = validateBackup(dup);
    assert.equal(vd.ok, false);
    assert.ok(vd.errors.some((e) => /ซ้ำ/.test(e)));
    const orphan = JSON.parse(JSON.stringify(good));
    orphan.stores.sets[0].session_id = 'ไม่มี';
    assert.ok(validateBackup(orphan).errors.some((e) => /เซสชันที่ไม่มี/.test(e)));
    const orphan2 = JSON.parse(JSON.stringify(good));
    orphan2.stores.sets[0].session_exercise_id = 'ไม่มี';
    assert.ok(validateBackup(orphan2).errors.some((e) => /ท่าที่ไม่มี/.test(e)));
    const nokey = JSON.parse(JSON.stringify(good));
    delete nokey.stores.sessions[0].id;
    assert.equal(validateBackup(nokey).ok, false);
    await assert.rejects(() => restoreReplace(t.db, dup), /ไม่ผ่านการตรวจ/);
    await assert.rejects(() => restoreReplace(t.db, { app: 'x' }), /ไม่ผ่านการตรวจ/);
    assert.deepEqual(await repo.storeCounts(t.db), before);
  } finally { await t.close(); }
});

test('ล้มกลาง transaction → rollback ทั้งชุด ข้อมูลเดิมอยู่ครบ', async () => {
  const t = await fresh();
  try {
    const s = await seed(t.db);
    const before = await repo.storeCounts(t.db);
    const backup = await exportAll(t.db);
    backup.stores.sessions = backup.stores.sessions.map((x) => ({ ...x, note: 'ของใหม่ที่ไม่ควรเข้า' }));
    await assert.rejects(() => restoreReplace(t.db, backup, { abortAfter: 3 }), /จำลองความล้มเหลว/);
    assert.deepEqual(await repo.storeCounts(t.db), before);
    const ses = await repo.getSession(t.db, s.id);
    assert.equal(ses.note, '');
    assert.equal((await repo.getSessionSets(t.db, s.id)).length, 5);
    assert.equal(await repo.getSetting(t.db, 'sync.token'), 'SECRET');
  } finally { await t.close(); }
});

test('exportCsv: รูปแบบ gym_log.csv · รวมเซ็ตติดกันที่เท่ากัน · ไม่รวม demo/ทิ้ง', async () => {
  const t = await fresh();
  try {
    const s = await seed(t.db);
    const csv = await exportCsv(t.db);
    const lines = csv.trim().split('\n');
    assert.equal(lines[0], 'id,date,who,exercise,kg,reps,sets,note');
    assert.equal(lines.length, 4, csv);
    assert.ok(lines[1].startsWith(`${s.id}-1-1,2026-09-09,rock,Incline Bench Press (bar),15,8,1,`));
    assert.ok(lines[2].startsWith(`${s.id}-1-2,2026-09-09,rock,Incline Bench Press (bar),15,6,1,RIR 1`));
    assert.ok(lines[3].startsWith(`${s.id}-2-1,2026-09-09,rock,Leg Press,50,12,3,RIR 2`));
    assert.ok(lines[3].includes('เบาะ 4'));
    assert.ok(!csv.includes('999'));
    const payload = await exportSession(t.db, s.id);
    assert.equal(payload.kind, 'session');
    assert.equal(payload.sets.length, 5);
    assert.equal(payload.session.id, s.id);
  } finally { await t.close(); }
});
