// model.js — กติกาข้อมูลล้วน ไม่แตะ DOM/DB (ทดสอบด้วย node:test ได้ตรง ๆ)
// @ts-check
import { newId, localDate, nowIso, fmtKg } from './util.js';

export const WHO = Object.freeze({ ROCK: 'rock', NAN: 'nan', BOTH: 'both' });

/** วิธีนับน้ำหนัก — ต้องคงที่ต่อท่าตลอดประวัติ ถ้าเปลี่ยนให้เริ่มชุดเปรียบเทียบใหม่ */
export const LOAD_CONVENTIONS = Object.freeze({
  total: 'น้ำหนักรวมที่ยก (เครื่อง · เคเบิล · บาร์รวมเพลท)',
  per_hand: 'ดัมเบล — กก. ต่อข้าง',
  per_side_plate: 'บาร์ — เพลทต่อข้าง (บาร์เปล่า 20 กก.)',
  bodyweight: 'น้ำหนักตัว / ไม่มีโหลดนอก',
  assisted: 'เครื่องช่วยพยุง — กก. ที่ช่วย',
  unknown: 'ยังไม่กำหนด',
});
export const BAR_KG = 20;

const WHO_TOKENS = { Rock: 'rock', 'แนน': 'nan', 'ร่วม': 'both' };
const PLACE_TOKENS = { '🏠': 'home', '🏋️': 'gym', '🏋': 'gym' };

/**
 * ชื่อท่าในการ์ดของ Lee: "Squat — Rock (Smith)" · "Rear Delt Fly — แนน" · "จักรยานเบา — ร่วม" · "Wall Slide — 🏠"
 * → { base:'Squat', who:'rock', variant:'Smith', key:'Squat (Smith)' }
 * key คือกุญแจสถิติข้ามครั้ง — เก็บ variant ไว้เพราะ Smith squat กับ squat เปล่าคนละโหลดจริง
 */
export function parseItemName(raw) {
  const text = String(raw ?? '').trim();
  const parts = text.split(/\s+—\s+/u);
  let base = parts[0].trim();
  let who = null;
  let variant = null;
  const tags = [];
  for (const p0 of parts.slice(1)) {
    const p = p0.trim();
    const m = p.match(/^(Rock|แนน|ร่วม|🏠|🏋️|🏋)\s*(?:\((.+)\))?$/u);
    if (m) {
      if (WHO_TOKENS[m[1]]) who = WHO_TOKENS[m[1]];
      else if (PLACE_TOKENS[m[1]]) tags.push(PLACE_TOKENS[m[1]]);
      if (m[2]) variant = m[2].trim();
    } else {
      base = `${base} — ${p}`;
    }
  }
  const num = base.match(/^([①-⑳])\s*/u);
  if (num) { tags.push('combo'); base = base.slice(num[0].length).trim(); }
  if (/ถ้าเหลือเวลา/u.test(base)) {
    tags.push('optional');
    base = base.replace(/\s*ถ้าเหลือเวลา\s*/u, ' ').replace(/\s+/g, ' ').trim();
  }
  const key = variant ? `${base} (${variant})` : base;
  return { raw: text, base, who, variant, tags, key };
}

/** normalize สำหรับจับคู่ชื่อท่ากับคลัง: ตัด emoji/มาร์กเกอร์ · ตัวเล็ก · ช่องว่างเดียว */
export function normKey(s) {
  return String(s ?? '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\*|‍|️/g, '')
    .replace(/เบนช์มาร์ก/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ข้อความ dose ของ Lee → ตัวเลข: "3×10-12" · "2×12-15/ข้าง" · "3×20-30 วิ" · "10 ครั้ง" · "3 นาที"
 * ไม่พบตัวเลข = null (ไม่ใช่ 0)
 */
export function parseDose(dose) {
  const out = { sets_lo: null, sets_hi: null, reps_lo: null, reps_hi: null, unit: 'reps', per_side: false, raw: dose ?? '' };
  if (!dose) return out;
  const s = String(dose);
  if (/\/\s*(ข้าง|ทิศ)/u.test(s)) out.per_side = true;
  const m = s.match(/(\d+)(?:\s*[-–]\s*(\d+))?\s*[×x]\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*(วินาที|วิ\.?|นาที)?/u);
  if (m) {
    out.sets_lo = +m[1];
    out.sets_hi = m[2] ? +m[2] : +m[1];
    out.reps_lo = +m[3];
    out.reps_hi = m[4] ? +m[4] : +m[3];
    if (m[5]) out.unit = /นาที/u.test(m[5]) ? 'min' : 'sec';
    return out;
  }
  const t = s.match(/(\d+)\s*(วินาที|วิ\.?|นาที)/u);
  if (t) {
    out.reps_lo = out.reps_hi = +t[1];
    out.unit = /นาที/u.test(t[2]) ? 'min' : 'sec';
    out.sets_lo = out.sets_hi = 1;
    return out;
  }
  const r = s.match(/(\d+)(?:\s*[-–]\s*(\d+))?\s*(ครั้ง|รอบ)/u);
  if (r) {
    out.reps_lo = +r[1];
    out.reps_hi = r[2] ? +r[2] : +r[1];
    out.sets_lo = out.sets_hi = 1;
  }
  return out;
}

export function unitLabel(unit) {
  return unit === 'sec' ? 'วิ' : unit === 'min' ? 'นาที' : 'ครั้ง';
}

/** แตกการ์ด Lee (blocks → items) เป็นรายการแบน พร้อมฟิลด์ที่แอปใช้ */
export function cardItems(card) {
  const items = [];
  (card.blocks || []).forEach((b, bi) => {
    (b.items || []).forEach((it, ii) => {
      const p = parseItemName(it.name);
      const d = parseDose(it.dose);
      const sets = Number.isInteger(it.sets) ? it.sets : d.sets_lo;
      items.push({
        id: `${card.id}#${bi}.${ii}`,
        block: b.name || '',
        block_index: bi,
        item_index: ii,
        raw_name: String(it.name ?? ''),
        name: p.base,
        key: p.key,
        who: p.who,
        variant: p.variant,
        tags: p.tags,
        dose: it.dose || '',
        sets_target: sets ?? null,
        reps_lo: d.reps_lo,
        reps_hi: d.reps_hi,
        unit: d.unit,
        per_side: !!(it.per_side || d.per_side),
        weight: !!it.weight,
        rest_sec: Number.isFinite(it.rest_sec) ? it.rest_sec : null,
        timer_sec: Number.isFinite(it.timer_sec) ? it.timer_sec : null,
        cue: it.cue || '',
        alt: it.alt || '',
        equip: it.equip || '',
        warn: it.warn || '',
        knee: it.knee || it.knee_level || '',
      });
    });
  });
  return items;
}

function makeSessionExercise(i, idx) {
  return {
    id: newId('se'),
    order: idx,
    source: 'card',
    card_item_id: i.id,
    block: i.block,
    key: i.key,
    name: i.name,
    who: 'rock',
    tags: i.tags || [],
    weight: i.weight,
    sets_target: i.sets_target,
    reps_lo: i.reps_lo,
    reps_hi: i.reps_hi,
    unit: i.unit || 'reps',
    per_side: !!i.per_side,
    rest_sec: i.rest_sec,
    timer_sec: i.timer_sec,
    dose: i.dose || '',
    cue: i.cue || '',
    alt: i.alt || '',
    equip: i.equip || '',
    warn: i.warn || '',
    knee: i.knee || '',
    status: 'todo',
    draft: null,
    logged_at: null,
    last_entry: null,
    swapped_from: null,
    skip_reason: '',
    note: '',
  };
}

/**
 * เซสชัน = snapshot ของการ์ดขณะเริ่ม (แก้การ์ดทีหลังไม่กระทบประวัติ)
 * รุ่นแรก: ท่าของแนนไม่เข้าเซสชัน (Rock 9/9: "ทำของเราก่อน") → เก็บไว้ที่ hidden ให้ดูอย่างเดียว
 */
export function sessionFromCard(card, { now = new Date(), includeWho = ['rock', 'both', null] } = {}) {
  const items = cardItems(card);
  const mine = items.filter((i) => includeWho.includes(i.who));
  const hidden = items
    .filter((i) => !includeWho.includes(i.who))
    .map((i) => ({ name: i.raw_name, who: i.who, block: i.block, dose: i.dose, cue: i.cue }));
  const exercises = mine.map(makeSessionExercise);
  return {
    id: newId('s'),
    card_id: card.id,
    card: {
      id: card.id,
      title: card.title || card.id,
      date: card.date || null,
      who: card.who || null,
      duration_min: Number.isFinite(card.duration_min) ? card.duration_min : null,
    },
    date: localDate(now),
    started_at: nowIso(now),
    ended_at: null,
    status: 'in_progress',
    who: 'rock',
    focus_index: exercises.length ? 0 : -1,
    exercises,
    hidden,
    rules: Array.isArray(card.rules) ? card.rules.slice() : [],
    stop_now: Array.isArray(card.stop_now) ? card.stop_now.slice() : [],
    cuts: Array.isArray(card.cuts) ? card.cuts.slice() : [],
    timer: null,
    note: '',
    demo: !!card.demo,
    sync: null,
  };
}

export function emptySession({ now = new Date(), title = 'เซสชันว่าง' } = {}) {
  return {
    id: newId('s'),
    card_id: null,
    card: { id: null, title, date: null, who: null, duration_min: null },
    date: localDate(now),
    started_at: nowIso(now),
    ended_at: null,
    status: 'in_progress',
    who: 'rock',
    focus_index: -1,
    exercises: [],
    hidden: [],
    rules: [],
    stop_now: [],
    cuts: [],
    timer: null,
    note: '',
    demo: false,
    sync: null,
  };
}

export function newAddedExercise(spec, order) {
  return {
    id: newId('se'),
    order,
    source: spec.source || 'added',
    card_item_id: null,
    block: spec.block || 'เพิ่มเอง',
    key: spec.key,
    name: spec.name || spec.key,
    who: 'rock',
    tags: [],
    weight: spec.weight === undefined ? true : !!spec.weight,
    sets_target: Number.isInteger(spec.sets_target) ? spec.sets_target : 3,
    reps_lo: spec.reps_lo ?? null,
    reps_hi: spec.reps_hi ?? spec.reps_lo ?? null,
    unit: spec.unit || 'reps',
    per_side: !!spec.per_side,
    rest_sec: spec.rest_sec ?? null,
    timer_sec: null,
    dose: spec.dose || '',
    cue: spec.cue || '',
    alt: spec.alt || '',
    equip: spec.equip || '',
    warn: spec.warn || '',
    knee: spec.knee || '',
    status: 'todo',
    draft: null,
    logged_at: null,
    last_entry: null,
    swapped_from: null,
    skip_reason: '',
    note: '',
  };
}

/** ตรวจค่าที่กรอกก่อนบันทึก — ช่องว่างไม่ใช่ศูนย์ */
export function validateEntry(se, entry) {
  const errors = [];
  const sets = entry?.sets;
  if (!Number.isInteger(sets) || sets < 1 || sets > 20) errors.push('จำนวนเซ็ตต้องเป็น 1–20');
  const kg = entry?.kg ?? null;
  const reps = entry?.reps ?? null;
  if (se.weight && kg === null) errors.push('ยังไม่ได้ใส่น้ำหนัก');
  if (kg !== null && (!Number.isFinite(kg) || kg < 0)) errors.push('น้ำหนักไม่ถูกต้อง');
  if (se.weight && reps === null) errors.push('ยังไม่ได้ใส่จำนวนครั้ง');
  if (reps !== null && (!Number.isFinite(reps) || reps < 0)) errors.push('จำนวนครั้งไม่ถูกต้อง');
  const rir = entry?.rir ?? null;
  if (rir !== null && (!Number.isInteger(rir) || rir < 0 || rir > 10)) errors.push('RIR ต้อง 0–10');
  return { ok: errors.length === 0, errors };
}

/**
 * บรรทัดเดียว "14 kg × 15 × 3" → N เซ็ตที่เหมือนกัน (RIR ติดที่เซ็ตสุดท้าย ตามที่ Lee ขอ)
 * เก็บเป็นรายเซ็ตเพื่อให้ "แยกเซ็ต" แก้ทีละเซ็ตได้ และสถิติ top-set/volume คิดจากของจริง
 */
export function expandEntry(se, entry, { sessionId, now = new Date(), who = 'rock', demo = false }) {
  const v = validateEntry(se, entry);
  if (!v.ok) throw new Error(v.errors.join(' · '));
  const ts = nowIso(now);
  const date = localDate(now);
  const out = [];
  for (let i = 0; i < entry.sets; i++) {
    out.push({
      id: newId('set'),
      session_id: sessionId,
      session_exercise_id: se.id,
      exercise_key: se.key,
      exercise_name: se.name,
      who,
      index: i + 1,
      type: entry.type || 'working',
      status: 'completed',
      kg: entry.kg ?? null,
      reps: entry.reps ?? null,
      rir: i === entry.sets - 1 ? (entry.rir ?? null) : null,
      unit: se.unit || 'reps',
      load_convention: entry.load_convention || (se.weight ? 'total' : 'bodyweight'),
      per_side: !!se.per_side,
      completed_at: ts,
      date,
      note: entry.note || '',
      demo: !!demo,
    });
  }
  return out;
}

/** สรุปเซ็ตที่จบแล้วของท่าหนึ่งในเซสชันหนึ่ง (working sets เท่านั้น) */
export function summarizeSets(sets) {
  const w = (sets || [])
    .filter((s) => s.status === 'completed' && s.type !== 'warmup')
    .sort((a, b) => a.index - b.index);
  if (!w.length) return { text: '—', kg: null, reps: null, sets: 0, uniform: true, rir: null, top_kg: null, first_kg: null, first_reps: null, unit: 'reps' };
  const kg0 = w[0].kg;
  const reps0 = w[0].reps;
  const uniform = w.every((s) => s.kg === kg0 && s.reps === reps0);
  const rir = w[w.length - 1].rir ?? null;
  const unit = w[0].unit || 'reps';
  const ul = unit === 'reps' ? '' : ` ${unitLabel(unit)}`;
  const kgs = w.map((s) => s.kg).filter((k) => k !== null && k !== undefined);
  const top_kg = kgs.length ? Math.max(...kgs) : null;
  let text;
  if (uniform) {
    text = (kg0 !== null && kg0 !== undefined ? `${fmtKg(kg0)} kg × ` : '') + (reps0 !== null && reps0 !== undefined ? `${reps0}${ul} × ` : '') + `${w.length} เซ็ต`;
  } else {
    text = w.map((s) => (s.kg !== null && s.kg !== undefined ? `${fmtKg(s.kg)}×` : '') + (s.reps ?? '—')).join(' · ');
  }
  return { text, kg: uniform ? kg0 : null, reps: uniform ? reps0 : null, sets: w.length, uniform, rir, top_kg, first_kg: kg0 ?? null, first_reps: reps0 ?? null, unit };
}

/** จัดกลุ่มเซ็ตติดกันที่ kg/reps เท่ากัน → แถวแบบ gym_log.csv (kg,reps,sets) */
export function groupForCsv(sets) {
  const w = (sets || [])
    .filter((s) => s.status === 'completed' && s.type !== 'warmup')
    .sort((a, b) => a.index - b.index);
  const rows = [];
  for (const s of w) {
    const last = rows[rows.length - 1];
    if (last && last.kg === (s.kg ?? null) && last.reps === (s.reps ?? null)) {
      last.sets += 1;
      if (s.rir !== null && s.rir !== undefined) last.rir = s.rir;
      if (s.note) last.notes.push(s.note);
    } else {
      rows.push({ kg: s.kg ?? null, reps: s.reps ?? null, sets: 1, rir: s.rir ?? null, notes: s.note ? [s.note] : [], load_convention: s.load_convention || 'total', per_side: !!s.per_side, unit: s.unit || 'reps' });
    }
  }
  return rows;
}

/**
 * เลือกการ์ด: วันนี้ตรงวัน = เสนอ · อนาคต/อดีต = ให้ผู้ใช้เลือกเอง ไม่หยิบให้
 * (บั๊กเดิม 31/8: "ใบล่าสุด = วันที่สูงสุด" เปิดใบของอีกสัปดาห์ · และ 1 วันมีได้ >1 ใบ)
 */
export function pickCards(cards, today) {
  const list = (cards || []).filter(Boolean);
  const dated = list.filter((c) => typeof c.date === 'string' && c.date);
  const desc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  return {
    today: dated.filter((c) => c.date === today),
    past: dated.filter((c) => c.date < today).sort(desc),
    future: dated.filter((c) => c.date > today).sort((a, b) => -desc(a, b)),
    undated: list.filter((c) => !c.date),
  };
}

/** ค่าเริ่มต้นของช่องจด: ครั้งก่อนมาก่อน → เป้าการ์ด → ค่าว่าง */
export function defaultEntry(se, last) {
  const l = last && last.summary ? last.summary : null;
  let kg = null;
  if (se.weight) kg = l ? (l.kg ?? l.first_kg ?? null) : null;
  let reps = l ? (l.reps ?? l.first_reps ?? null) : null;
  if (reps === null) reps = se.reps_lo ?? null;
  let sets = l && l.sets ? l.sets : (se.sets_target ?? 3);
  return { kg, reps, sets, rir: null, type: 'working' };
}

/** จับคู่ชื่อท่ากับคลัง — ตรงเป๊ะก่อน แล้วค่อย contains (สั้นสุดชนะ) */
export function matchLibrary(key, exercises) {
  const k = normKey(key);
  if (!k) return null;
  const list = exercises || [];
  const exact = list.find((e) => normKey(e.key) === k || normKey(e.name) === k);
  if (exact) return exact;
  const kBare = k.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const exactBare = list.find((e) => normKey(e.name) === kBare);
  if (exactBare) return exactBare;
  const cands = list.filter((e) => {
    const n = normKey(e.name);
    return n && (n.includes(kBare) || kBare.includes(n));
  });
  if (!cands.length) return null;
  cands.sort((a, b) => normKey(a.name).length - normKey(b.name).length);
  return cands[0];
}

/** ท่าถัดไปที่ยังไม่ทำ หลัง index ที่ให้ → ไม่มีก็วนหาตัวแรกที่ยังค้าง → -1 = จบครบ */
export function nextFocus(exercises, fromIndex) {
  const n = exercises.length;
  for (let i = fromIndex + 1; i < n; i++) if (exercises[i].status === 'todo') return i;
  for (let i = 0; i < n; i++) if (exercises[i].status === 'todo') return i;
  return -1;
}

export function progressOf(session) {
  const ex = session.exercises || [];
  const done = ex.filter((e) => e.status === 'done').length;
  const skipped = ex.filter((e) => e.status === 'skipped').length;
  return { done, skipped, total: ex.length, remaining: ex.length - done - skipped };
}

/** ค่าเพิ่มน้ำหนักขั้นละเท่าไร — ค่าเริ่มต้น 2.5 (เพลทที่ยิมมียังไม่เช็ค) */
export const DEFAULT_KG_STEP = 2.5;
