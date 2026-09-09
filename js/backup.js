// backup.js — export/import: ที่เก็บในเบราว์เซอร์ไม่ใช่สำเนาสำรอง ไฟล์นี้คือสำเนา
// import รุ่นแรก = restore-replace ทั้งชุด · ตรวจก่อนเขียน · atomic · ล้มเหลว = ข้อมูลเดิมอยู่ครบ
// @ts-check
import { STORES, tx, reqp } from './db.js';
import { APP_VERSION, nowIso } from './util.js';
import { groupForCsv, LOAD_CONVENTIONS } from './model.js';

export const SCHEMA_VERSION = 1;
export const BACKUP_STORES = Object.freeze(['exercises', 'cards', 'sessions', 'sets', 'settings', 'body_metrics']);
const KEYPATH = { exercises: 'key', cards: 'id', sessions: 'id', sets: 'id', settings: 'key', body_metrics: 'date' };
/** ค่าที่เป็นความลับของเครื่องนี้ ไม่ออกไปกับไฟล์สำรอง และไม่ถูกลบตอน restore */
const isDeviceSecret = (key) => typeof key === 'string' && key.startsWith('sync.');

export async function exportAll(db) {
  const stores = {};
  await tx(db, BACKUP_STORES, 'readonly', async (s) => {
    for (const name of BACKUP_STORES) {
      const rows = await reqp(s[name].getAll());
      stores[name] = name === 'settings' ? rows.filter((r) => !isDeviceSecret(r.key)) : rows;
    }
  });
  const counts = Object.fromEntries(BACKUP_STORES.map((n) => [n, stores[n].length]));
  return { app: 'liftlog', schema_version: SCHEMA_VERSION, app_version: APP_VERSION, exported_at: nowIso(), counts, stores };
}

/** ตรวจไฟล์ก่อนแตะข้อมูล — ผิดรูปแบบ/ID ซ้ำ/อ้างอิงขาด = ไม่รับ */
export function validateBackup(obj) {
  const errors = [];
  const warnings = [];
  const counts = {};
  const duplicates = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['ไฟล์ไม่ใช่ JSON object ของ Lift Log'], warnings, counts, duplicates };
  }
  if (obj.app !== 'liftlog') errors.push('ไม่ใช่ไฟล์สำรองของ Lift Log (ไม่มี app: "liftlog")');
  if (!Number.isInteger(obj.schema_version)) errors.push('ไม่มี schema_version');
  else if (obj.schema_version > SCHEMA_VERSION) errors.push(`schema_version ${obj.schema_version} ใหม่กว่าที่แอปนี้รู้จัก (${SCHEMA_VERSION}) — อัปเดตแอปก่อน`);
  const stores = obj.stores;
  if (!stores || typeof stores !== 'object' || Array.isArray(stores)) {
    errors.push('ไม่มี stores');
    return { ok: false, errors, warnings, counts, duplicates };
  }
  for (const name of BACKUP_STORES) {
    const arr = stores[name];
    if (arr === undefined) { warnings.push(`ไม่มีตาราง ${name} ในไฟล์ — หลัง restore จะว่าง`); counts[name] = 0; continue; }
    if (!Array.isArray(arr)) { errors.push(`${name} ไม่ใช่ array`); continue; }
    counts[name] = arr.length;
    const kp = KEYPATH[name];
    const seen = new Set();
    for (const row of arr) {
      if (!row || typeof row !== 'object' || row[kp] === undefined || row[kp] === null || row[kp] === '') {
        errors.push(`${name}: มีแถวที่ไม่มี ${kp}`);
        break;
      }
      const k = String(row[kp]);
      if (seen.has(k)) duplicates.push(`${name}/${k}`);
      seen.add(k);
    }
  }
  for (const name of Object.keys(stores)) {
    if (!BACKUP_STORES.includes(name) && name !== 'sync_queue') warnings.push(`ตาราง ${name} ไม่รู้จัก — จะไม่นำเข้า`);
  }
  if (duplicates.length) errors.push(`ID ซ้ำในไฟล์: ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? ' …' : ''}`);
  const sessions = Array.isArray(stores.sessions) ? stores.sessions : [];
  const sets = Array.isArray(stores.sets) ? stores.sets : [];
  const sesIds = new Set(sessions.map((x) => x.id));
  const seIds = new Set();
  for (const x of sessions) for (const e of (x.exercises || [])) seIds.add(e.id);
  let missingSes = 0;
  let missingSe = 0;
  for (const st of sets) {
    if (!sesIds.has(st.session_id)) missingSes++;
    else if (!seIds.has(st.session_exercise_id)) missingSe++;
  }
  if (missingSes) errors.push(`sets ${missingSes} แถว อ้างถึงเซสชันที่ไม่มีในไฟล์`);
  if (missingSe) errors.push(`sets ${missingSe} แถว อ้างถึงท่าที่ไม่มีในเซสชัน`);
  const cardIds = new Set((Array.isArray(stores.cards) ? stores.cards : []).map((c) => c.id));
  const orphanCards = sessions.filter((x) => x.card_id && !cardIds.has(x.card_id)).length;
  if (orphanCards) warnings.push(`${orphanCards} เซสชันอ้างการ์ดที่ไม่มีในไฟล์ — ประวัติยังใช้ได้ (snapshot อยู่ในเซสชัน)`);
  return { ok: errors.length === 0, errors, warnings, counts, duplicates };
}

/**
 * แทนที่ข้อมูลทุกตารางด้วยของในไฟล์ ใน transaction เดียว
 * ล้มเหลวตรงไหน = rollback ทั้งชุด · นำเข้าไฟล์เดียวซ้ำ = ข้อมูลชุดเดิม (ID จากไฟล์ ไม่สร้างใหม่)
 * abortAfter ใช้ในเทสต์เท่านั้น — จำลองล้มกลางทาง
 */
export async function restoreReplace(db, backup, { abortAfter = null } = {}) {
  const v = validateBackup(backup);
  if (!v.ok) throw new Error('ไฟล์ไม่ผ่านการตรวจ: ' + v.errors.join(' · '));
  const secrets = await tx(db, [STORES.settings], 'readonly', async (s) => (await reqp(s.settings.getAll())).filter((r) => isDeviceSecret(r.key)));
  let puts = 0;
  return tx(db, BACKUP_STORES, 'readwrite', (s) => {
    const out = {};
    for (const name of BACKUP_STORES) {
      s[name].clear();
      const arr = backup.stores[name] || [];
      for (const row of arr) {
        if (abortAfter !== null && puts >= abortAfter) throw new Error('จำลองความล้มเหลวกลาง transaction');
        if (name === 'settings' && isDeviceSecret(row.key)) continue;
        s[name].put(row);
        puts++;
      }
      out[name] = arr.length;
    }
    for (const r of secrets) s.settings.put(r);
    return out;
  });
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV รูปแบบเดียวกับ kb/life/gym_log.csv (id,date,who,exercise,kg,reps,sets,note)
 * เฉพาะเซสชันที่จบแล้ว · ไม่รวม demo · เซ็ตติดกันที่ kg/reps เท่ากันรวมเป็นแถวเดียว
 */
export async function exportCsv(db) {
  const { sessions, sets } = await tx(db, [STORES.sessions, STORES.sets], 'readonly', async (s) => ({
    sessions: await reqp(s.sessions.getAll()),
    sets: await reqp(s.sets.getAll()),
  }));
  const bySession = new Map();
  for (const st of sets) {
    if (!bySession.has(st.session_id)) bySession.set(st.session_id, []);
    bySession.get(st.session_id).push(st);
  }
  const lines = ['id,date,who,exercise,kg,reps,sets,note'];
  const done = sessions.filter((x) => x.status === 'completed' && !x.demo).sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
  for (const ses of done) {
    const mine = bySession.get(ses.id) || [];
    for (const se of ses.exercises.filter((e) => e.status === 'done')) {
      const rows = groupForCsv(mine.filter((x) => x.session_exercise_id === se.id));
      rows.forEach((r, gi) => {
        const notes = [];
        if (r.rir !== null && r.rir !== undefined) notes.push(`RIR ${r.rir}`);
        if (r.unit && r.unit !== 'reps') notes.push(`หน่วย ${r.unit === 'sec' ? 'วินาที' : 'นาที'}`);
        if (r.per_side) notes.push('ต่อข้าง');
        if (r.load_convention && r.load_convention !== 'total' && r.load_convention !== 'bodyweight') notes.push(LOAD_CONVENTIONS[r.load_convention] || r.load_convention);
        if (se.swapped_from) notes.push(`สลับจาก ${se.swapped_from.key}`);
        if (se.note) notes.push(se.note);
        for (const n of r.notes) if (!notes.includes(n)) notes.push(n);
        lines.push([`${ses.id}-${se.order + 1}-${gi + 1}`, ses.date, ses.who || 'rock', se.key, r.kg ?? '', r.reps ?? '', r.sets, notes.join(' · ')].map(csvCell).join(','));
      });
    }
  }
  return lines.join('\n') + '\n';
}

/** เซสชันเดียวพร้อมเซ็ต — ใช้ส่งขึ้น GitHub (sync) */
export async function exportSession(db, sessionId) {
  return tx(db, [STORES.sessions, STORES.sets], 'readonly', async (s) => {
    const session = await reqp(s.sessions.get(sessionId));
    if (!session) throw new Error('ไม่พบเซสชัน');
    const sets = (await reqp(s.sets.index('by_session').getAll(sessionId))).sort((a, b) => a.index - b.index);
    return { app: 'liftlog', kind: 'session', schema_version: SCHEMA_VERSION, app_version: APP_VERSION, exported_at: nowIso(), session, sets };
  });
}
