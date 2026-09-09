// ui_settings.js — สำรอง/กู้คืน · ซิงก์ GitHub · ค่าเริ่มต้น · ข้อมูลตัวอย่าง · ลบทั้งหมด
// กู้คืน = restore-replace ทั้งชุด: ต้องส่งออกสำเนาปัจจุบันสำเร็จก่อน + ยืนยัน + preview จำนวน/ซ้ำ
// @ts-check
import * as repo from './repo.js';
import { exportAll, exportCsv, validateBackup, restoreReplace, SCHEMA_VERSION } from './backup.js';
import { SYNC_KEYS, getSyncConfig, testConnection, listQueue } from './sync.js';
import { deleteDatabase } from './db.js';
import { localDate, nowIso, thaiDate } from './util.js';
import { h, clear, topBar, pill, toast, modal, confirmModal, chips, field, saveFile, pickFiles, readFileText, busy } from './ui_common.js';
import { importLibrary } from './ui_library.js';
import { importCards } from './ui_today.js';

export async function renderSettings(ctx, root) {
  const db = ctx.db;
  const [counts, cfg, queue, lastExport, lastPush, lastPull] = await Promise.all([
    repo.storeCounts(db), getSyncConfig(db), listQueue(db),
    repo.getSetting(db, 'last_export_at', null), repo.getSetting(db, SYNC_KEYS.lastPush, null), repo.getSetting(db, SYNC_KEYS.lastPull, null),
  ]);
  clear(root);
  root.append(topBar('ตั้งค่า'));

  // ---- ข้อมูลในเครื่อง ----
  root.append(h('h2', null, 'ข้อมูลในเครื่องนี้'));
  root.append(h('div', { class: 'card' },
    h('div', { class: 'kv' },
      h('b', null, 'เซสชัน'), h('span', null, String(counts.sessions)),
      h('b', null, 'เซ็ต'), h('span', null, String(counts.sets)),
      h('b', null, 'การ์ด'), h('span', null, String(counts.cards)),
      h('b', null, 'คลังท่า'), h('span', null, String(counts.exercises)),
      h('b', null, 'เก็บถาวร'), h('span', null, ctx.persisted === true ? 'เบราว์เซอร์รับปากแล้ว ✓' : ctx.persisted === false ? 'ยังไม่รับปาก — สำรองบ่อย ๆ' : 'ไม่ทราบ'),
      h('b', null, 'สำรองล่าสุด'), h('span', null, lastExport ? fmtWhen(lastExport) : h('span', { class: 'warn-box', style: { display: 'inline-block', padding: '2px 8px' } }, 'ยังไม่เคย')),
    ),
    h('p', { class: 'small dim mt' }, 'ที่เก็บในเบราว์เซอร์ไม่ใช่สำเนาสำรอง (Safari ลบได้เมื่อพื้นที่ไม่พอ) — ส่งออกไฟล์เก็บไว้ที่ Files/iCloud เป็นระยะ'),
  ));

  // ---- สำรอง / กู้คืน ----
  root.append(h('h2', null, 'สำรอง / กู้คืน'));
  root.append(h('div', { class: 'col' },
    h('button', { class: 'btn md', onclick: (e) => busy(e.currentTarget, () => doExportJson(ctx)) }, '⬇️ ส่งออก JSON (กู้คืนได้ครบ)'),
    h('button', { class: 'btn md ghost', onclick: (e) => busy(e.currentTarget, () => doExportCsv(ctx)) }, '⬇️ ส่งออก CSV (รูปแบบ gym_log.csv)'),
    h('button', { class: 'btn md ghost', onclick: (e) => busy(e.currentTarget, () => doImport(ctx, lastExport)) }, '⬆️ กู้คืนจากไฟล์ JSON (แทนที่ทั้งชุด)'),
  ));

  // ---- นำเข้าจาก Life OS ----
  root.append(h('h2', null, 'นำเข้าจาก Life OS'));
  root.append(h('div', { class: 'row' },
    h('button', { class: 'btn md ghost', onclick: (e) => busy(e.currentTarget, () => importCards(ctx)) }, '📥 การ์ด Lee (.json)'),
    h('button', { class: 'btn md ghost', onclick: (e) => busy(e.currentTarget, () => importLibrary(ctx)) }, '📥 library.json'),
  ));

  // ---- ซิงก์ ----
  root.append(h('h2', null, 'ซิงก์กับ Life OS (GitHub repo ส่วนตัว)'));
  const owner = field({ label: 'GitHub owner', value: await repo.getSetting(db, SYNC_KEYS.owner, 'sabaholo'), placeholder: 'ชื่อบัญชี GitHub', inputmode: 'url' });
  const repoF = field({ label: 'Repo (private)', value: await repo.getSetting(db, SYNC_KEYS.repo, 'liftlog-data'), placeholder: 'liftlog-data' });
  const branch = field({ label: 'Branch', value: await repo.getSetting(db, SYNC_KEYS.branch, 'main'), placeholder: 'main' });
  const token = field({ label: 'Fine-grained token (สิทธิ์ Contents: read/write เฉพาะ repo นี้)', type: 'password', value: await repo.getSetting(db, SYNC_KEYS.token, ''), placeholder: 'github_pat_…' });
  const saveSync = async () => {
    await repo.setSetting(db, SYNC_KEYS.owner, owner.input.value.trim());
    await repo.setSetting(db, SYNC_KEYS.repo, repoF.input.value.trim());
    await repo.setSetting(db, SYNC_KEYS.branch, branch.input.value.trim() || 'main');
    await repo.setSetting(db, SYNC_KEYS.token, token.input.value.trim());
  };
  root.append(h('div', { class: 'card' },
    h('p', { class: 'small muted' }, 'สิ่งที่ออกจากเครื่อง: เซสชันที่จบแล้ว (ไป sessions/) · สิ่งที่เข้ามา: การ์ด Lee (cards/) + คลังท่า (library.json) · token อยู่ในเครื่องนี้เท่านั้น ไม่ออกไปกับไฟล์สำรอง'),
    owner.el, repoF.el, branch.el, token.el,
    h('div', { class: 'row mt' },
      h('button', { class: 'btn md', onclick: (e) => busy(e.currentTarget, async () => { await saveSync(); const r = await testConnection(db); toast(r.message, { kind: r.ok ? 'ok' : 'err', ms: 6000 }); if (r.ok) ctx.rerender(); }) }, 'บันทึก + ทดสอบ'),
      h('button', { class: 'btn md ghost', onclick: (e) => busy(e.currentTarget, async () => { await saveSync(); await ctx.sync(); ctx.rerender(); }) }, 'ซิงก์เดี๋ยวนี้'),
    ),
    cfg ? h('p', { class: 'small dim mt' }, `รอส่ง ${queue.length} · ส่งล่าสุด ${lastPush ? fmtWhen(lastPush) : '—'} · ดึงล่าสุด ${lastPull ? fmtWhen(lastPull) : '—'}`) : null,
    queue.some((q) => q.last_error) ? h('div', { class: 'warn-box small' }, 'ส่งไม่ผ่านล่าสุด: ', queue.find((q) => q.last_error).last_error) : null,
    cfg ? h('button', { class: 'btn sm ghost danger mt', onclick: async () => { const ok = await confirmModal({ title: 'ลบการตั้งค่าซิงก์?', text: 'ลบ token ออกจากเครื่องนี้ ข้อมูลการเล่นไม่หาย', ok: 'ลบ', danger: true }); if (!ok) return; for (const k of [SYNC_KEYS.owner, SYNC_KEYS.repo, SYNC_KEYS.token]) await repo.deleteSetting(db, k); ctx.rerender(); } }, 'ลบการตั้งค่าซิงก์') : null,
  ));

  // ---- ค่าเริ่มต้นตอนจด ----
  root.append(h('h2', null, 'ตอนจด'));
  const stepC = chips({ options: [{ v: 1, label: '1 kg' }, { v: 2.5, label: '2.5 kg' }, { v: 5, label: '5 kg' }], value: ctx.settings.kgStep, allowNone: false, small: true, onChange: async (v) => { await repo.setSetting(db, 'kg_step', v); await ctx.reloadSettings(); } });
  const autoC = chips({ options: [{ v: 'off', label: 'กดเอง' }, { v: 'on', label: 'เริ่มพักอัตโนมัติหลังบันทึก' }], value: ctx.settings.autoRest ? 'on' : 'off', allowNone: false, small: true, onChange: async (v) => { await repo.setSetting(db, 'auto_rest', v === 'on'); await ctx.reloadSettings(); } });
  root.append(h('div', { class: 'card' },
    h('label', { class: 'f' }, 'ขั้นเพิ่ม/ลดน้ำหนักของปุ่ม − +'), stepC.el,
    h('p', { class: 'tiny dim' }, 'เพลทที่ยิมมีขนาดอะไรบ้าง ยังไม่เช็ค — ตั้งตามที่ใช้จริง'),
    h('label', { class: 'f' }, 'ตัวจับเวลาพัก (เวลาจากการ์ด)'), autoC.el,
  ));

  // ---- ตัวอย่าง ----
  root.append(h('h2', null, 'ข้อมูลตัวอย่าง'));
  root.append(h('button', { class: 'btn md ghost', onclick: async (e) => busy(e.currentTarget, async () => { const n = await repo.deleteDemoData(db); toast(`ลบข้อมูลตัวอย่างแล้ว ${n} รายการ`, { kind: 'ok' }); ctx.rerender(); }) }, 'ลบข้อมูลตัวอย่าง (การ์ด/เซสชันที่ติดป้าย demo)'));

  // ---- เกี่ยวกับ ----
  root.append(h('h2', null, 'เกี่ยวกับ'));
  root.append(h('div', { class: 'card small muted' },
    h('p', null, `Lift Log ${ctx.version} · schema ${SCHEMA_VERSION}`),
    h('p', null, 'เพิ่มบน Home Screen: Safari → ปุ่มแชร์ → "เพิ่มไปยังหน้าจอโฮม" แล้วเปิดจากไอคอนเสมอ (ข้อมูลของหน้าจอโฮมกับของ Safari เป็นคนละชุด)'),
    h('p', null, 'ไม่มีบัญชี ไม่มี analytics ไม่ส่งอะไรออกจากเครื่อง ยกเว้นซิงก์ที่พี่เปิดเอง และลิงก์สื่อที่พี่กดเอง'),
    h('p', null, 'ตัวเลขทั้งหมดเป็นบันทึกของผู้ใช้ — แอปไม่สั่งเพิ่มโหลด ไม่วินิจฉัย'),
  ));

  // ---- อันตราย ----
  root.append(h('h2', null, 'ลบทั้งหมด'));
  root.append(h('button', { class: 'btn md ghost danger', onclick: () => wipeFlow(ctx) }, 'ลบข้อมูลทุกอย่างในเครื่องนี้'));
}

function fmtWhen(iso) {
  try { const d = new Date(iso); return `${thaiDate(localDate(d))} ${d.toTimeString().slice(0, 5)}`; } catch { return iso; }
}

async function doExportJson(ctx) {
  const data = await exportAll(ctx.db);
  const name = `liftlog-backup-${localDate()}.json`;
  const r = await saveFile(name, JSON.stringify(data, null, 2), 'application/json');
  if (r === 'cancelled') { toast('ยกเลิกการส่งออก'); return; }
  await repo.setSetting(ctx.db, 'last_export_at', nowIso());
  toast(`ส่งออก ${name} แล้ว (${data.counts.sessions} เซสชัน · ${data.counts.sets} เซ็ต)`, { kind: 'ok', ms: 5000 });
  ctx.rerender();
}

async function doExportCsv(ctx) {
  const csv = await exportCsv(ctx.db);
  const name = `gym_log-${localDate()}.csv`;
  const r = await saveFile(name, csv, 'text/csv');
  if (r === 'cancelled') return;
  toast(`ส่งออก ${name} แล้ว (${Math.max(0, csv.split('\n').length - 2)} แถว)`, { kind: 'ok' });
}

async function doImport(ctx, lastExport) {
  const db = ctx.db;
  const files = await pickFiles({ accept: '.json,application/json' });
  if (!files.length) return;
  let obj;
  try { obj = JSON.parse(await readFileText(files[0])); }
  catch { toast('ไฟล์ไม่ใช่ JSON', { kind: 'err' }); return; }
  const v = validateBackup(obj);
  const current = await repo.storeCounts(db);
  if (!v.ok) {
    modal({ title: 'ไฟล์ไม่ผ่านการตรวจ — ไม่ได้แตะข้อมูลเดิม', body: h('div', null, v.errors.map((e) => h('p', { class: 'small danger-text' }, e))), actions: [{ label: 'ปิด' }] });
    return;
  }
  const exportedOk = h('input', { type: 'checkbox' });
  const sure = h('input', { type: 'checkbox' });
  const body = h('div', null,
    h('p', { class: 'small muted' }, `ไฟล์: ${files[0].name} · ส่งออกเมื่อ ${obj.exported_at ? fmtWhen(obj.exported_at) : '—'} · แอป ${obj.app_version || '—'}`),
    h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, 'ตาราง'), h('th', { class: 'num' }, 'ในเครื่อง'), h('th', { class: 'num' }, 'ในไฟล์'))),
      h('tbody', null, Object.keys(v.counts).map((k) => h('tr', null, h('td', null, k), h('td', { class: 'num' }, String(current[k] ?? 0)), h('td', { class: 'num' }, String(v.counts[k]))))),
    ),
    v.warnings.length ? h('div', { class: 'warn-box small' }, v.warnings.join(' · ')) : null,
    h('div', { class: 'warn-box' }, 'การกู้คืน = แทนที่ข้อมูลในเครื่อง "ทั้งชุด" ด้วยของในไฟล์ ไม่มีการรวม'),
    h('label', { class: 'check' }, exportedOk, 'ฉันส่งออกสำเนาปัจจุบันสำเร็จแล้ว', lastExport ? h('span', { class: 'dim small' }, ` (ล่าสุด ${fmtWhen(lastExport)})`) : h('span', { class: 'danger-text small' }, ' (ยังไม่เคยส่งออก)')),
    h('label', { class: 'check' }, sure, 'ยืนยันแทนที่ทั้งชุด'),
  );
  modal({
    title: 'กู้คืนจากไฟล์',
    body,
    sticky: true,
    actions: [
      { label: 'ยกเลิก', kind: 'ghost' },
      { label: 'แทนที่ทั้งชุด', kind: 'danger', fn: async () => {
        if (!exportedOk.checked || !sure.checked) { toast('ติ๊กยืนยันทั้งสองข้อก่อน', { kind: 'err' }); return false; }
        try {
          const counts = await restoreReplace(db, obj);
          toast(`กู้คืนแล้ว · เซสชัน ${counts.sessions} · เซ็ต ${counts.sets}`, { kind: 'ok', ms: 5000 });
          await ctx.reloadSettings();
          ctx.navigate('#/today');
        } catch (e) {
          toast(`กู้คืนไม่สำเร็จ — ข้อมูลเดิมยังอยู่ครบ: ${e instanceof Error ? e.message : String(e)}`, { kind: 'err', ms: 8000 });
          return false;
        }
      } },
    ],
  });
}

async function wipeFlow(ctx) {
  const word = field({ label: 'พิมพ์คำว่า ลบ เพื่อยืนยัน', placeholder: 'ลบ' });
  modal({
    title: 'ลบข้อมูลทุกอย่างในเครื่องนี้',
    body: h('div', null, h('div', { class: 'warn-box' }, 'ลบเซสชัน เซ็ต การ์ด คลังท่า การตั้งค่า และ token ทั้งหมด — กู้คืนได้จากไฟล์สำรองเท่านั้น'), word.el),
    actions: [
      { label: 'ยกเลิก', kind: 'ghost' },
      { label: 'ลบทั้งหมด', kind: 'danger', fn: async () => {
        if (word.input.value.trim() !== 'ลบ') { toast('พิมพ์ "ลบ" ให้ตรง', { kind: 'err' }); return false; }
        try { ctx.db.close(); } catch {}
        await deleteDatabase();
        location.hash = '#/today';
        location.reload();
      } },
    ],
  });
}

export { pill };
