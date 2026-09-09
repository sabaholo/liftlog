// app.js — boot · router · service worker · online/offline · ซิงก์เมื่อกลับมาออนไลน์
// @ts-check
import { openDB } from './db.js';
import * as repo from './repo.js';
import { APP_VERSION } from './util.js';
import { toast, setStatus, qs, clear, h } from './ui_common.js';
import { getSyncConfig, syncAll } from './sync.js';
import { renderToday } from './ui_today.js';
import { renderPlay } from './ui_play.js';
import { renderLibrary } from './ui_library.js';
import { renderHistory } from './ui_history.js';
import { renderSettings } from './ui_settings.js';

export const ctx = {
  db: /** @type {IDBDatabase|null} */ (null),
  version: APP_VERSION,
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  persisted: null,
  settings: { kgStep: 2.5, restDefault: 90, autoRest: false },
  visibleHandlers: new Set(),
  hiddenHandlers: new Set(),
  navigate(hash) { if (location.hash === hash) route(); else location.hash = hash; },
  rerender() { route(); },
  reloadSettings,
  sync: runSync,
};

async function reloadSettings() {
  const db = ctx.db;
  ctx.settings.kgStep = Number(await repo.getSetting(db, 'kg_step', 2.5)) || 2.5;
  ctx.settings.restDefault = Number(await repo.getSetting(db, 'rest_default', 90)) || 90;
  ctx.settings.autoRest = !!(await repo.getSetting(db, 'auto_rest', false));
}

let syncing = false;
async function runSync({ silent = false } = {}) {
  if (syncing || !ctx.db) return null;
  const cfg = await getSyncConfig(ctx.db);
  if (!cfg) { if (!silent) toast('ยังไม่ได้ตั้งค่าซิงก์ (ตั้งค่า → ซิงก์)', { kind: 'err' }); return null; }
  if (!navigator.onLine) { if (!silent) toast('ออฟไลน์ — จะส่งเมื่อกลับมาออนไลน์'); return null; }
  syncing = true;
  try {
    const r = await syncAll(ctx.db);
    const pushed = r.push?.pushed?.length || 0;
    const failed = r.push?.failed?.length || 0;
    const cards = r.cards?.updated || 0;
    const lib = r.library?.updated || 0;
    const parts = [];
    if (pushed) parts.push(`ส่งเซสชัน ${pushed}`);
    if (cards) parts.push(`การ์ดใหม่ ${cards}`);
    if (lib) parts.push(`คลังท่า ${lib}`);
    if (failed) parts.push(`ส่งไม่ผ่าน ${failed}`);
    if (r.errors.length) toast(`ซิงก์มีปัญหา: ${r.errors[0]}`, { kind: 'err', ms: 6000 });
    else if (parts.length) toast(`ซิงก์แล้ว · ${parts.join(' · ')}`, { kind: 'ok' });
    else if (!silent) toast('ซิงก์แล้ว — ไม่มีของใหม่');
    if (cards || lib || pushed) route();
    return r;
  } finally {
    syncing = false;
  }
}

/** #/demo — เปิดเซสชันจากการ์ดตัวอย่างทันที (ไว้ลองหน้าจดโดยไม่ต้องมีการ์ดจริง · ไม่เข้าสถิติ) */
async function renderDemo(c) {
  const active = await repo.activeSession(c.db);
  if (active) { c.navigate(`#/play/${active.id}`); return; }
  let card = (await repo.listCards(c.db)).find((x) => x.demo);
  if (!card) {
    const res = await fetch('./data/demo/demo_card.json');
    card = await res.json();
    card.demo = true;
    await repo.putCard(c.db, card);
  }
  const ses = await repo.startSession(c.db, card);
  c.navigate(`#/play/${ses.id}`);
}

const ROUTES = { today: renderToday, play: renderPlay, library: renderLibrary, history: renderHistory, settings: renderSettings, demo: renderDemo };
let routeSeq = 0;

async function route() {
  const hash = location.hash || '#/today';
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const name = ROUTES[parts[0]] ? parts[0] : 'today';
  const params = parts.slice(1).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  const tab = name === 'play' ? 'today' : name;
  for (const a of document.querySelectorAll('#tabbar a')) a.classList.toggle('active', a.dataset.tab === tab);
  ctx.visibleHandlers.clear();
  ctx.hiddenHandlers.clear();
  const root = qs('#screen');
  const seq = ++routeSeq;
  try {
    await ROUTES[name](ctx, root, params);
  } catch (e) {
    if (seq !== routeSeq) return;
    console.error(e);
    clear(root).append(
      h('div', { class: 'card' },
        h('div', { class: 'title danger-text' }, 'หน้านี้พัง'),
        h('p', { class: 'small muted' }, e instanceof Error ? e.message : String(e)),
        h('button', { class: 'btn md', onclick: () => route() }, 'ลองใหม่'),
        h('button', { class: 'btn md ghost mt', onclick: () => ctx.navigate('#/today') }, 'กลับหน้าวันนี้'),
      ),
    );
  }
  window.scrollTo(0, 0);
}

async function seedDemo() {
  const db = ctx.db;
  if (await repo.getSetting(db, 'seeded', false)) return;
  const cards = await repo.listCards(db);
  if (cards.length === 0) {
    try {
      const res = await fetch('./data/demo/demo_card.json');
      if (res.ok) {
        const card = await res.json();
        card.demo = true;
        await repo.putCard(db, card);
      }
    } catch (e) { console.warn('demo seed skipped', e); }
  }
  await repo.setSetting(db, 'seeded', true);
}

const IS_DEV_HOST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !/[?&]sw=1/.test(location.search);

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (IS_DEV_HOST) {
    // dev server: ไม่ใช้ service worker (แคชทำให้เห็นโค้ดเก่า) — ทดสอบออฟไลน์ของจริงบนโฮสต์ HTTPS
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('liftlog-')).map((k) => caches.delete(k)));
    } catch {}
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('มีเวอร์ชันใหม่ของแอป', { ms: 20000, action: { label: 'อัปเดต', fn: () => nw.postMessage({ type: 'SKIP_WAITING' }) } });
        }
      });
    });
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
  } catch (e) {
    console.warn('service worker', e);
  }
}

async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      ctx.persisted = await navigator.storage.persist();
    }
  } catch { ctx.persisted = null; }
}

async function boot() {
  const root = qs('#screen');
  try {
    ctx.db = await openDB();
  } catch (e) {
    clear(root).append(h('div', { class: 'card' },
      h('div', { class: 'title danger-text' }, 'เปิดฐานข้อมูลไม่ได้'),
      h('p', { class: 'muted' }, e instanceof Error ? e.message : String(e)),
      h('p', { class: 'small dim' }, 'Safari โหมด Private ไม่รองรับ — เปิดแบบปกติ หรือเพิ่มไว้บน Home Screen แล้วเปิดจากไอคอน'),
    ));
    return;
  }
  await reloadSettings();
  await seedDemo();
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => { ctx.online = true; setStatus(null); runSync({ silent: true }); });
  window.addEventListener('offline', () => { ctx.online = false; setStatus('offline'); });
  if (!navigator.onLine) setStatus('offline');
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') for (const fn of ctx.hiddenHandlers) { try { fn(); } catch {} }
    else for (const fn of ctx.visibleHandlers) { try { fn(); } catch {} }
  });
  window.addEventListener('pagehide', () => { for (const fn of ctx.hiddenHandlers) { try { fn(); } catch {} } });
  registerSW();
  requestPersist();
  await route();
  if (navigator.onLine) runSync({ silent: true });
}

boot();
