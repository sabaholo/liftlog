// sync.js — ท่อสองทางผ่าน GitHub repo ส่วนตัว (liftlog-data) · เปิดใช้เมื่อกรอก token เท่านั้น
// เขียนคนละทาง ไม่มี merge: มือถือเขียน sessions/* · Life OS เขียน cards/* + library.json
// ห้ามบอกว่า "ส่งแล้ว" ก่อน API ตอบ 200/201
// @ts-check
import { STORES, tx, reqp } from './db.js';
import { getSetting, setSetting, getSession, putSession, putCard, listCards, upsertLibrary } from './repo.js';
import { exportSession } from './backup.js';
import { b64EncodeUtf8, b64DecodeUtf8, nowIso } from './util.js';

export const SYNC_KEYS = Object.freeze({
  owner: 'sync.owner',
  repo: 'sync.repo',
  token: 'sync.token',
  branch: 'sync.branch',
  lastPull: 'sync.last_pull',
  lastPush: 'sync.last_push',
  libSha: 'sync.library_sha',
});

export async function getSyncConfig(db) {
  const [owner, repo, token, branch] = await Promise.all([
    getSetting(db, SYNC_KEYS.owner, ''),
    getSetting(db, SYNC_KEYS.repo, ''),
    getSetting(db, SYNC_KEYS.token, ''),
    getSetting(db, SYNC_KEYS.branch, 'main'),
  ]);
  if (!owner || !repo || !token) return null;
  return { owner: String(owner).trim(), repo: String(repo).trim(), token: String(token).trim(), branch: String(branch || 'main').trim() };
}

async function api(cfg, path, { method = 'GET', body = null, fetchImpl = globalThis.fetch } = {}) {
  const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}`;
  const res = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, ok: res.ok, json };
}

function describe(status, json) {
  const msg = json && json.message ? json.message : '';
  if (status === 401) return 'token ไม่ถูกต้องหรือหมดอายุ (401)';
  if (status === 403) return `ไม่มีสิทธิ์ (403) ${msg}`.trim();
  if (status === 404) return 'ไม่พบ repo หรือ token ไม่มีสิทธิ์อ่าน (404)';
  if (status === 409) return 'ไฟล์เปลี่ยนบน GitHub ระหว่างส่ง (409) — จะลองใหม่';
  if (status === 422) return `GitHub ไม่รับ (422) ${msg}`.trim();
  return `HTTP ${status} ${msg}`.trim();
}

/** ทดสอบ token + repo: อ่านราก repo */
export async function testConnection(db, { fetchImpl } = {}) {
  const cfg = await getSyncConfig(db);
  if (!cfg) return { ok: false, message: 'ยังกรอก owner / repo / token ไม่ครบ' };
  try {
    const r = await api(cfg, '', { fetchImpl });
    if (r.ok) return { ok: true, message: `เชื่อม ${cfg.owner}/${cfg.repo} ได้ · ${Array.isArray(r.json) ? r.json.length : 0} รายการที่ราก` };
    return { ok: false, message: describe(r.status, r.json) };
  } catch (e) {
    return { ok: false, message: `ต่อไม่ได้: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---------- push (มือถือ → repo) ----------
export async function enqueueSession(db, sessionId, now = new Date()) {
  const id = `q_${sessionId}`;
  await tx(db, [STORES.sync_queue], 'readwrite', async (s) => {
    const existing = await reqp(s.sync_queue.get(id));
    s.sync_queue.put(existing ? { ...existing, updated_at: nowIso(now) } : { id, kind: 'session', ref_id: sessionId, attempts: 0, last_error: null, created_at: nowIso(now), updated_at: nowIso(now) });
  });
}
export async function listQueue(db) {
  return tx(db, [STORES.sync_queue], 'readonly', (s) => reqp(s.sync_queue.getAll()));
}
export async function clearQueueItem(db, id) {
  await tx(db, [STORES.sync_queue], 'readwrite', (s) => { s.sync_queue.delete(id); });
}

async function pushOne(db, cfg, item, fetchImpl, now) {
  const payload = await exportSession(db, item.ref_id);
  const path = `sessions/${payload.session.id}.json`;
  let sha = payload.session.sync?.sha || null;
  if (!sha) {
    const head = await api(cfg, path, { fetchImpl });
    if (head.status === 200 && head.json && head.json.sha) sha = head.json.sha;
    else if (head.status !== 404) throw new Error(describe(head.status, head.json));
  }
  const content = b64EncodeUtf8(JSON.stringify(payload, null, 2));
  const body = { message: `liftlog: session ${payload.session.date} ${payload.session.card?.title || ''}`.trim(), content, branch: cfg.branch };
  if (sha) body.sha = sha;
  const put = await api(cfg, path, { method: 'PUT', body, fetchImpl });
  if (put.status === 409 || put.status === 422) {
    // sha เก่า — ดึงใหม่แล้วส่งอีกครั้งหนึ่ง
    const head = await api(cfg, path, { fetchImpl });
    if (head.status === 200 && head.json && head.json.sha) {
      body.sha = head.json.sha;
      const retry = await api(cfg, path, { method: 'PUT', body, fetchImpl });
      if (!retry.ok) throw new Error(describe(retry.status, retry.json));
      return retry.json;
    }
    throw new Error(describe(put.status, put.json));
  }
  if (!put.ok) throw new Error(describe(put.status, put.json));
  return put.json;
}

/** ส่งทุกอย่างในคิว — ไม่โยน error ออกไป UI คืนรายงานแทน */
export async function processQueue(db, { fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const cfg = await getSyncConfig(db);
  const report = { pushed: [], failed: [], skipped: [] };
  if (!cfg) { report.failed.push({ id: null, error: 'ยังไม่ได้ตั้งค่า sync' }); return report; }
  const queue = await listQueue(db);
  for (const item of queue.sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
    const ses = await getSession(db, item.ref_id);
    if (!ses) { await clearQueueItem(db, item.id); report.skipped.push(item.id); continue; }
    try {
      const res = await pushOne(db, cfg, item, fetchImpl, now);
      const fresh = await getSession(db, item.ref_id);
      if (fresh) {
        fresh.sync = { sha: res?.content?.sha || null, pushed_at: nowIso(now), path: res?.content?.path || null };
        await putSession(db, fresh);
      }
      await clearQueueItem(db, item.id);
      report.pushed.push(item.ref_id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await tx(db, [STORES.sync_queue], 'readwrite', (s) => { s.sync_queue.put({ ...item, attempts: (item.attempts || 0) + 1, last_error: msg, updated_at: nowIso(now) }); });
      report.failed.push({ id: item.ref_id, error: msg });
    }
  }
  if (report.pushed.length) await setSetting(db, SYNC_KEYS.lastPush, nowIso(now));
  return report;
}

// ---------- pull (repo → มือถือ) ----------
async function fetchJsonFile(cfg, path, fetchImpl) {
  const r = await api(cfg, path, { fetchImpl });
  if (!r.ok) throw new Error(describe(r.status, r.json));
  if (!r.json || typeof r.json.content !== 'string') throw new Error(`ไฟล์ ${path} ไม่มีเนื้อหา (ใหญ่เกิน 1MB?)`);
  const text = b64DecodeUtf8(r.json.content);
  return { sha: r.json.sha, data: JSON.parse(text) };
}

/** การ์ด Lee ทุกใบใน cards/ — ดึงเฉพาะที่ sha เปลี่ยน */
export async function pullCards(db, { fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const cfg = await getSyncConfig(db);
  if (!cfg) return { ok: false, updated: 0, total: 0, message: 'ยังไม่ได้ตั้งค่า sync' };
  const list = await api(cfg, 'cards', { fetchImpl });
  if (list.status === 404) return { ok: true, updated: 0, total: 0, message: 'ยังไม่มีโฟลเดอร์ cards/ ใน repo' };
  if (!list.ok || !Array.isArray(list.json)) return { ok: false, updated: 0, total: 0, message: describe(list.status, list.json) };
  const local = new Map((await listCards(db)).map((c) => [c.id, c]));
  let updated = 0;
  const errors = [];
  for (const f of list.json) {
    if (f.type !== 'file' || !/\.json$/i.test(f.name)) continue;
    const id = f.name.replace(/\.json$/i, '');
    const have = local.get(id);
    if (have && have.sync_sha === f.sha) continue;
    try {
      const { sha, data } = await fetchJsonFile(cfg, `cards/${f.name}`, fetchImpl);
      if (!data || typeof data !== 'object' || !Array.isArray(data.blocks)) { errors.push(`${f.name}: ไม่ใช่การ์ด (ไม่มี blocks)`); continue; }
      data.id = data.id || id;
      data.sync_sha = sha;
      data.synced_at = nowIso(now);
      await putCard(db, data);
      updated++;
    } catch (e) {
      errors.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { ok: errors.length === 0, updated, total: list.json.length, message: errors.join(' · ') };
}

/** คลังท่าจาก library.json — รวมกับฟิลด์ที่ผู้ใช้กรอกเอง */
export async function pullLibrary(db, { fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const cfg = await getSyncConfig(db);
  if (!cfg) return { ok: false, updated: 0, message: 'ยังไม่ได้ตั้งค่า sync' };
  const head = await api(cfg, 'library.json', { fetchImpl });
  if (head.status === 404) return { ok: true, updated: 0, message: 'ยังไม่มี library.json ใน repo' };
  if (!head.ok || !head.json) return { ok: false, updated: 0, message: describe(head.status, head.json) };
  const known = await getSetting(db, SYNC_KEYS.libSha, null);
  if (known === head.json.sha) return { ok: true, updated: 0, message: 'คลังท่าเป็นเวอร์ชันล่าสุดแล้ว' };
  const text = b64DecodeUtf8(head.json.content);
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : Array.isArray(data.exercises) ? data.exercises : null;
  if (!list) return { ok: false, updated: 0, message: 'library.json ไม่มี exercises[]' };
  const n = await upsertLibrary(db, list);
  await setSetting(db, SYNC_KEYS.libSha, head.json.sha);
  return { ok: true, updated: n, message: `คลังท่า ${n} ท่า` };
}

export async function syncAll(db, opts = {}) {
  const now = opts.now || new Date();
  const out = { push: null, cards: null, library: null, errors: [] };
  try { out.push = await processQueue(db, { ...opts, now }); } catch (e) { out.errors.push(`push: ${e instanceof Error ? e.message : e}`); }
  try { out.cards = await pullCards(db, { ...opts, now }); if (!out.cards.ok && out.cards.message) out.errors.push(`cards: ${out.cards.message}`); } catch (e) { out.errors.push(`cards: ${e instanceof Error ? e.message : e}`); }
  try { out.library = await pullLibrary(db, { ...opts, now }); if (!out.library.ok && out.library.message) out.errors.push(`library: ${out.library.message}`); } catch (e) { out.errors.push(`library: ${e instanceof Error ? e.message : e}`); }
  if (!out.errors.length) await setSetting(db, SYNC_KEYS.lastPull, nowIso(now));
  return out;
}
