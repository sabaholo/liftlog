// util.js — helpers ที่ไม่ผูกกับ DOM หรือ DB (ใช้ได้ทั้งใน browser และ node:test)
// @ts-check

export const APP_VERSION = '0.1.0';

/** วันที่แบบ local (ไม่ใช่ UTC) → 'YYYY-MM-DD' */
export function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function nowIso(d = new Date()) {
  return d.toISOString();
}

/** id ที่คงที่ตลอดชีวิตของ record — ห้ามสร้างใหม่ตอน import */
export function newId(prefix = 'id') {
  let r;
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    r = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  } else {
    r = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  }
  return `${prefix}_${r}`;
}

/** แสดงกิโล: 14 → '14', 12.5 → '12.5', null → '—' */
export function fmtKg(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

const TH_DAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** 'YYYY-MM-DD' → 'พ. 9 ก.ย.' (ปีเฉพาะเมื่อไม่ใช่ปีนี้) */
export function thaiDate(ymd, today = new Date()) {
  if (!ymd || typeof ymd !== 'string') return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  const base = `${TH_DAYS[dt.getDay()]} ${d} ${TH_MONTHS[m - 1]}`;
  return y === today.getFullYear() ? base : `${base} ${y}`;
}

/** จำนวนวันระหว่างสองวันที่ (b - a) แบบ local */
export function daysBetween(aYmd, bYmd) {
  const [ay, am, ad] = aYmd.split('-').map(Number);
  const [by, bm, bd] = bYmd.split('-').map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
  wrapped.flush = (...args) => { if (t) { clearTimeout(t); t = null; fn(...args); } };
  return wrapped;
}

export function safeJsonParse(text) {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** base64 ของข้อความ UTF-8 (ใช้กับ GitHub contents API) — ทำงานทั้ง browser และ node */
export function b64EncodeUtf8(str) {
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(bin);
}

export function b64DecodeUtf8(b64) {
  const clean = String(b64).replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') return Buffer.from(clean, 'base64').toString('utf8');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** แปลง 'mm:ss' สำหรับ timer */
export function fmtSeconds(total) {
  const s = Math.max(0, Math.round(total));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** ตัวเลขจากช่องกรอก: '' → null · '12,5' → 12.5 · ค่าที่ไม่ใช่ตัวเลข → null (ไม่ใช่ 0) */
export function parseNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
