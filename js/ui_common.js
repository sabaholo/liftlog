// ui_common.js — DOM helpers · toast · สถานะบันทึก · modal · numpad · stepper · chips
// @ts-check
import { fmtKg, fmtSeconds, thaiDate } from './util.js';

const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'readOnly', 'indeterminate', 'open']);

/** h('div', {class:'x', onclick: fn}, 'text', child, [children]) */
export function h(tag, attrs = null, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (PROP_KEYS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}
export const qs = (sel, root = document) => root.querySelector(sel);

export function pill(text, kind = '') {
  return h('span', { class: `pill ${kind}`.trim() }, text);
}

export function topBar(title, { back = null, right = null } = {}) {
  return h('div', { class: 'top' },
    back ? h('button', { class: 'back', onclick: back, 'aria-label': 'กลับ' }, '‹') : null,
    h('h1', null, title),
    right,
  );
}

// ---------- toast ----------
export function toast(msg, { kind = '', ms = 3500, action = null } = {}) {
  const root = qs('#toast');
  if (!root) return null;
  let timer = null;
  const el = h('div', { class: `toast ${kind}`.trim() },
    h('div', { class: 'grow' }, msg),
    action ? h('button', { onclick: () => { clearTimeout(timer); el.remove(); action.fn(); } }, action.label) : null,
  );
  root.append(el);
  timer = setTimeout(() => el.remove(), ms);
  return el;
}

// ---------- สถานะบันทึก (ห้ามขึ้น "บันทึกแล้ว" ก่อนเขียนสำเร็จ) ----------
let statusTimer = null;
export function setStatus(kind, text) {
  const el = qs('#status');
  if (!el) return;
  if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
  if (!kind) { el.hidden = true; el.className = 'status'; el.textContent = ''; return; }
  el.hidden = false;
  el.className = `status ${kind}`;
  el.textContent = text || ({ saving: 'กำลังบันทึก…', saved: 'บันทึกแล้ว ✓', error: 'บันทึกไม่สำเร็จ', offline: 'ออฟไลน์' })[kind] || kind;
  if (kind === 'saved') statusTimer = setTimeout(() => setStatus(null), 1500);
}

// ---------- modal (แผ่นเลื่อนจากล่าง มือเดียวถึง) ----------
export function modal({ title = '', body = null, actions = [], onClose = null, sticky = false } = {}) {
  const root = qs('#modal-root');
  const close = () => { back.remove(); if (onClose) onClose(); };
  const sheet = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    title ? h('h3', null, title) : null,
    body,
    actions.length ? h('div', { class: 'actions' }, actions.map((a) => h('button', {
      class: `btn md ${a.kind || ''}`.trim(),
      onclick: async () => { const r = await a.fn?.(); if (r !== false) close(); },
    }, a.label))) : null,
  );
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back && !sticky) close(); } }, sheet);
  root.append(back);
  return { close, el: sheet };
}

export function confirmModal({ title = '', text = '', ok = 'ตกลง', cancel = 'ยกเลิก', danger = false, body = null } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title,
      body: body || (text ? h('p', null, text) : null),
      onClose: () => { if (!done) { done = true; resolve(false); } },
      actions: [
        { label: cancel, kind: 'ghost', fn: () => { done = true; resolve(false); } },
        { label: ok, kind: danger ? 'danger' : 'primary', fn: () => { done = true; resolve(true); } },
      ],
    });
    void m;
  });
}

// ---------- numpad (แทนคีย์บอร์ดระบบ — ปุ่มใหญ่ ไม่เด้ง zoom) ----------
export function numpad({ title = '', value = null, decimals = 1, unit = '', onDone }) {
  let s = value === null || value === undefined ? '' : String(value);
  const disp = h('div', { class: 'numpad disp' });
  const paint = () => { disp.textContent = s === '' ? 'ว่าง' : `${s}${unit ? ' ' + unit : ''}`; disp.className = `disp ${s === '' ? 'empty' : ''}`; };
  const press = (k) => {
    if (k === '⌫') s = s.slice(0, -1);
    else if (k === '.') { if (decimals > 0 && !s.includes('.')) s = (s === '' ? '0' : s) + '.'; }
    else {
      const [, frac = ''] = s.split('.');
      if (s.includes('.') && frac.length >= decimals) return;
      if (s === '0') s = k; else s += k;
      if (s.length > 7) s = s.slice(0, 7);
    }
    paint();
  };
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', decimals > 0 ? '.' : '', '0', '⌫'];
  const grid = h('div', { class: 'numpad' },
    disp,
    keys.map((k) => (k === '' ? h('div') : h('button', { onclick: () => press(k) }, k))),
    h('button', { onclick: () => { s = ''; paint(); } }, 'ล้าง'),
    h('button', { class: 'go', style: { gridColumn: 'span 2' }, onclick: () => { const v = s === '' || s === '.' ? null : Number(s); m.close(); onDone(v); } }, 'ตกลง'),
  );
  paint();
  const m = modal({ title, body: grid });
  return m;
}

// ---------- stepper (−  ค่า  +) ----------
export function stepper({ label, value = null, step = 1, min = 0, max = 999, decimals = 0, unit = '', emptyText = 'แตะใส่', onChange }) {
  let v = value;
  const valEl = h('div', { class: 'val' });
  const paint = () => {
    clear(valEl);
    if (v === null || v === undefined) {
      valEl.className = 'val empty';
      valEl.append(emptyText, h('span', { class: 'lbl' }, label));
    } else {
      valEl.className = 'val';
      valEl.append(decimals > 0 ? fmtKg(v) : String(v), h('span', { class: 'lbl' }, label + (unit ? ` (${unit})` : '')));
    }
  };
  const set = (nv, fire = true) => {
    v = nv === null || nv === undefined ? null : Math.round(Math.min(max, Math.max(min, nv)) * 100) / 100;
    paint();
    if (fire && onChange) onChange(v);
  };
  const bump = (d) => set((v === null ? (d > 0 ? min : min) : v) + d);
  const el = h('div', { class: 'stepper' },
    h('button', { type: 'button', 'aria-label': `ลด ${label}`, onclick: () => bump(-step) }, '−'),
    valEl,
    h('button', { type: 'button', 'aria-label': `เพิ่ม ${label}`, onclick: () => bump(step) }, '+'),
  );
  valEl.addEventListener('click', () => numpad({ title: label, value: v, decimals, unit, onDone: (nv) => set(nv) }));
  paint();
  return { el, set, get: () => v };
}

// ---------- chips (เลือกหนึ่ง) ----------
export function chips({ options, value = null, onChange, small = false, allowNone = true }) {
  let v = value;
  const btns = new Map();
  const paint = () => { for (const [k, b] of btns) b.className = `chip ${small ? 'sm' : ''} ${k === String(v) ? 'on' : ''}`.trim(); };
  const el = h('div', { class: 'chips' }, options.map((o) => {
    const b = h('button', { type: 'button', onclick: () => { v = (allowNone && String(v) === String(o.v)) ? null : o.v; paint(); onChange?.(v); } }, o.label);
    btns.set(String(o.v), b);
    return b;
  }));
  paint();
  return { el, set: (nv) => { v = nv; paint(); }, get: () => v };
}

/** กันแตะซ้ำ: ปุ่มปิดระหว่างรอ promise */
export async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try { return await fn(); }
  finally { btn.disabled = false; }
}

export function field({ label, value = '', type = 'text', placeholder = '', inputmode = null, oninput = null, onchange = null, id = null }) {
  const input = h('input', { type, value, placeholder, inputmode, oninput, onchange, id });
  return { el: h('div', null, label ? h('label', { class: 'f', for: id }, label) : null, input), input };
}

/** ครั้งก่อนเป็นข้อความบรรทัดเดียว */
export function fmtLast(lt, today = new Date()) {
  if (!lt) return null;
  const s = lt.summary;
  const parts = [s.text];
  if (s.rir !== null && s.rir !== undefined) parts.push(`RIR ${s.rir}`);
  return `${parts.join(' · ')} — ${thaiDate(lt.date, today)}`;
}

/** ส่งไฟล์ออกจากแอป: share sheet (iOS) ก่อน → ไม่ได้ค่อยดาวน์โหลด */
export async function saveFile(name, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  try {
    if (navigator.share && typeof File === 'function') {
      const file = new File([blob], name, { type: mime });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return 'shared';
      }
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
  return 'downloaded';
}

export function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error('อ่านไฟล์ไม่ได้'));
    r.readAsText(file);
  });
}

export function pickFiles({ accept = '.json,application/json', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, class: 'sr' });
    input.addEventListener('change', () => { resolve(Array.from(input.files || [])); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export { fmtKg, fmtSeconds, thaiDate };
