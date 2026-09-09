// repo.js — การอ่าน/เขียนข้อมูลทุกอย่างผ่านที่นี่ (UI ห้ามแตะ IndexedDB ตรง)
// ทุก mutation ของเซสชันเขียน sessions+sets ใน transaction เดียว → ไม่มีสถานะครึ่ง ๆ กลาง ๆ
// @ts-check
import { STORES, tx, reqp } from './db.js';
import { nowIso } from './util.js';
import { sessionFromCard, emptySession, expandEntry, nextFocus, summarizeSets, newAddedExercise } from './model.js';

const S = STORES;

// ---------- settings ----------
export async function getSetting(db, key, dflt = null) {
  const row = await tx(db, [S.settings], 'readonly', (s) => reqp(s.settings.get(key)));
  return row ? row.value : dflt;
}
export async function setSetting(db, key, value) {
  await tx(db, [S.settings], 'readwrite', (s) => { s.settings.put({ key, value, updated_at: nowIso() }); });
}
export async function deleteSetting(db, key) {
  await tx(db, [S.settings], 'readwrite', (s) => { s.settings.delete(key); });
}
export async function listSettings(db) {
  return tx(db, [S.settings], 'readonly', (s) => reqp(s.settings.getAll()));
}

// ---------- exercises (คลังท่า) ----------
export async function listExercises(db) {
  return tx(db, [S.exercises], 'readonly', (s) => reqp(s.exercises.getAll()));
}
export async function getExercise(db, key) {
  return tx(db, [S.exercises], 'readonly', (s) => reqp(s.exercises.get(key)));
}
export async function putExercise(db, ex) {
  ex.updated_at = nowIso();
  await tx(db, [S.exercises], 'readwrite', (s) => { s.exercises.put(ex); });
  return ex;
}
export async function deleteExercise(db, key) {
  await tx(db, [S.exercises], 'readwrite', (s) => { s.exercises.delete(key); });
}
/**
 * รับคลังจาก Life OS (library.json) — เก็บฟิลด์ที่ผู้ใช้กรอกเองไว้ (media · โน้ต · วิธีนับน้ำหนัก · favorite)
 * ท่าที่ผู้ใช้สร้างเอง (source:'user') ไม่ถูกทับ
 */
export async function upsertLibrary(db, incoming) {
  let n = 0;
  await tx(db, [S.exercises], 'readwrite', async (s) => {
    for (const inc of incoming) {
      if (!inc || !inc.key) continue;
      const existing = await reqp(s.exercises.get(inc.key));
      const merged = {
        ...inc,
        source: inc.source || 'library',
        media: existing?.media?.length ? existing.media : (inc.media || []),
        user_note: existing?.user_note ?? '',
        machine_notes: existing?.machine_notes ?? '',
        load_convention: existing?.load_convention ?? inc.load_convention ?? null,
        favorite: existing?.favorite ?? false,
        archived: existing?.archived ?? false,
        updated_at: nowIso(),
      };
      s.exercises.put(merged);
      n++;
    }
  });
  return n;
}

// ---------- cards (การ์ดของ Lee) ----------
export async function putCard(db, card) {
  if (!card || !card.id) throw new Error('การ์ดต้องมี id');
  card.imported_at = card.imported_at || nowIso();
  await tx(db, [S.cards], 'readwrite', (s) => { s.cards.put(card); });
  return card;
}
export async function listCards(db) {
  return tx(db, [S.cards], 'readonly', (s) => reqp(s.cards.getAll()));
}
export async function getCard(db, id) {
  return tx(db, [S.cards], 'readonly', (s) => reqp(s.cards.get(id)));
}
export async function deleteCard(db, id) {
  await tx(db, [S.cards], 'readwrite', (s) => { s.cards.delete(id); });
}

// ---------- sessions ----------
export async function putSession(db, ses) {
  ses.updated_at = nowIso();
  await tx(db, [S.sessions], 'readwrite', (s) => { s.sessions.put(ses); });
  return ses;
}
export async function startSession(db, card, now = new Date()) {
  const ses = sessionFromCard(card, { now });
  return putSession(db, ses);
}
export async function startEmptySession(db, now = new Date(), title = 'เซสชันว่าง') {
  return putSession(db, emptySession({ now, title }));
}
export async function getSession(db, id) {
  return tx(db, [S.sessions], 'readonly', (s) => reqp(s.sessions.get(id)));
}
export async function listSessions(db, { status = null } = {}) {
  const all = await tx(db, [S.sessions], 'readonly', (s) => reqp(s.sessions.getAll()));
  const list = status ? all.filter((x) => x.status === status) : all;
  return list.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
}
export async function activeSession(db) {
  const list = await listSessions(db, { status: 'in_progress' });
  return list[0] || null;
}

/** แก้เซสชัน + เซ็ตใน transaction เดียว — fn(ses, stores) คืน extra ที่อยากส่งกลับ */
async function mutate(db, sessionId, fn) {
  return tx(db, [S.sessions, S.sets], 'readwrite', async (s) => {
    const ses = await reqp(s.sessions.get(sessionId));
    if (!ses) throw new Error('ไม่พบเซสชัน');
    const extra = await fn(ses, s);
    ses.updated_at = nowIso();
    s.sessions.put(ses);
    return { session: ses, ...(extra || {}) };
  });
}
function findSe(ses, seId) {
  const idx = ses.exercises.findIndex((e) => e.id === seId);
  if (idx < 0) throw new Error('ไม่พบท่าในเซสชัน');
  return { se: ses.exercises[idx], idx };
}
async function setsOfSe(s, sessionId, seId) {
  const all = await reqp(s.sets.index('by_session').getAll(sessionId));
  return all.filter((x) => x.session_exercise_id === seId).sort((a, b) => a.index - b.index);
}

export async function saveDraft(db, sessionId, seId, draft) {
  return mutate(db, sessionId, (ses) => { const { se } = findSe(ses, seId); se.draft = draft; });
}

/** บันทึกท่าละบรรทัด → N เซ็ต · สถานะ done · เลื่อน focus ไปท่าถัดไป */
export async function logExercise(db, sessionId, seId, entry, now = new Date()) {
  return mutate(db, sessionId, async (ses, s) => {
    const { se, idx } = findSe(ses, seId);
    if (se.status === 'done') throw new Error('ท่านี้บันทึกไปแล้ว — ใช้ "แก้" แทน');
    const sets = expandEntry(se, entry, { sessionId, now, who: ses.who, demo: ses.demo });
    for (const st of sets) s.sets.put(st);
    se.status = 'done';
    se.draft = null;
    se.logged_at = nowIso(now);
    se.last_entry = { kg: entry.kg ?? null, reps: entry.reps ?? null, sets: entry.sets, rir: entry.rir ?? null };
    ses.focus_index = nextFocus(ses.exercises, idx);
    return { sets };
  });
}

/** เลิกทำการบันทึกล่าสุดของท่า — ลบเซ็ตของท่านั้นทั้งหมด กลับเป็น todo */
export async function undoLog(db, sessionId, seId) {
  return mutate(db, sessionId, async (ses, s) => {
    const { se, idx } = findSe(ses, seId);
    const mine = await setsOfSe(s, sessionId, seId);
    for (const st of mine) s.sets.delete(st.id);
    se.status = 'todo';
    se.logged_at = null;
    ses.focus_index = idx;
    return { removed: mine.length };
  });
}

export async function skipExercise(db, sessionId, seId, reason = '') {
  return mutate(db, sessionId, (ses) => {
    const { se, idx } = findSe(ses, seId);
    if (se.status === 'done') throw new Error('ท่าที่บันทึกแล้วข้ามไม่ได้');
    se.status = 'skipped';
    se.skip_reason = reason || '';
    ses.focus_index = nextFocus(ses.exercises, idx);
  });
}
export async function unskipExercise(db, sessionId, seId) {
  return mutate(db, sessionId, (ses) => {
    const { se, idx } = findSe(ses, seId);
    if (se.status !== 'skipped') return;
    se.status = 'todo';
    se.skip_reason = '';
    if (ses.focus_index === -1) ses.focus_index = idx;
  });
}
export async function setFocus(db, sessionId, index) {
  return mutate(db, sessionId, (ses) => {
    if (index < -1 || index >= ses.exercises.length) throw new Error('index ผิด');
    ses.focus_index = index;
  });
}
/** สลับท่า (เครื่องไม่ว่าง) — เก็บชื่อเดิมไว้ที่ swapped_from การ์ดต้นฉบับไม่ถูกแก้ */
export async function swapExercise(db, sessionId, seId, { key, name, weight } = {}) {
  if (!key) throw new Error('ต้องมีชื่อท่าใหม่');
  return mutate(db, sessionId, (ses) => {
    const { se } = findSe(ses, seId);
    if (se.status === 'done') throw new Error('ท่าที่บันทึกแล้วสลับไม่ได้');
    se.swapped_from = se.swapped_from || { key: se.key, name: se.name };
    se.key = key;
    se.name = name || key;
    if (weight !== undefined && weight !== null) se.weight = !!weight;
    se.draft = null;
    se.last_entry = null;
  });
}
export async function addExercise(db, sessionId, spec) {
  if (!spec || !spec.key) throw new Error('ต้องมีชื่อท่า');
  return mutate(db, sessionId, (ses) => {
    const ex = newAddedExercise(spec, ses.exercises.length);
    ses.exercises.push(ex);
    if (ses.focus_index === -1) ses.focus_index = ses.exercises.length - 1;
    return { exercise: ex };
  });
}
/** เลื่อนท่าไปท้ายรายการ (เครื่องไม่ว่าง ไว้ก่อน) */
export async function moveToEnd(db, sessionId, seId) {
  return mutate(db, sessionId, (ses) => {
    const { idx } = findSe(ses, seId);
    const focusId = ses.focus_index >= 0 ? ses.exercises[ses.focus_index]?.id : null;
    const [item] = ses.exercises.splice(idx, 1);
    ses.exercises.push(item);
    ses.exercises.forEach((e, i) => { e.order = i; });
    if (focusId && focusId !== seId) ses.focus_index = ses.exercises.findIndex((e) => e.id === focusId);
    else ses.focus_index = nextFocus(ses.exercises, -1);
  });
}
export async function removeExercise(db, sessionId, seId) {
  return mutate(db, sessionId, async (ses, s) => {
    const { se, idx } = findSe(ses, seId);
    if (se.status === 'done') throw new Error('ท่าที่บันทึกแล้วลบไม่ได้ — เลิกทำก่อน');
    ses.exercises.splice(idx, 1);
    ses.exercises.forEach((e, i) => { e.order = i; });
    ses.focus_index = nextFocus(ses.exercises, Math.min(idx, ses.exercises.length) - 1);
  });
}
export async function setTimer(db, sessionId, timer) {
  return mutate(db, sessionId, (ses) => { ses.timer = timer || null; });
}
export async function setExerciseNote(db, sessionId, seId, note) {
  return mutate(db, sessionId, (ses) => { const { se } = findSe(ses, seId); se.note = note || ''; });
}
export async function setSessionNote(db, sessionId, note) {
  return mutate(db, sessionId, (ses) => { ses.note = note || ''; });
}

/** จบเท่าที่เล่นจริง — ทิ้ง (discard) = เซ็ตทุกแถวติดสถานะ discarded ไม่เข้าสถิติ */
export async function endSession(db, sessionId, { discard = false } = {}, now = new Date()) {
  return mutate(db, sessionId, async (ses, s) => {
    ses.status = discard ? 'discarded' : 'completed';
    ses.ended_at = nowIso(now);
    ses.timer = null;
    if (discard) {
      const all = await reqp(s.sets.index('by_session').getAll(sessionId));
      for (const st of all) { st.status = 'discarded'; s.sets.put(st); }
    }
  });
}
export async function reopenSession(db, sessionId) {
  return mutate(db, sessionId, async (ses, s) => {
    if (ses.status === 'discarded') {
      const all = await reqp(s.sets.index('by_session').getAll(sessionId));
      for (const st of all) { if (st.status === 'discarded') { st.status = 'completed'; s.sets.put(st); } }
    }
    ses.status = 'in_progress';
    ses.ended_at = null;
    if (ses.focus_index === -1) ses.focus_index = nextFocus(ses.exercises, -1);
  });
}
export async function deleteSession(db, sessionId) {
  await tx(db, [S.sessions, S.sets], 'readwrite', async (s) => {
    const all = await reqp(s.sets.index('by_session').getAll(sessionId));
    for (const st of all) s.sets.delete(st.id);
    s.sessions.delete(sessionId);
  });
}

// ---------- sets ----------
export async function getSessionSets(db, sessionId) {
  const all = await tx(db, [S.sets], 'readonly', (s) => reqp(s.sets.index('by_session').getAll(sessionId)));
  return all.sort((a, b) => a.index - b.index);
}
/**
 * แก้เซ็ตของท่าย้อนหลัง — rows = [{ id?, kg, reps, rir, type, note }] ตามลำดับใหม่
 * แถวที่มี id เดิม = แก้ · ไม่มี id = เพิ่ม · id เดิมที่ไม่อยู่ใน rows = ลบ · index เรียงใหม่ 1..n
 */
export async function updateSets(db, sessionId, seId, rows, now = new Date()) {
  return mutate(db, sessionId, async (ses, s) => {
    const { se } = findSe(ses, seId);
    const existing = await setsOfSe(s, sessionId, seId);
    const byId = new Map(existing.map((x) => [x.id, x]));
    const keep = new Set();
    const out = [];
    rows.forEach((r, i) => {
      let st = r.id ? byId.get(r.id) : null;
      if (!st) {
        st = expandEntry(se, { kg: r.kg ?? null, reps: r.reps ?? null, sets: 1, rir: null, type: r.type || 'working' }, { sessionId, now, who: ses.who, demo: ses.demo })[0];
        st.session_exercise_id = se.id;
      } else {
        st.kg = r.kg ?? null;
        st.reps = r.reps ?? null;
        st.type = r.type || st.type || 'working';
      }
      st.rir = r.rir ?? null;
      st.note = r.note ?? st.note ?? '';
      st.status = 'completed';
      st.index = i + 1;
      st.exercise_key = se.key;
      st.exercise_name = se.name;
      keep.add(st.id);
      s.sets.put(st);
      out.push(st);
    });
    for (const x of existing) if (!keep.has(x.id)) s.sets.delete(x.id);
    se.status = out.length ? 'done' : 'todo';
    if (out.length) {
      const sum = summarizeSets(out);
      se.last_entry = { kg: sum.kg, reps: sum.reps, sets: sum.sets, rir: sum.rir };
      if (!se.logged_at) se.logged_at = nowIso(now);
    } else {
      se.last_entry = null;
      se.logged_at = null;
    }
    return { sets: out };
  });
}

// ---------- queries ----------
function groupBySession(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.session_id)) map.set(r.session_id, []);
    map.get(r.session_id).push(r);
  }
  const groups = [];
  for (const [session_id, sets] of map) {
    sets.sort((a, b) => a.index - b.index);
    const completed_at = sets.reduce((m, x) => (x.completed_at > m ? x.completed_at : m), '');
    groups.push({ session_id, date: sets[0].date, completed_at, sets, summary: summarizeSets(sets) });
  }
  groups.sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1));
  return groups;
}
function usable(x, excludeSessionId) {
  return x.status === 'completed' && x.type !== 'warmup' && !x.demo && x.session_id !== excludeSessionId;
}
/** ครั้งก่อนของท่านี้ (ท่า+อุปกรณ์เดียวกันผ่าน key) — null = ยังไม่มีข้อมูล */
export async function lastTime(db, key, { excludeSessionId = null } = {}) {
  const rows = await tx(db, [S.sets], 'readonly', (s) => reqp(s.sets.index('by_exercise').getAll(key)));
  const groups = groupBySession(rows.filter((x) => usable(x, excludeSessionId)));
  return groups[0] || null;
}
export async function exerciseHistory(db, key) {
  const rows = await tx(db, [S.sets], 'readonly', (s) => reqp(s.sets.index('by_exercise').getAll(key)));
  return groupBySession(rows.filter((x) => usable(x, null)));
}
export async function lastTimeMap(db, keys, opts = {}) {
  const uniq = [...new Set(keys.filter(Boolean))];
  const results = await Promise.all(uniq.map((k) => lastTime(db, k, opts)));
  const map = new Map();
  uniq.forEach((k, i) => map.set(k, results[i]));
  return map;
}
export async function allSets(db) {
  return tx(db, [S.sets], 'readonly', (s) => reqp(s.sets.getAll()));
}
/** ท่าที่เคยจดทั้งหมด (จาก sets จริง) — ใช้ในหน้าประวัติ/คลัง */
export async function loggedExerciseKeys(db) {
  const rows = await allSets(db);
  const map = new Map();
  for (const r of rows) {
    if (!usable(r, null)) continue;
    const cur = map.get(r.exercise_key);
    if (!cur || r.completed_at > cur.last) map.set(r.exercise_key, { key: r.exercise_key, name: r.exercise_name, last: r.completed_at, count: (cur?.count || 0) + 1 });
    else cur.count++;
  }
  return [...map.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
}

// ---------- body metrics ----------
export async function putBodyMetric(db, row) {
  if (!row || !row.date) throw new Error('ต้องมีวันที่');
  await tx(db, [S.body_metrics], 'readwrite', (s) => { s.body_metrics.put({ ...row, updated_at: nowIso() }); });
}
export async function listBodyMetrics(db) {
  const all = await tx(db, [S.body_metrics], 'readonly', (s) => reqp(s.body_metrics.getAll()));
  return all.sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ---------- maintenance ----------
export async function storeCounts(db) {
  const out = {};
  for (const name of Object.values(S)) {
    out[name] = await tx(db, [name], 'readonly', (s) => reqp(s[name].count()));
  }
  return out;
}
/** ล้างของสาธิตทั้งหมด (การ์ด/เซสชัน/เซ็ตที่ติดป้าย demo) */
export async function deleteDemoData(db) {
  let n = 0;
  await tx(db, [S.cards, S.sessions, S.sets], 'readwrite', async (s) => {
    const cards = await reqp(s.cards.getAll());
    for (const c of cards) if (c.demo) { s.cards.delete(c.id); n++; }
    const sessions = await reqp(s.sessions.getAll());
    for (const x of sessions) if (x.demo) { s.sessions.delete(x.id); n++; }
    const sets = await reqp(s.sets.getAll());
    for (const x of sets) if (x.demo) { s.sets.delete(x.id); n++; }
  });
  return n;
}
