// กติกาข้อมูลล้วน — ไม่ต้องมี DOM/DB
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseItemName, parseDose, cardItems, sessionFromCard, expandEntry, validateEntry,
  summarizeSets, groupForCsv, pickCards, defaultEntry, matchLibrary, nextFocus, normKey,
} from '../js/model.js';

const CARD = {
  id: 'c1', date: '2026-09-09', who: 'rock+nan', title: 'ไหล่+หลัง', duration_min: 54,
  rules: ['กฎ 1'], stop_now: ['เจ็บแหลม'],
  blocks: [
    { name: 'Warm-up', items: [{ name: 'จักรยานเบา — ร่วม', dose: '3 นาที', timer_sec: 180 }] },
    { name: 'หลัก', items: [
      { name: 'Lat Pulldown — Rock', dose: 'หาเองคืนนี้ (การ์ด .md §5) · 3×10-12', sets: 3, rest_sec: 90, weight: true, cue: 'ดึงด้วยหลัง', alt: 'Sling Row หรือ Single-arm Cable Pulldown' },
      { name: 'Single-arm Row — แนน', dose: '2×12-15/ข้าง', sets: 2, weight: true, per_side: true },
      { name: 'Squat — Rock (Smith)', dose: '3×8-10', sets: 3, weight: true },
      { name: 'Calf Raise ถ้าเหลือเวลา — ร่วม', dose: '2×15' },
      { name: 'Wall Slide — 🏠', dose: '10 ครั้ง' },
      { name: '① Goblet Squat → Overhead Press', dose: '3×10', sets: 3, weight: true },
    ] },
  ],
};

test('parseItemName: ป้ายคน/variant/สถานที่/ตัวเลือก', () => {
  let p = parseItemName('Squat — Rock (Smith)');
  assert.equal(p.base, 'Squat'); assert.equal(p.who, 'rock'); assert.equal(p.variant, 'Smith'); assert.equal(p.key, 'Squat (Smith)');
  p = parseItemName('Rear Delt Fly — แนน');
  assert.equal(p.who, 'nan'); assert.equal(p.key, 'Rear Delt Fly');
  p = parseItemName('จักรยานเบา — ร่วม');
  assert.equal(p.who, 'both');
  p = parseItemName('Wall Slide — 🏠');
  assert.equal(p.who, null); assert.deepEqual(p.tags, ['home']); assert.equal(p.key, 'Wall Slide');
  p = parseItemName('Calf Raise ถ้าเหลือเวลา — ร่วม');
  assert.equal(p.base, 'Calf Raise'); assert.ok(p.tags.includes('optional')); assert.equal(p.who, 'both');
  p = parseItemName('① Goblet Squat → Overhead Press');
  assert.equal(p.base, 'Goblet Squat → Overhead Press'); assert.ok(p.tags.includes('combo'));
  p = parseItemName('Plank');
  assert.equal(p.key, 'Plank'); assert.equal(p.who, null);
  p = parseItemName('Face Pull เคเบิล — 🏋️');
  assert.equal(p.key, 'Face Pull เคเบิล'); assert.ok(p.tags.includes('gym'));
});

test('parseDose: sets×reps · ต่อข้าง · วินาที · นาที · ครั้ง · ช่วง', () => {
  let d = parseDose('3×10-12');
  assert.deepEqual([d.sets_lo, d.sets_hi, d.reps_lo, d.reps_hi, d.unit, d.per_side], [3, 3, 10, 12, 'reps', false]);
  d = parseDose('2×12-15/ข้าง');
  assert.equal(d.per_side, true); assert.equal(d.reps_hi, 15);
  d = parseDose('3×20-30 วิ');
  assert.equal(d.unit, 'sec'); assert.equal(d.reps_lo, 20);
  d = parseDose('3 นาที');
  assert.deepEqual([d.sets_lo, d.reps_lo, d.unit], [1, 3, 'min']);
  d = parseDose('10 ครั้ง');
  assert.deepEqual([d.sets_lo, d.reps_lo], [1, 10]);
  d = parseDose('2-3×12-15');
  assert.deepEqual([d.sets_lo, d.sets_hi, d.reps_lo, d.reps_hi], [2, 3, 12, 15]);
  d = parseDose('หาเองคืนนี้ (การ์ด .md §5) · 3×10-12');
  assert.deepEqual([d.sets_lo, d.reps_lo, d.reps_hi], [3, 10, 12]);
  d = parseDose('');
  assert.equal(d.sets_lo, null); assert.equal(d.reps_lo, null);
  d = parseDose('5 รอบ/ทิศ ลูกเบาสุดที่มี');
  assert.equal(d.per_side, true); assert.equal(d.reps_lo, 5);
  d = parseDose(undefined);
  assert.equal(d.reps_lo, null);
});

test('cardItems: แตก blocks เป็นรายการแบน พร้อม key/who', () => {
  const items = cardItems(CARD);
  assert.equal(items.length, 7);
  assert.equal(items[0].id, 'c1#0.0');
  assert.equal(items[1].key, 'Lat Pulldown'); assert.equal(items[1].who, 'rock'); assert.equal(items[1].sets_target, 3); assert.equal(items[1].reps_lo, 10);
  assert.equal(items[2].who, 'nan'); assert.equal(items[2].per_side, true);
  assert.equal(items[3].key, 'Squat (Smith)');
  assert.equal(items[0].timer_sec, 180); assert.equal(items[0].unit, 'min');
});

test('sessionFromCard: ท่าของแนนไม่เข้าเซสชัน แต่เก็บไว้ที่ hidden · snapshot การ์ด', () => {
  const now = new Date(2026, 8, 9, 19, 0, 0);
  const s = sessionFromCard(CARD, { now });
  assert.equal(s.exercises.length, 6);
  assert.equal(s.hidden.length, 1); assert.equal(s.hidden[0].who, 'nan');
  assert.equal(s.focus_index, 0); assert.equal(s.status, 'in_progress');
  assert.equal(s.date, '2026-09-09'); assert.equal(s.card.title, 'ไหล่+หลัง'); assert.equal(s.card_id, 'c1');
  assert.deepEqual(s.rules, ['กฎ 1']);
  assert.ok(s.exercises.every((e) => e.status === 'todo' && e.id.startsWith('se_')));
  assert.equal(s.exercises[1].cue, 'ดึงด้วยหลัง');
  const ids = new Set(s.exercises.map((e) => e.id));
  assert.equal(ids.size, 6);
});

test('validateEntry: ช่องว่างไม่ใช่ศูนย์', () => {
  const se = { weight: true };
  assert.equal(validateEntry(se, { kg: null, reps: 10, sets: 3 }).ok, false);
  assert.equal(validateEntry(se, { kg: 20, reps: null, sets: 3 }).ok, false);
  assert.equal(validateEntry(se, { kg: 20, reps: 10, sets: 0 }).ok, false);
  assert.equal(validateEntry(se, { kg: 20, reps: 10, sets: 3, rir: 11 }).ok, false);
  assert.equal(validateEntry(se, { kg: 20, reps: 10, sets: 3, rir: 2 }).ok, true);
  assert.equal(validateEntry(se, { kg: 0, reps: 10, sets: 1 }).ok, true);
  assert.equal(validateEntry({ weight: false }, { kg: null, reps: null, sets: 3 }).ok, true);
});

test('expandEntry: บรรทัดเดียว → N เซ็ต · RIR ที่เซ็ตสุดท้าย', () => {
  const se = { id: 'se1', key: 'Lat Pulldown', name: 'Lat Pulldown', weight: true, unit: 'reps', per_side: false };
  const now = new Date(2026, 8, 9, 19, 30);
  const sets = expandEntry(se, { kg: 30, reps: 12, sets: 3, rir: 2 }, { sessionId: 's1', now });
  assert.equal(sets.length, 3);
  assert.deepEqual(sets.map((s) => s.index), [1, 2, 3]);
  assert.deepEqual(sets.map((s) => s.rir), [null, null, 2]);
  assert.ok(sets.every((s) => s.kg === 30 && s.reps === 12 && s.status === 'completed' && s.session_id === 's1' && s.exercise_key === 'Lat Pulldown' && s.date === '2026-09-09'));
  assert.equal(new Set(sets.map((s) => s.id)).size, 3);
  assert.throws(() => expandEntry(se, { kg: null, reps: 12, sets: 3 }, { sessionId: 's1', now }), /น้ำหนัก/);
});

test('summarizeSets: เท่ากันทุกเซ็ต vs ไม่เท่ากัน · ไม่นับ warm-up/skipped', () => {
  const mk = (i, kg, reps, extra = {}) => ({ index: i, kg, reps, status: 'completed', type: 'working', unit: 'reps', ...extra });
  let s = summarizeSets([mk(1, 30, 12), mk(2, 30, 12), mk(3, 30, 12, { rir: 2 })]);
  assert.equal(s.text, '30 kg × 12 × 3 เซ็ต'); assert.equal(s.kg, 30); assert.equal(s.sets, 3); assert.equal(s.rir, 2); assert.equal(s.uniform, true);
  s = summarizeSets([mk(1, 30, 12), mk(2, 30, 10)]);
  assert.equal(s.text, '30×12 · 30×10'); assert.equal(s.kg, null); assert.equal(s.top_kg, 30); assert.equal(s.first_kg, 30); assert.equal(s.first_reps, 12);
  s = summarizeSets([mk(1, 20, 10, { type: 'warmup' }), mk(2, 30, 10), mk(3, 30, 10, { status: 'skipped' })]);
  assert.equal(s.sets, 1); assert.equal(s.kg, 30);
  assert.equal(summarizeSets([]).text, '—');
  s = summarizeSets([mk(1, null, 30, { unit: 'sec' }), mk(2, null, 30, { unit: 'sec' })]);
  assert.equal(s.text, '30 วิ × 2 เซ็ต');
});

test('groupForCsv: เซ็ตติดกันเท่ากันรวมแถว', () => {
  const mk = (i, kg, reps, rir = null) => ({ index: i, kg, reps, rir, status: 'completed', type: 'working', unit: 'reps' });
  const rows = groupForCsv([mk(1, 30, 12), mk(2, 30, 12), mk(3, 30, 10, 1)]);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].kg, rows[0].reps, rows[0].sets], [30, 12, 2]);
  assert.deepEqual([rows[1].kg, rows[1].reps, rows[1].sets, rows[1].rir], [30, 10, 1, 1]);
});

test('pickCards: วันนี้เท่านั้นที่เสนอ · อนาคตไม่หยิบ · วันเดียว 2 ใบ', () => {
  const cards = [
    { id: 'a', date: '2026-09-09' }, { id: 'b', date: '2026-09-09' }, { id: 'c', date: '2026-09-11' }, { id: 'd', date: '2026-09-02' }, { id: 'e', date: '2026-09-07' }, { id: 'f' },
  ];
  const p = pickCards(cards, '2026-09-09');
  assert.deepEqual(p.today.map((c) => c.id), ['a', 'b']);
  assert.deepEqual(p.future.map((c) => c.id), ['c']);
  assert.deepEqual(p.past.map((c) => c.id), ['e', 'd']);
  assert.deepEqual(p.undated.map((c) => c.id), ['f']);
});

test('defaultEntry: ครั้งก่อนมาก่อน → เป้าการ์ด', () => {
  const se = { weight: true, reps_lo: 10, sets_target: 3 };
  assert.deepEqual(defaultEntry(se, null), { kg: null, reps: 10, sets: 3, rir: null, type: 'working' });
  const last = { summary: { kg: 30, reps: 12, sets: 3, first_kg: 30, first_reps: 12 } };
  assert.deepEqual(defaultEntry(se, last), { kg: 30, reps: 12, sets: 3, rir: null, type: 'working' });
  const lastMixed = { summary: { kg: null, reps: null, sets: 2, first_kg: 35, first_reps: 8 } };
  assert.deepEqual(defaultEntry(se, lastMixed), { kg: 35, reps: 8, sets: 2, rir: null, type: 'working' });
  assert.equal(defaultEntry({ weight: false, reps_lo: null, sets_target: null }, null).sets, 3);
});

test('matchLibrary + normKey: ตรงเป๊ะข้าม emoji/มาร์กเกอร์ · ไม่เจอ = null', () => {
  assert.equal(normKey('Lat Pulldown 🏆*เบนช์มาร์ก*'), 'lat pulldown');
  const lib = [{ key: 'Lat Pulldown 🏆', name: 'Lat Pulldown 🏆*เบนช์มาร์ก*' }, { key: 'Seated Cable Row', name: 'Seated Cable Row' }, { key: 'Goblet Squat', name: 'Goblet Squat' }];
  assert.equal(matchLibrary('Lat Pulldown', lib).key, 'Lat Pulldown 🏆');
  assert.equal(matchLibrary('seated cable row', lib).key, 'Seated Cable Row');
  assert.equal(matchLibrary('Hip Thrust', lib), null);
  assert.equal(matchLibrary('', lib), null);
});

test('nextFocus: ถัดไปหลัง index → วนหาตัวแรกที่ค้าง → -1', () => {
  const ex = (...st) => st.map((status) => ({ status }));
  assert.equal(nextFocus(ex('done', 'todo', 'todo'), 0), 1);
  assert.equal(nextFocus(ex('todo', 'done', 'done'), 1), 0);
  assert.equal(nextFocus(ex('done', 'skipped', 'done'), 2), -1);
  assert.equal(nextFocus([], -1), -1);
});
