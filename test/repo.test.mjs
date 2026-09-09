// ชั้นข้อมูลจริงบน IndexedDB (fake-indexeddb) — เขียนแล้วปิด/เปิดใหม่ ค่าต้องครบ
import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDB, deleteDatabase } from '../js/db.js';
import * as repo from '../js/repo.js';

let n = 0;
async function fresh() {
  const name = `liftlog-test-${process.pid}-${Date.now()}-${n++}`;
  const db = await openDB({ name });
  return { db, name, close: async () => { db.close(); await deleteDatabase({ name }); } };
}
const CARD = {
  id: 'card-a', date: '2026-09-09', who: 'rock+nan', title: 'ทดสอบ', duration_min: 30,
  blocks: [{ name: 'หลัก', items: [
    { name: 'Lat Pulldown — Rock', dose: '3×10-12', sets: 3, rest_sec: 90, weight: true, alt: 'Sling Row' },
    { name: 'Seated Cable Row — Rock', dose: '3×10-12', sets: 3, weight: true },
    { name: 'Rear Delt Fly — แนน', dose: '2×12-15', sets: 2, weight: true },
    { name: 'Chin Tuck ค้าง', dose: '3×20-30 วิ', sets: 3 },
  ] }],
};

test('startSession: จากการ์ด → 3 ท่าของ Rock · แนน 1 ท่าใน hidden · activeSession เจอ', async () => {
  const t = await fresh();
  try {
    const s = await repo.startSession(t.db, CARD);
    assert.equal(s.exercises.length, 3);
    assert.equal(s.hidden.length, 1);
    const a = await repo.activeSession(t.db);
    assert.equal(a.id, s.id);
    assert.equal((await repo.listSessions(t.db, { status: 'in_progress' })).length, 1);
  } finally { await t.close(); }
});

test('logExercise: 3 เซ็ตเขียนจริง · สถานะ done · focus เลื่อน · เขียนซ้ำไม่ได้', async () => {
  const t = await fresh();
  try {
    const s = await repo.startSession(t.db, CARD);
    const se = s.exercises[0];
    const r = await repo.logExercise(t.db, s.id, se.id, { kg: 30, reps: 12, sets: 3, rir: 2 });
    assert.equal(r.sets.length, 3);
    assert.equal(r.session.exercises[0].status, 'done');
    assert.equal(r.session.focus_index, 1);
    assert.deepEqual(r.session.exercises[0].last_entry, { kg: 30, reps: 12, sets: 3, rir: 2 });
    const sets = await repo.getSessionSets(t.db, s.id);
    assert.equal(sets.length, 3);
    assert.equal(sets[2].rir, 2);
    await assert.rejects(() => repo.logExercise(t.db, s.id, se.id, { kg: 30, reps: 12, sets: 3 }), /บันทึกไปแล้ว/);
  } finally { await t.close(); }
});

test('ปิดแล้วเปิดใหม่: draft และเซ็ตยังอยู่ครบ (จำลองล็อกจอ/ปิดแอป)', async () => {
  const t = await fresh();
  const s = await repo.startSession(t.db, CARD);
  await repo.saveDraft(t.db, s.id, s.exercises[1].id, { kg: 35, reps: 11, sets: 3, rir: null });
  await repo.logExercise(t.db, s.id, s.exercises[0].id, { kg: 30, reps: 12, sets: 3 });
  t.db.close();
  const db2 = await openDB({ name: t.name });
  try {
    const again = await repo.getSession(db2, s.id);
    assert.deepEqual(again.exercises[1].draft, { kg: 35, reps: 11, sets: 3, rir: null });
    assert.equal(again.exercises[0].status, 'done');
    assert.equal((await repo.getSessionSets(db2, s.id)).length, 3);
    assert.equal((await repo.activeSession(db2)).id, s.id);
  } finally { db2.close(); await deleteDatabase({ name: t.name }); }
});

test('lastTime: มาจากเซสชันอื่นที่จบแล้ว · ไม่รวมเซสชันปัจจุบัน · ไม่รวม demo', async () => {
  const t = await fresh();
  try {
    const a = await repo.startSession(t.db, CARD, new Date(2026, 8, 2, 19));
    await repo.logExercise(t.db, a.id, a.exercises[0].id, { kg: 30, reps: 12, sets: 3, rir: 2 }, new Date(2026, 8, 2, 19, 10));
    await repo.endSession(t.db, a.id, {}, new Date(2026, 8, 2, 20));
    const b = await repo.startSession(t.db, CARD, new Date(2026, 8, 9, 19));
    const lt = await repo.lastTime(t.db, 'Lat Pulldown', { excludeSessionId: b.id });
    assert.ok(lt);
    assert.equal(lt.session_id, a.id);
    assert.equal(lt.date, '2026-09-02');
    assert.equal(lt.summary.text, '30 kg × 12 × 3 เซ็ต');
    assert.equal(lt.summary.rir, 2);
    await repo.logExercise(t.db, b.id, b.exercises[0].id, { kg: 32.5, reps: 10, sets: 3 });
    const stillA = await repo.lastTime(t.db, 'Lat Pulldown', { excludeSessionId: b.id });
    assert.equal(stillA.session_id, a.id);
    const newest = await repo.lastTime(t.db, 'Lat Pulldown');
    assert.equal(newest.session_id, b.id);
    assert.equal(await repo.lastTime(t.db, 'ไม่มีท่านี้'), null);
    const d = await repo.startSession(t.db, { ...CARD, id: 'demo', demo: true });
    await repo.logExercise(t.db, d.id, d.exercises[1].id, { kg: 99, reps: 9, sets: 1 });
    assert.equal(await repo.lastTime(t.db, 'Seated Cable Row'), null);
    const map = await repo.lastTimeMap(t.db, ['Lat Pulldown', 'Seated Cable Row']);
    assert.equal(map.get('Lat Pulldown').session_id, b.id);
    assert.equal(map.get('Seated Cable Row'), null);
    const hist = await repo.exerciseHistory(t.db, 'Lat Pulldown');
    assert.deepEqual(hist.map((g) => g.session_id), [b.id, a.id]);
  } finally { await t.close(); }
});

test('undoLog / skip / unskip / swap / add / moveToEnd / remove', async () => {
  const t = await fresh();
  try {
    const s = await repo.startSession(t.db, CARD);
    const [e0, e1, e2] = s.exercises;
    await repo.logExercise(t.db, s.id, e0.id, { kg: 30, reps: 12, sets: 3 });
    let r = await repo.undoLog(t.db, s.id, e0.id);
    assert.equal(r.removed, 3);
    assert.equal(r.session.exercises[0].status, 'todo');
    assert.equal(r.session.focus_index, 0);
    assert.equal((await repo.getSessionSets(t.db, s.id)).length, 0);

    r = await repo.skipExercise(t.db, s.id, e0.id, 'เครื่องไม่ว่าง');
    assert.equal(r.session.exercises[0].status, 'skipped');
    assert.equal(r.session.focus_index, 1);
    r = await repo.unskipExercise(t.db, s.id, e0.id);
    assert.equal(r.session.exercises[0].status, 'todo');

    r = await repo.swapExercise(t.db, s.id, e1.id, { key: 'Machine Row', name: 'Machine Row' });
    assert.equal(r.session.exercises[1].key, 'Machine Row');
    assert.deepEqual(r.session.exercises[1].swapped_from, { key: 'Seated Cable Row', name: 'Seated Cable Row' });
    await assert.rejects(() => repo.swapExercise(t.db, s.id, e1.id, {}), /ชื่อท่าใหม่/);

    r = await repo.addExercise(t.db, s.id, { key: 'Face Pull', name: 'Face Pull', weight: true, sets_target: 2, reps_lo: 15 });
    assert.equal(r.session.exercises.length, 4);
    assert.equal(r.exercise.source, 'added');
    assert.equal(r.session.exercises[3].order, 3);

    r = await repo.moveToEnd(t.db, s.id, e0.id);
    assert.deepEqual(r.session.exercises.map((e) => e.key), ['Machine Row', 'Chin Tuck ค้าง', 'Face Pull', 'Lat Pulldown']);
    assert.deepEqual(r.session.exercises.map((e) => e.order), [0, 1, 2, 3]);

    r = await repo.removeExercise(t.db, s.id, r.exercise?.id || r.session.exercises[2].id);
    assert.equal(r.session.exercises.length, 3);
    await repo.logExercise(t.db, s.id, e2.id, { kg: null, reps: 25, sets: 3 });
    await assert.rejects(() => repo.removeExercise(t.db, s.id, e2.id), /บันทึกแล้ว/);
    await assert.rejects(() => repo.skipExercise(t.db, s.id, e2.id), /บันทึกแล้ว/);
  } finally { await t.close(); }
});

test('endSession discard: เซ็ตไม่เข้าสถิติ · reopen เอากลับ', async () => {
  const t = await fresh();
  try {
    const s = await repo.startSession(t.db, CARD);
    await repo.logExercise(t.db, s.id, s.exercises[0].id, { kg: 30, reps: 12, sets: 3 });
    await repo.endSession(t.db, s.id, { discard: true });
    assert.equal((await repo.getSession(t.db, s.id)).status, 'discarded');
    assert.equal(await repo.lastTime(t.db, 'Lat Pulldown'), null);
    assert.equal(await repo.activeSession(t.db), null);
    await repo.reopenSession(t.db, s.id);
    assert.equal((await repo.getSession(t.db, s.id)).status, 'in_progress');
    await repo.endSession(t.db, s.id, { discard: false });
    assert.ok(await repo.lastTime(t.db, 'Lat Pulldown'));
  } finally { await t.close(); }
});

test('updateSets: แก้ย้อนหลัง 3→2 เซ็ตไม่เท่ากัน · ลบทุกแถว = todo', async () => {
  const t = await fresh();
  try {
    const s = await repo.startSession(t.db, CARD);
    const se = s.exercises[0];
    const first = await repo.logExercise(t.db, s.id, se.id, { kg: 30, reps: 12, sets: 3 });
    const ids = first.sets.map((x) => x.id);
    const r = await repo.updateSets(t.db, s.id, se.id, [{ id: ids[0], kg: 30, reps: 12, rir: null }, { id: ids[1], kg: 32.5, reps: 8, rir: 1 }]);
    assert.equal(r.sets.length, 2);
    const sets = await repo.getSessionSets(t.db, s.id);
    assert.equal(sets.length, 2);
    assert.deepEqual(sets.map((x) => x.index), [1, 2]);
    assert.equal(sets[1].kg, 32.5);
    assert.equal(r.session.exercises[0].last_entry.kg, null);
    assert.equal(r.session.exercises[0].last_entry.sets, 2);
    const r2 = await repo.updateSets(t.db, s.id, se.id, [{ kg: 20, reps: 15, rir: null }]);
    assert.equal(r2.sets.length, 1);
    assert.equal((await repo.getSessionSets(t.db, s.id)).length, 1);
    const r3 = await repo.updateSets(t.db, s.id, se.id, []);
    assert.equal(r3.session.exercises[0].status, 'todo');
    assert.equal((await repo.getSessionSets(t.db, s.id)).length, 0);
  } finally { await t.close(); }
});

test('deleteSession ลบเซ็ตด้วย · storeCounts · deleteDemoData', async () => {
  const t = await fresh();
  try {
    const s = await repo.startSession(t.db, CARD);
    await repo.logExercise(t.db, s.id, s.exercises[0].id, { kg: 30, reps: 12, sets: 3 });
    const d = await repo.startSession(t.db, { ...CARD, id: 'demo', demo: true });
    await repo.putCard(t.db, { ...CARD, id: 'demo', demo: true });
    await repo.logExercise(t.db, d.id, d.exercises[0].id, { kg: 1, reps: 1, sets: 2 });
    let c = await repo.storeCounts(t.db);
    assert.equal(c.sessions, 2); assert.equal(c.sets, 5);
    const removed = await repo.deleteDemoData(t.db);
    assert.equal(removed, 4);
    c = await repo.storeCounts(t.db);
    assert.equal(c.sessions, 1); assert.equal(c.sets, 3); assert.equal(c.cards, 0);
    await repo.deleteSession(t.db, s.id);
    c = await repo.storeCounts(t.db);
    assert.equal(c.sessions, 0); assert.equal(c.sets, 0);
  } finally { await t.close(); }
});

test('upsertLibrary: รอบสองไม่ทับของที่ผู้ใช้กรอก', async () => {
  const t = await fresh();
  try {
    await repo.upsertLibrary(t.db, [{ key: 'Lat Pulldown', name: 'Lat Pulldown', group: 'หลัง', knee_load: 'LOW' }]);
    const ex = await repo.getExercise(t.db, 'Lat Pulldown');
    ex.media = [{ url: 'https://example.com/v', label: 'คลิป' }];
    ex.machine_notes = 'เบาะ 4';
    ex.favorite = true;
    ex.load_convention = 'total';
    await repo.putExercise(t.db, ex);
    const n = await repo.upsertLibrary(t.db, [{ key: 'Lat Pulldown', name: 'Lat Pulldown', group: 'หลัง', knee_load: 'LOW', cues: 'ใหม่' }, { key: 'Row', name: 'Row' }]);
    assert.equal(n, 2);
    const after = await repo.getExercise(t.db, 'Lat Pulldown');
    assert.equal(after.cues, 'ใหม่');
    assert.equal(after.machine_notes, 'เบาะ 4');
    assert.equal(after.favorite, true);
    assert.equal(after.media.length, 1);
    assert.equal((await repo.listExercises(t.db)).length, 2);
  } finally { await t.close(); }
});

test('loggedExerciseKeys + settings + body metrics', async () => {
  const t = await fresh();
  try {
    await repo.setSetting(t.db, 'kg_step', 5);
    assert.equal(await repo.getSetting(t.db, 'kg_step'), 5);
    assert.equal(await repo.getSetting(t.db, 'nope', 'dflt'), 'dflt');
    const s = await repo.startSession(t.db, CARD);
    await repo.logExercise(t.db, s.id, s.exercises[0].id, { kg: 30, reps: 12, sets: 3 });
    await repo.logExercise(t.db, s.id, s.exercises[1].id, { kg: 40, reps: 10, sets: 2 });
    const keys = await repo.loggedExerciseKeys(t.db);
    assert.deepEqual(keys.map((k) => k.key).sort(), ['Lat Pulldown', 'Seated Cable Row']);
    assert.equal(keys.find((k) => k.key === 'Lat Pulldown').count, 3);
    await repo.putBodyMetric(t.db, { date: '2026-09-09', weight: 70.5 });
    assert.equal((await repo.listBodyMetrics(t.db))[0].weight, 70.5);
  } finally { await t.close(); }
});
