// ui_history.js — ประวัติ: รายการเซสชัน · รายละเอียด (แก้เซ็ตย้อนหลัง · โน้ต · ส่งซิงก์ซ้ำ · ลบ) · ความสม่ำเสมอ
// ความสม่ำเสมอ = วันที่มีเซสชันจบและมีอย่างน้อยหนึ่งเซ็ตที่บันทึกเสร็จ — ไม่นับวันที่แค่เปิดแอป
// @ts-check
import * as repo from './repo.js';
import { progressOf, summarizeSets } from './model.js';
import { thaiDate, localDate, daysBetween, fmtKg } from './util.js';
import { h, clear, topBar, pill, toast, confirmModal, busy } from './ui_common.js';
import { openEditSets } from './ui_play.js';
import { enqueueSession, getSyncConfig, listQueue } from './sync.js';

export async function renderHistory(ctx, root, params) {
  if (params[0]) return renderSessionDetail(ctx, root, params[0]);
  const db = ctx.db;
  const [sessions, sets, queue, logged] = await Promise.all([repo.listSessions(db), repo.allSets(db), listQueue(db), repo.loggedExerciseKeys(db)]);
  clear(root);
  root.append(topBar('ประวัติ'));

  const setsBySession = new Map();
  for (const s of sets) { if (s.status !== 'completed') continue; setsBySession.set(s.session_id, (setsBySession.get(s.session_id) || 0) + 1); }
  const today = localDate();
  const realDone = sessions.filter((s) => s.status === 'completed' && !s.demo && (setsBySession.get(s.id) || 0) > 0);
  const days30 = new Set(realDone.filter((s) => daysBetween(s.date, today) <= 29).map((s) => s.date)).size;
  const days7 = new Set(realDone.filter((s) => daysBetween(s.date, today) <= 6).map((s) => s.date)).size;
  root.append(h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('div', { class: 'center' }, h('div', { class: 'huge' }, String(days7)), h('div', { class: 'small dim' }, 'วันที่เล่น · 7 วัน')),
      h('div', { class: 'center' }, h('div', { class: 'huge' }, String(days30)), h('div', { class: 'small dim' }, 'วันที่เล่น · 30 วัน')),
      h('div', { class: 'center' }, h('div', { class: 'huge' }, String(realDone.length)), h('div', { class: 'small dim' }, 'เซสชันจบทั้งหมด')),
    ),
    h('p', { class: 'tiny dim center' }, 'นับเฉพาะเซสชันที่จบและมีอย่างน้อย 1 เซ็ตจริง · ไม่รวมตัวอย่าง'),
  ));

  const queued = new Set(queue.map((q) => q.ref_id));
  if (!sessions.length) root.append(h('p', { class: 'empty' }, 'ยังไม่มีเซสชัน'));
  else {
    root.append(h('div', { class: 'list' }, sessions.map((s) => {
      const p = progressOf(s);
      const n = setsBySession.get(s.id) || 0;
      const st = s.status === 'in_progress' ? pill('กำลังเล่น', 'accent') : s.status === 'completed' ? pill('จบ', 'ok') : pill('ทิ้ง', 'danger');
      const sync = s.sync?.sha ? pill('☁ ส่งแล้ว', 'ok') : queued.has(s.id) ? pill('⏳ รอส่ง', 'warn') : null;
      return h('div', { class: 'item', onclick: () => ctx.navigate(s.status === 'in_progress' ? `#/play/${s.id}` : `#/history/${s.id}`) },
        h('div', { class: 'grow' },
          h('div', { class: 't' }, thaiDate(s.date), ' · ', s.card.title),
          h('div', { class: 's' }, `${p.done} ท่า · ${n} เซ็ต`, p.skipped ? ` · ข้าม ${p.skipped}` : '', s.demo ? ' · ตัวอย่าง' : ''),
        ),
        sync, st,
      );
    })));
  }

  if (logged.length) {
    root.append(h('h2', null, 'ท่าที่เคยจด'));
    root.append(h('div', { class: 'list' }, logged.slice(0, 40).map((l) => h('div', { class: 'item', onclick: () => ctx.navigate(`#/library/${encodeURIComponent(l.key)}`) },
      h('div', { class: 'grow' }, h('div', { class: 't' }, l.name || l.key), h('div', { class: 's' }, `${l.count} เซ็ต · ล่าสุด ${thaiDate(l.last.slice(0, 10))}`)),
      h('span', { class: 'dim' }, '›'),
    ))));
  }
}

export async function renderSessionDetail(ctx, root, id) {
  const db = ctx.db;
  const ses = await repo.getSession(db, id);
  clear(root);
  if (!ses) { root.append(topBar('ไม่พบเซสชัน', { back: () => ctx.navigate('#/history') })); return; }
  const [sets, cfg, queue] = await Promise.all([repo.getSessionSets(db, id), getSyncConfig(db), listQueue(db)]);
  const p = progressOf(ses);
  const mins = ses.started_at && ses.ended_at ? Math.round((new Date(ses.ended_at).getTime() - new Date(ses.started_at).getTime()) / 60000) : null;
  const queued = queue.some((q) => q.ref_id === id);

  root.append(topBar(ses.card.title, { back: () => ctx.navigate('#/history') }));
  root.append(h('div', { class: 'card' },
    h('div', { class: 'muted' }, thaiDate(ses.date), ses.started_at ? ` · เริ่ม ${new Date(ses.started_at).toTimeString().slice(0, 5)}` : '', mins !== null ? ` · ${mins} นาที` : ''),
    h('div', { class: 'mt' },
      ses.status === 'completed' ? pill('จบ', 'ok') : ses.status === 'discarded' ? pill('ทิ้ง — ไม่เข้าสถิติ', 'danger') : pill('กำลังเล่น', 'accent'),
      pill(`ทำ ${p.done}/${p.total}`), p.skipped ? pill(`ข้าม ${p.skipped}`) : null,
      ses.demo ? pill('ตัวอย่าง', 'warn') : null,
      ses.sync?.sha ? pill('☁ ส่งแล้ว', 'ok') : queued ? pill('⏳ รอส่ง', 'warn') : cfg && !ses.demo && ses.status === 'completed' ? pill('ยังไม่ส่ง') : null,
    ),
  ));

  const bySe = new Map();
  for (const s of sets) { if (!bySe.has(s.session_exercise_id)) bySe.set(s.session_exercise_id, []); bySe.get(s.session_exercise_id).push(s); }
  ses.exercises.forEach((se) => {
    const mine = (bySe.get(se.id) || []).filter((s) => s.status !== 'discarded' || ses.status === 'discarded').sort((a, b) => a.index - b.index);
    const sum = summarizeSets(mine.map((s) => ({ ...s, status: 'completed' })));
    root.append(h('div', { class: `card ${se.status === 'skipped' ? 'demo' : ''}` },
      h('div', { class: 'spread' },
        h('div', null, h('div', { class: 'big' }, se.name), h('div', { class: 'small dim' }, se.block || '', se.swapped_from ? ` · สลับจาก ${se.swapped_from.name}` : '', se.per_side ? ' · ต่อข้าง' : '')),
        se.status === 'skipped' ? pill('ข้าม') : se.status === 'todo' ? pill('ไม่ได้ทำ', 'warn') : null,
      ),
      mine.length ? h('table', { class: 'tbl mt' },
        h('thead', null, h('tr', null, h('th', null, '#'), h('th', { class: 'num' }, 'kg'), h('th', { class: 'num' }, se.unit === 'sec' ? 'วิ' : se.unit === 'min' ? 'นาที' : 'ครั้ง'), h('th', { class: 'num' }, 'RIR'))),
        h('tbody', null, mine.map((s) => h('tr', null, h('td', null, String(s.index), s.type === 'warmup' ? ' w' : ''), h('td', { class: 'num' }, fmtKg(s.kg)), h('td', { class: 'num' }, s.reps ?? '—'), h('td', { class: 'num' }, s.rir ?? '')))),
      ) : null,
      mine.length ? h('p', { class: 'small muted' }, sum.text, sum.rir !== null ? ` · RIR ${sum.rir}` : '') : null,
      se.note ? h('div', { class: 'note-box' }, se.note) : null,
      ses.status !== 'discarded' ? h('button', { class: 'btn sm ghost mt', onclick: () => openEditSets(ctx, ses.id, se.id, () => { toast('แก้แล้ว — สถิติคำนวณใหม่', { kind: 'ok' }); ctx.rerender(); }) }, mine.length ? 'แก้เซ็ต' : 'เพิ่มเซ็ตย้อนหลัง') : null,
    ));
  });

  if (ses.hidden?.length) root.append(h('details', null, h('summary', null, `ของแนนบนการ์ดใบนี้ ${ses.hidden.length} ท่า (ไม่ได้จด)`), ses.hidden.map((hd) => h('p', { class: 'small muted' }, hd.name, ' · ', hd.dose))));

  const note = h('textarea', { placeholder: 'โน้ตเซสชัน (ความรู้สึก · บริเวณที่ไม่สบาย · เครื่องที่เปลี่ยน) — เป็นบันทึกของพี่ ไม่ใช่การวินิจฉัย', value: ses.note || '' });
  note.addEventListener('change', async () => { await repo.setSessionNote(db, ses.id, note.value.trim()); toast('บันทึกโน้ตแล้ว', { kind: 'ok', ms: 1500 }); });
  root.append(h('h2', null, 'โน้ต'), note);

  const actions = h('div', { class: 'col mt' });
  if (ses.status !== 'in_progress') actions.append(h('button', { class: 'btn md ghost', onclick: (e) => busy(e.currentTarget, async () => { await repo.reopenSession(db, ses.id); ctx.navigate(`#/play/${ses.id}`); }) }, ses.status === 'discarded' ? 'กู้คืนแล้วเล่นต่อ' : 'เปิดเล่นต่อ'));
  if (cfg && !ses.demo && ses.status === 'completed') actions.append(h('button', { class: 'btn md ghost', onclick: (e) => busy(e.currentTarget, async () => { await enqueueSession(db, ses.id); const r = await ctx.sync(); if (r) ctx.rerender(); }) }, ses.sync?.sha ? '☁ ส่งซิงก์อีกครั้ง (หลังแก้)' : '☁ ส่งซิงก์'));
  actions.append(h('button', { class: 'btn md ghost danger', onclick: async () => {
    const ok = await confirmModal({ title: 'ลบเซสชันนี้ถาวร?', text: 'ลบทั้งเซสชันและทุกเซ็ต — กู้คืนไม่ได้ (ถ้าซิงก์ไว้ ไฟล์บน GitHub ยังอยู่)', ok: 'ลบถาวร', danger: true });
    if (!ok) return;
    await repo.deleteSession(db, ses.id);
    toast('ลบแล้ว');
    ctx.navigate('#/history');
  } }, 'ลบเซสชัน'));
  root.append(actions);
}
