// ui_today.js — หน้าวันนี้: เล่นต่อ · การ์ดของวัน · นำเข้าการ์ด · เริ่มแบบว่าง · ล่าสุด
// @ts-check
import * as repo from './repo.js';
import { pickCards, cardItems, progressOf } from './model.js';
import { localDate, thaiDate } from './util.js';
import { h, clear, topBar, pill, toast, confirmModal, modal, pickFiles, readFileText, busy } from './ui_common.js';
import { getSyncConfig, listQueue } from './sync.js';

export async function renderToday(ctx, root) {
  const db = ctx.db;
  const today = localDate();
  const [active, cards, sessions] = await Promise.all([repo.activeSession(db), repo.listCards(db), repo.listSessions(db)]);
  clear(root);
  root.append(topBar('วันนี้', { right: h('span', { class: 'dim small' }, thaiDate(today)) }));

  if (active) root.append(activeCard(ctx, active));

  const real = cards.filter((c) => !c.demo);
  const pick = pickCards(real, today);
  root.append(h('h2', null, 'การ์ดของวันนี้'));
  if (pick.today.length) {
    pick.today.forEach((c) => root.append(cardRow(ctx, c, { active })));
    if (pick.today.length > 1) root.append(h('p', { class: 'small dim' }, `วันนี้มี ${pick.today.length} ใบ — เลือกเอง แอปไม่เดาให้`));
  } else {
    root.append(h('div', { class: 'card' },
      h('p', { class: 'muted' }, 'ยังไม่มีการ์ดที่ลงวันที่วันนี้'),
      h('p', { class: 'small dim' }, 'นำเข้าการ์ดจาก Life OS (ไฟล์ .json ของ Lee) · ซิงก์ · หรือเริ่มแบบว่างแล้วเพิ่มท่าเอง'),
    ));
  }
  root.append(h('div', { class: 'row mt' },
    h('button', { class: 'btn md', onclick: (e) => busy(e.currentTarget, () => importCards(ctx)) }, '📥 นำเข้าการ์ด'),
    h('button', { class: 'btn md ghost', onclick: (e) => busy(e.currentTarget, () => startEmpty(ctx, active)) }, 'เริ่มแบบว่าง'),
  ));

  const others = [
    ...pick.future.map((c) => ({ c, tag: 'ล่วงหน้า', kind: 'info' })),
    ...pick.past.slice(0, 6).map((c) => ({ c, tag: 'ผ่านมาแล้ว', kind: '' })),
    ...pick.undated.map((c) => ({ c, tag: 'ไม่มีวันที่', kind: '' })),
  ];
  const demos = cards.filter((c) => c.demo);
  if (others.length || demos.length) {
    root.append(h('h2', null, 'การ์ดอื่น'));
    others.forEach(({ c, tag, kind }) => root.append(cardRow(ctx, c, { tag, kind, active })));
    demos.forEach((c) => root.append(cardRow(ctx, c, { tag: 'ตัวอย่าง — ไม่เข้าสถิติ', kind: 'warn', active })));
  }

  const recent = sessions.filter((s) => s.status !== 'in_progress').slice(0, 3);
  if (recent.length) {
    root.append(h('h2', null, 'ล่าสุด'));
    root.append(h('div', { class: 'list' }, recent.map((s) => sessionItem(ctx, s))));
  }

  const cfg = await getSyncConfig(db);
  if (cfg) {
    const q = await listQueue(db);
    root.append(h('p', { class: 'small dim mt' },
      `ซิงก์กับ ${cfg.owner}/${cfg.repo} · รอส่ง ${q.length} `,
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); ctx.sync(); } }, 'ซิงก์เดี๋ยวนี้'),
    ));
  } else {
    root.append(h('p', { class: 'small dim mt' }, 'ข้อมูลอยู่ในเครื่องนี้เท่านั้น — ตั้งค่า → สำรอง/ซิงก์'));
  }
}

function activeCard(ctx, ses) {
  const p = progressOf(ses);
  const started = ses.started_at ? new Date(ses.started_at) : null;
  const mins = started ? Math.max(0, Math.round((Date.now() - started.getTime()) / 60000)) : null;
  return h('div', { class: 'card focus' },
    h('div', { class: 'sub' }, 'เซสชันค้างอยู่'),
    h('div', { class: 'title' }, ses.card.title),
    h('div', { class: 'small muted' }, `ทำแล้ว ${p.done}/${p.total} ท่า`, p.skipped ? ` · ข้าม ${p.skipped}` : '', mins !== null ? ` · เริ่มเมื่อ ${mins} นาทีก่อน` : ''),
    ses.demo ? h('div', null, pill('ตัวอย่าง — ไม่เข้าสถิติ', 'warn')) : null,
    h('button', { class: 'btn primary mt', onclick: () => ctx.navigate(`#/play/${ses.id}`) }, 'เล่นต่อ ▸'),
  );
}

function cardRow(ctx, card, { tag = null, kind = '', active = null } = {}) {
  const items = cardItems(card);
  const mine = items.filter((i) => i.who !== 'nan').length;
  const nan = items.length - mine;
  return h('div', { class: `card ${card.demo ? 'demo' : ''}` },
    h('div', { class: 'title' }, card.title || card.id),
    h('div', { class: 'small muted' },
      card.date ? thaiDate(card.date) : 'ไม่มีวันที่',
      card.duration_min ? ` · ${card.duration_min} นาที` : '',
      ` · ${mine} ท่า`, nan ? ` (+แนน ${nan})` : '',
    ),
    h('div', { class: 'mt' }, tag ? pill(tag, kind) : null, card.who ? pill(card.who) : null),
    card.note ? h('details', null, h('summary', null, 'โน้ตใบนี้'), h('p', { class: 'small muted' }, card.note)) : null,
    h('button', { class: 'btn md mt', onclick: (e) => busy(e.currentTarget, () => startCard(ctx, card, active)) }, 'เริ่มจากใบนี้'),
  );
}

async function startCard(ctx, card, active) {
  const db = ctx.db;
  if (active) {
    const goOn = await confirmModal({
      title: 'มีเซสชันค้างอยู่',
      text: `"${active.card.title}" ยังไม่จบ — จบเซสชันเดิม (เก็บเท่าที่เล่นจริง) แล้วเริ่มใบใหม่ไหม`,
      ok: 'จบเดิม แล้วเริ่มใหม่',
      cancel: 'กลับไปเล่นต่อ',
    });
    if (!goOn) { ctx.navigate(`#/play/${active.id}`); return; }
    await repo.endSession(db, active.id, { discard: false });
  }
  const today = localDate();
  if (card.date && card.date > today) {
    const ok = await confirmModal({ title: 'การ์ดล่วงหน้า', text: `ใบนี้เป็นของวัน ${thaiDate(card.date)} — เริ่มวันนี้เลยไหม`, ok: 'เริ่ม' });
    if (!ok) return;
  }
  const ses = await repo.startSession(db, card);
  ctx.navigate(`#/play/${ses.id}`);
}

async function startEmpty(ctx, active) {
  if (active) {
    const goOn = await confirmModal({ title: 'มีเซสชันค้างอยู่', text: 'จบเซสชันเดิมก่อนแล้วเริ่มแบบว่างไหม', ok: 'จบเดิม แล้วเริ่ม', cancel: 'กลับไปเล่นต่อ' });
    if (!goOn) { ctx.navigate(`#/play/${active.id}`); return; }
    await repo.endSession(ctx.db, active.id, { discard: false });
  }
  const ses = await repo.startEmptySession(ctx.db);
  ctx.navigate(`#/play/${ses.id}`);
}

/** นำเข้าการ์ด .json ของ Lee (โครง outputs/lee/sessions/*.json) — id เดิม = อัปเดตใบเดิม */
export async function importCards(ctx) {
  const files = await pickFiles({ accept: '.json,application/json', multiple: true });
  if (!files.length) return;
  const existing = new Set((await repo.listCards(ctx.db)).map((c) => c.id));
  let added = 0;
  let updated = 0;
  const errors = [];
  for (const f of files) {
    try {
      const data = JSON.parse(await readFileText(f));
      if (!data || typeof data !== 'object' || !Array.isArray(data.blocks)) throw new Error('ไม่มี blocks — ไม่ใช่การ์ดของ Lee');
      data.id = data.id || f.name.replace(/\.json$/i, '');
      data.demo = !!data.demo;
      if (existing.has(data.id)) updated++; else added++;
      await repo.putCard(ctx.db, data);
    } catch (e) {
      errors.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (added || updated) toast(`นำเข้าแล้ว · ใหม่ ${added} · อัปเดต ${updated}`, { kind: 'ok' });
  if (errors.length) modal({ title: 'ไฟล์ที่ไม่รับ', body: h('div', null, errors.map((x) => h('p', { class: 'small danger-text' }, x))), actions: [{ label: 'ปิด' }] });
  ctx.rerender();
}

function sessionItem(ctx, s) {
  const p = progressOf(s);
  const st = s.status === 'completed' ? pill('จบ', 'ok') : s.status === 'discarded' ? pill('ทิ้ง', 'danger') : pill(s.status);
  return h('div', { class: 'item', onclick: () => ctx.navigate(`#/history/${s.id}`) },
    h('div', { class: 'grow' },
      h('div', { class: 't' }, s.card.title),
      h('div', { class: 's' }, thaiDate(s.date), ` · ${p.done} ท่า`, s.demo ? ' · ตัวอย่าง' : ''),
    ),
    st,
  );
}
