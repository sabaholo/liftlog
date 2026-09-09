// ui_play.js — หน้าขณะเล่น: หยิบมือถือ "ก่อนเริ่มท่า" → เห็นท่านี้เต็ม ๆ + จดบรรทัดเดียว + ท่าต่อไป
// จดท่าละบรรทัด (kg · ครั้ง × เซ็ต · RIR) ค่าเริ่มต้น = ครั้งก่อน → บันทึก 1-2 แตะ · "แยกเซ็ต" เมื่อไม่เท่ากัน
// @ts-check
import * as repo from './repo.js';
import { defaultEntry, validateEntry, matchLibrary, progressOf, unitLabel, nextFocus, summarizeSets } from './model.js';
import { fmtSeconds, debounce, parseNum, fmtKg } from './util.js';
import { h, clear, topBar, pill, toast, setStatus, modal, confirmModal, stepper, chips, busy, fmtLast, field } from './ui_common.js';
import { enqueueSession, getSyncConfig } from './sync.js';

let draftFlush = null;

export async function renderPlay(ctx, root, params) {
  const id = params[0];
  const db = ctx.db;
  const ses = await repo.getSession(db, id);
  clear(root);
  if (!ses) { root.append(topBar('ไม่พบเซสชัน', { back: () => ctx.navigate('#/today') })); return; }
  if (ses.status !== 'in_progress') { ctx.navigate(`#/history/${id}`); return; }

  const keys = ses.exercises.map((e) => e.key);
  const [lastMap, library] = await Promise.all([repo.lastTimeMap(db, keys, { excludeSessionId: id }), repo.listExercises(db)]);
  const p = progressOf(ses);
  const pct = p.total ? Math.round(((p.done + p.skipped) / p.total) * 100) : 0;

  root.append(topBar(ses.card.title, {
    back: () => ctx.navigate('#/today'),
    right: h('button', { class: 'btn sm', onclick: () => openList(ctx, ses) }, `รายการ ${p.done + p.skipped}/${p.total}`),
  }));
  root.append(h('div', { class: 'progress' }, h('i', { style: { width: `${pct}%` } })));
  if (ses.demo) root.append(h('div', { class: 'mb' }, pill('ตัวอย่าง — ไม่เข้าสถิติ', 'warn')));

  if (ses.rules?.length || ses.stop_now?.length) {
    root.append(h('details', null,
      h('summary', null, 'กติกาใบนี้'),
      ses.rules?.length ? h('ul', { class: 'small muted' }, ses.rules.map((r) => h('li', null, r))) : null,
      ses.stop_now?.length ? h('div', { class: 'warn-box' }, h('b', null, 'หยุดทันทีถ้า: '), ses.stop_now.join(' · ')) : null,
    ));
  }

  if (ses.timer) root.append(timerWidget(ctx, ses));

  if (ses.focus_index >= 0 && ses.exercises[ses.focus_index]) {
    const se = ses.exercises[ses.focus_index];
    root.append(focusCard(ctx, ses, se, lastMap.get(se.key) || null, library));
    const ni = nextFocus(ses.exercises, ses.focus_index);
    if (ni >= 0 && ni !== ses.focus_index) root.append(nextPreview(ctx, ses, ses.exercises[ni], lastMap.get(ses.exercises[ni].key) || null));
  } else {
    root.append(allDone(ctx, ses));
  }

  if (ses.hidden?.length) {
    root.append(h('details', null,
      h('summary', null, `ของแนน ${ses.hidden.length} ท่า — ดูอย่างเดียว (จดให้เธอ = รุ่นถัดไป)`),
      ses.hidden.map((hd) => h('div', { class: 'note-box' }, h('b', null, hd.name), ' ', h('span', { class: 'dim' }, hd.dose), hd.cue ? h('div', { class: 'small dim' }, hd.cue) : null)),
    ));
  }

  root.append(h('div', { class: 'row mt' },
    h('button', { class: 'btn md ghost', onclick: () => addExerciseFlow(ctx, ses, library) }, '＋ เพิ่มท่า'),
    h('button', { class: 'btn md', onclick: (e) => busy(e.currentTarget, () => finishFlow(ctx, ses)) }, 'จบเซสชัน'),
  ));

  ctx.visibleHandlers.add(() => ctx.rerender());
  ctx.hiddenHandlers.add(() => { if (draftFlush) draftFlush(); });
}

// ---------- การ์ดท่าที่กำลังจะเล่น + แถบจด ----------
function focusCard(ctx, ses, se, last, library) {
  const db = ctx.db;
  const lib = matchLibrary(se.key, library);
  const isTime = se.unit === 'sec' || se.unit === 'min';
  const draft = se.draft && typeof se.draft === 'object' ? { ...defaultEntry(se, last), ...se.draft } : defaultEntry(se, last);
  const state = { kg: draft.kg ?? null, reps: draft.reps ?? null, sets: draft.sets ?? 3, rir: draft.rir ?? null, split: !!draft.split, rows: Array.isArray(draft.rows) ? draft.rows : null };

  const saveDraft = debounce(() => { repo.saveDraft(db, ses.id, se.id, { ...state }).catch(() => {}); }, 500);
  draftFlush = () => saveDraft.flush();

  // ใช้ h() เท่านั้น — Element.append(null) ของเบราว์เซอร์จะพิมพ์คำว่า "null" ออกหน้าจอ
  const card = h('div', { class: 'card focus' },
    h('div', { class: 'sub' }, se.block || '', se.tags?.includes('optional') ? ' · ถ้าเหลือเวลา' : ''),
    h('div', { class: 'title' }, se.name),
    h('div', null,
      se.swapped_from ? pill(`สลับจาก ${se.swapped_from.name}`, 'info') : null,
      se.per_side ? pill('ต่อข้าง') : null,
      se.equip ? pill(se.equip) : null,
      lib?.knee_load ? pill(`เข่า ${lib.knee_load}`, kneeKind(lib.knee_load)) : (se.knee ? pill(`เข่า ${se.knee}`) : null),
    ),
    se.dose ? h('p', { class: 'muted' }, 'เป้า: ', h('b', null, se.dose)) : null,
    last
      ? h('p', { class: 'accent' }, 'ครั้งก่อน: ', h('b', null, fmtLast(last)))
      : h('p', { class: 'dim' }, 'ยังไม่มีข้อมูลครั้งก่อนของท่านี้ — วันนี้คือ baseline'),
    se.cue ? h('div', { class: 'cue' }, se.cue) : (lib?.cues ? h('div', { class: 'cue' }, lib.cues) : null),
    se.warn ? h('div', { class: 'warn-box' }, se.warn) : null,
    lib?.flags && !/^ไม่มี/u.test(lib.flags) ? h('div', { class: 'warn-box small' }, h('b', null, 'ธงของพี่: '), lib.flags) : null,
    se.alt ? h('div', { class: 'alt-box' }, h('b', null, 'เครื่องไม่ว่าง → '), se.alt) : null,
    lib ? h('p', { class: 'small' }, h('a', { href: `#/library/${encodeURIComponent(lib.key)}` }, '📚 ดูท่าในคลัง'), lib.machine_notes ? h('span', { class: 'dim' }, ` · โน้ตเครื่อง: ${lib.machine_notes}`) : '') : null,
    se.note ? h('div', { class: 'note-box' }, '📝 ', se.note) : null,
  );

  // ---- แถบจด ----
  const bar = h('div', { class: 'col mt' });
  let kgS = null; let repsS = null; let setsS = null;
  if (se.weight) {
    kgS = stepper({ label: 'น้ำหนัก', unit: 'kg', value: state.kg, step: ctx.settings.kgStep, min: 0, max: 999, decimals: 1, onChange: (v) => { state.kg = v; syncRows(); saveDraft(); } });
    bar.append(kgS.el);
  }
  repsS = stepper({ label: isTime ? unitLabel(se.unit) : 'ครั้ง', value: state.reps, step: 1, min: 0, max: 999, decimals: 0, emptyText: se.weight ? 'แตะใส่' : 'ไม่ระบุ', onChange: (v) => { state.reps = v; syncRows(); saveDraft(); } });
  setsS = stepper({ label: 'เซ็ต', value: state.sets, step: 1, min: 1, max: 20, decimals: 0, onChange: (v) => { state.sets = v ?? 1; syncRows(); saveDraft(); } });
  bar.append(h('div', { class: 'row tight' }, repsS.el, setsS.el));

  const rirC = chips({ options: [{ v: 0, label: '0' }, { v: 1, label: '1' }, { v: 2, label: '2' }, { v: 3, label: '3' }, { v: 4, label: '4+' }], value: state.rir, small: true, onChange: (v) => { state.rir = v; saveDraft(); } });
  bar.append(h('div', { class: 'spread' }, h('span', { class: 'small dim' }, 'เหลืออีกกี่ครั้งตอนจบเซ็ตสุดท้าย (RIR)'), null), rirC.el);

  const splitBox = h('div', { class: state.split ? '' : 'hidden' });
  const splitBtn = h('button', { class: 'btn sm ghost', onclick: () => { state.split = !state.split; splitBox.className = state.split ? '' : 'hidden'; if (state.split) syncRows(true); saveDraft(); } }, state.split ? 'รวมเซ็ต' : 'แยกเซ็ต (ไม่เท่ากัน)');
  bar.append(h('div', { class: 'row' }, splitBtn, se.rest_sec ? h('button', { class: 'btn sm ghost', onclick: () => startTimer(ctx, ses, se.rest_sec, se.id) }, `⏱ พัก ${fmtSeconds(se.rest_sec)}`) : (se.timer_sec ? h('button', { class: 'btn sm ghost', onclick: () => startTimer(ctx, ses, se.timer_sec, se.id) }, `⏱ จับเวลา ${fmtSeconds(se.timer_sec)}`) : null)));
  bar.append(splitBox);

  function syncRows(force = false) {
    if (!state.split && !force) return;
    const n = Math.max(1, Math.min(20, state.sets || 1));
    const rows = state.rows && state.rows.length ? state.rows.slice(0, n) : [];
    while (rows.length < n) rows.push({ kg: state.kg, reps: state.reps });
    state.rows = rows;
    clear(splitBox);
    splitBox.append(h('div', { class: 'sethead' }, h('span', null, '#'), h('span', null, se.weight ? 'kg' : ''), h('span', null, isTime ? unitLabel(se.unit) : 'ครั้ง'), h('span', null, ''), h('span', null, '')));
    rows.forEach((r, i) => {
      const kgIn = h('input', { type: 'number', inputmode: 'decimal', step: '0.5', value: r.kg ?? '', hidden: !se.weight, oninput: (e) => { r.kg = parseNum(e.target.value); saveDraft(); } });
      const repsIn = h('input', { type: 'number', inputmode: 'numeric', value: r.reps ?? '', oninput: (e) => { r.reps = parseNum(e.target.value); saveDraft(); } });
      splitBox.append(h('div', { class: 'setrow' }, h('span', { class: 'idx' }, String(i + 1)), kgIn, repsIn, h('span'), h('span')));
    });
  }
  if (state.split) syncRows(true);

  const saveBtn = h('button', { class: 'btn primary' }, se.weight || isTime ? 'บันทึก' : 'เสร็จท่านี้');
  saveBtn.addEventListener('click', () => busy(saveBtn, async () => {
    saveDraft.flush();
    setStatus('saving');
    try {
      let result;
      if (state.split && state.rows) {
        const rows = state.rows.map((r) => ({ kg: se.weight ? (r.kg ?? null) : null, reps: r.reps ?? null, rir: null }));
        for (const r of rows) { const v = validateEntry(se, { kg: r.kg, reps: r.reps, sets: 1 }); if (!v.ok) throw new Error(v.errors.join(' · ')); }
        if (rows.length) rows[rows.length - 1].rir = state.rir;
        result = await repo.updateSets(db, ses.id, se.id, rows);
        const ni = nextFocus(result.session.exercises, se.order);
        await repo.setFocus(db, ses.id, ni);
      } else {
        const entry = { kg: se.weight ? state.kg : null, reps: state.reps, sets: state.sets, rir: state.rir, type: 'working' };
        const v = validateEntry(se, entry);
        if (!v.ok) throw new Error(v.errors.join(' · '));
        result = await repo.logExercise(db, ses.id, se.id, entry);
      }
      setStatus('saved');
      const sum = summarizeSets(result.sets);
      toast(`✓ ${se.name} — ${sum.text}`, { kind: 'ok', ms: 7000, action: { label: 'เลิกทำ', fn: async () => { await repo.undoLog(db, ses.id, se.id); toast('เลิกทำแล้ว'); ctx.rerender(); } } });
      if (ctx.settings.autoRest && se.rest_sec) { await repo.setTimer(db, ses.id, { end_at: Date.now() + se.rest_sec * 1000, seconds: se.rest_sec, se_id: se.id }); }
      ctx.rerender();
    } catch (e) {
      setStatus('error');
      toast(e instanceof Error ? e.message : String(e), { kind: 'err' });
    }
  }));
  bar.append(saveBtn);
  bar.append(h('div', { class: 'row' },
    h('button', { class: 'btn md ghost', onclick: (e) => busy(e.currentTarget, async () => { await repo.skipExercise(db, ses.id, se.id); toast(`ข้าม ${se.name}`); ctx.rerender(); }) }, 'ข้าม'),
    h('button', { class: 'btn md ghost', onclick: () => busyMenu(ctx, ses, se, library) }, 'เครื่องไม่ว่าง ▾'),
  ));
  card.append(bar);
  return card;
}

function lastEntryText(le) {
  if (!le) return '';
  const parts = [];
  if (le.kg !== null && le.kg !== undefined) parts.push(`${fmtKg(le.kg)} kg`);
  if (le.reps !== null && le.reps !== undefined) parts.push(String(le.reps));
  parts.push(`${le.sets} เซ็ต`);
  return parts.join(' × ') + (le.rir !== null && le.rir !== undefined ? ` · RIR ${le.rir}` : '');
}

function kneeKind(level) {
  const l = String(level).toUpperCase();
  if (l.startsWith('LOW')) return 'ok';
  if (l.startsWith('HIGH')) return 'danger';
  return 'warn';
}

function nextPreview(ctx, ses, nxt, last) {
  return h('div', { class: 'next', onclick: async () => { await repo.setFocus(ctx.db, ses.id, nxt.order); ctx.rerender(); } },
    h('span', { class: 'dim' }, '▸'),
    h('div', { class: 'grow' },
      h('div', { class: 't' }, 'ต่อไป: ', nxt.name),
      h('div', { class: 'small' }, nxt.dose || '', last ? ` · ครั้งก่อน ${last.summary.text}` : ' · ยังไม่มีข้อมูลครั้งก่อน'),
    ),
  );
}

function allDone(ctx, ses) {
  const p = progressOf(ses);
  return h('div', { class: 'card focus' },
    h('div', { class: 'title' }, p.total ? 'ครบทุกท่าแล้ว' : 'ยังไม่มีท่าในเซสชัน'),
    h('p', { class: 'muted' }, p.total ? `ทำ ${p.done} · ข้าม ${p.skipped}` : 'กด "เพิ่มท่า" เพื่อเลือกจากคลัง หรือพิมพ์ชื่อเอง'),
    p.total ? h('button', { class: 'btn primary mt', onclick: (e) => busy(e.currentTarget, () => finishFlow(ctx, ses)) }, 'จบเซสชัน') : null,
  );
}

// ---------- timer: เก็บ end_at แล้วคำนวณใหม่เมื่อกลับเข้าแอป ----------
async function startTimer(ctx, ses, seconds, seId) {
  await repo.setTimer(ctx.db, ses.id, { end_at: Date.now() + seconds * 1000, seconds, se_id: seId || null });
  ctx.rerender();
}
function timerWidget(ctx, ses) {
  const t = ses.timer;
  const disp = h('span', { class: 't' });
  const el = h('div', { class: 'timer' },
    h('span', { class: 'dim small' }, '⏱ พัก'),
    disp,
    h('button', { class: 'btn sm ghost', onclick: async () => { await repo.setTimer(ctx.db, ses.id, { ...t, end_at: Math.max(Date.now(), t.end_at) + 30000 }); ctx.rerender(); } }, '+30'),
    h('button', { class: 'btn sm ghost', onclick: async () => { await repo.setTimer(ctx.db, ses.id, null); ctx.rerender(); } }, 'ข้ามพัก'),
  );
  const tick = () => {
    if (!el.isConnected) { clearInterval(iv); return; }
    const left = Math.round((t.end_at - Date.now()) / 1000);
    if (left <= 0) { disp.textContent = 'ครบแล้ว'; el.classList.add('done'); }
    else disp.textContent = fmtSeconds(left);
  };
  const iv = setInterval(tick, 500);
  tick();
  return el;
}

// ---------- รายการท่าทั้งใบ (แตะเพื่อไปท่านั้น · จัดการ) ----------
function openList(ctx, ses) {
  const db = ctx.db;
  const list = h('div', { class: 'list' }, ses.exercises.map((e, i) => {
    const mark = e.status === 'done' ? '✓' : e.status === 'skipped' ? '—' : i === ses.focus_index ? '▸' : '·';
    const cls = `item ${e.status === 'done' ? 'done' : ''} ${e.status === 'skipped' ? 'skip' : ''} ${i === ses.focus_index ? 'cur' : ''}`;
    const actions = [];
    if (e.status === 'todo') actions.push(h('button', { class: 'btn sm ghost', onclick: async (ev) => { ev.stopPropagation(); await repo.moveToEnd(db, ses.id, e.id); m.close(); ctx.rerender(); } }, 'ไว้ท้าย'));
    if (e.status === 'done') actions.push(h('button', { class: 'btn sm ghost', onclick: (ev) => { ev.stopPropagation(); m.close(); openEditSets(ctx, ses.id, e.id, () => ctx.rerender()); } }, 'แก้'));
    if (e.status === 'skipped') actions.push(h('button', { class: 'btn sm ghost', onclick: async (ev) => { ev.stopPropagation(); await repo.unskipExercise(db, ses.id, e.id); m.close(); ctx.rerender(); } }, 'เอากลับ'));
    if (e.status !== 'done' && e.source === 'added') actions.push(h('button', { class: 'btn sm ghost danger', onclick: async (ev) => { ev.stopPropagation(); await repo.removeExercise(db, ses.id, e.id); m.close(); ctx.rerender(); } }, 'ลบ'));
    return h('div', { class: cls, onclick: async () => { if (e.status === 'todo') { await repo.setFocus(db, ses.id, i); m.close(); ctx.rerender(); } } },
      h('span', { class: 'mark' }, mark),
      h('div', { class: 'grow' }, h('div', { class: 't' }, e.name), h('div', { class: 's' }, e.last_entry ? lastEntryText(e.last_entry) : (e.dose || ''))),
      ...actions,
    );
  }));
  const m = modal({
    title: 'รายการท่า',
    body: h('div', null, list, h('button', { class: 'btn md danger mt', onclick: async () => {
      const ok = await confirmModal({ title: 'ทิ้งเซสชันนี้?', text: 'เซ็ตที่จดไปแล้วจะไม่เข้าสถิติ (ยังกู้คืนได้จากหน้าประวัติ)', ok: 'ทิ้ง', danger: true });
      if (!ok) return;
      await repo.endSession(db, ses.id, { discard: true });
      m.close();
      toast('ทิ้งเซสชันแล้ว');
      ctx.navigate('#/today');
    } }, 'ทิ้งเซสชันนี้')),
    actions: [{ label: 'ปิด', kind: 'ghost' }],
  });
}

// ---------- แก้เซ็ตย้อนหลัง (ใช้ทั้งหน้าเล่นและหน้าประวัติ) ----------
export async function openEditSets(ctx, sessionId, seId, onDone) {
  const db = ctx.db;
  const ses = await repo.getSession(db, sessionId);
  const se = ses.exercises.find((e) => e.id === seId);
  const existing = (await repo.getSessionSets(db, sessionId)).filter((s) => s.session_exercise_id === seId && s.status !== 'discarded');
  const rows = existing.length ? existing.map((s) => ({ id: s.id, kg: s.kg, reps: s.reps, rir: s.rir, type: s.type })) : [{ kg: se.last_entry?.kg ?? null, reps: se.last_entry?.reps ?? se.reps_lo ?? null, rir: null, type: 'working' }];
  const box = h('div');
  const paint = () => {
    clear(box);
    box.append(h('div', { class: 'sethead' }, h('span', null, '#'), h('span', null, 'kg'), h('span', null, unitLabel(se.unit)), h('span', null, 'RIR'), h('span', null, '')));
    rows.forEach((r, i) => box.append(h('div', { class: 'setrow' },
      h('span', { class: 'idx' }, String(i + 1)),
      h('input', { type: 'number', inputmode: 'decimal', step: '0.5', value: r.kg ?? '', oninput: (e) => { r.kg = parseNum(e.target.value); } }),
      h('input', { type: 'number', inputmode: 'numeric', value: r.reps ?? '', oninput: (e) => { r.reps = parseNum(e.target.value); } }),
      h('input', { type: 'number', inputmode: 'numeric', value: r.rir ?? '', oninput: (e) => { const v = parseNum(e.target.value); r.rir = v === null ? null : Math.round(v); } }),
      h('button', { class: 'x', type: 'button', onclick: () => { rows.splice(i, 1); paint(); } }, '×'),
    )));
    box.append(h('button', { class: 'btn sm ghost mt', onclick: () => { const l = rows[rows.length - 1]; rows.push({ kg: l?.kg ?? null, reps: l?.reps ?? null, rir: null, type: 'working' }); paint(); } }, '＋ เพิ่มเซ็ต'));
  };
  paint();
  modal({
    title: `แก้เซ็ต — ${se.name}`,
    body: h('div', null, h('p', { class: 'small dim' }, 'แก้แล้วกราฟ/ครั้งก่อนคำนวณใหม่จากค่านี้ · ลบทุกแถว = ท่านี้กลับเป็นยังไม่ทำ'), box),
    actions: [
      { label: 'ยกเลิก', kind: 'ghost' },
      { label: 'บันทึก', kind: 'primary', fn: async () => {
        try {
          for (const r of rows) { const v = validateEntry(se, { kg: r.kg, reps: r.reps, sets: 1, rir: r.rir }); if (!v.ok) throw new Error(v.errors.join(' · ')); }
          setStatus('saving');
          await repo.updateSets(db, sessionId, seId, rows);
          setStatus('saved');
          onDone?.();
        } catch (e) { setStatus('error'); toast(e instanceof Error ? e.message : String(e), { kind: 'err' }); return false; }
      } },
    ],
  });
}

// ---------- เครื่องไม่ว่าง: ใช้ท่าสำรอง · เลื่อนท้าย · เลือกจากคลัง · พิมพ์เอง ----------
function busyMenu(ctx, ses, se, library) {
  const db = ctx.db;
  const alts = String(se.alt || '').split(/\s*(?:\/|หรือ|·|→)\s*/u).map((s) => s.replace(/^ไม่ว่าง\s*/u, '').trim()).filter((s) => s.length > 1 && s.length < 80);
  const body = h('div', { class: 'col' },
    alts.map((a) => h('button', { class: 'btn md', onclick: async () => { await repo.swapExercise(db, ses.id, se.id, { key: a, name: a }); m.close(); toast(`สลับเป็น ${a}`); ctx.rerender(); } }, `ใช้: ${a}`)),
    h('button', { class: 'btn md ghost', onclick: async () => { await repo.moveToEnd(db, ses.id, se.id); m.close(); toast('เลื่อนไปท้ายรายการแล้ว'); ctx.rerender(); } }, 'เลื่อนไปท้ายรายการ'),
    h('button', { class: 'btn md ghost', onclick: () => { m.close(); pickExercise(ctx, library, { title: 'สลับเป็นท่า…', onPick: async (ex) => { await repo.swapExercise(db, ses.id, se.id, { key: ex.key, name: ex.name || ex.key, weight: ex.weight }); toast(`สลับเป็น ${ex.name || ex.key}`); ctx.rerender(); } }); } }, 'เลือกจากคลัง / พิมพ์เอง'),
  );
  const m = modal({ title: `${se.name} — เครื่องไม่ว่าง`, body, actions: [{ label: 'ปิด', kind: 'ghost' }] });
}

function addExerciseFlow(ctx, ses, library) {
  pickExercise(ctx, library, { title: 'เพิ่มท่าเข้าเซสชัน', onPick: async (ex) => { await repo.addExercise(ctx.db, ses.id, { key: ex.key, name: ex.name || ex.key, weight: ex.weight, equip: ex.equipment || '', cue: ex.cues || '', alt: ex.alternatives || '', knee: ex.knee_load || '', source: 'added' }); toast(`เพิ่ม ${ex.name || ex.key} แล้ว`); ctx.rerender(); } });
}

/** ค้นคลัง + พิมพ์ชื่อเอง — onPick({key,name,weight,...}) */
export function pickExercise(ctx, library, { title, onPick }) {
  const results = h('div', { class: 'list mt' });
  const q = h('input', { type: 'search', placeholder: 'ค้นชื่อท่า (ไทย/อังกฤษ)', autocomplete: 'off' });
  const custom = h('div', { class: 'row mt' });
  const paint = () => {
    const term = q.value.trim().toLowerCase();
    clear(results);
    const hits = library.filter((e) => !e.archived && (!term || `${e.name} ${e.key} ${e.name_th || ''} ${e.group || ''}`.toLowerCase().includes(term))).slice(0, 30);
    hits.forEach((e) => results.append(h('div', { class: 'item', onclick: async () => { m.close(); await onPick({ ...e, weight: e.weight === undefined ? !/bodyweight|น้ำหนักตัว/i.test(e.equipment || '') : e.weight }); } },
      h('div', { class: 'grow' }, h('div', { class: 't' }, e.name || e.key), h('div', { class: 's' }, [e.group, e.equipment].filter(Boolean).join(' · '))),
      e.knee_load ? pill(e.knee_load, kneeKind(e.knee_load)) : null,
    )));
    clear(custom);
    if (term.length >= 2) custom.append(h('button', { class: 'btn md', onclick: async () => { m.close(); await onPick({ key: q.value.trim(), name: q.value.trim(), weight: true }); } }, `พิมพ์เอง: "${q.value.trim()}" (มีน้ำหนัก)`), h('button', { class: 'btn md ghost', onclick: async () => { m.close(); await onPick({ key: q.value.trim(), name: q.value.trim(), weight: false }); } }, 'ไม่มีน้ำหนัก'));
    if (!hits.length && term.length < 2) results.append(h('p', { class: 'dim small' }, library.length ? 'พิมพ์เพื่อค้น' : 'คลังท่ายังว่าง — พิมพ์ชื่อท่าเองได้'));
  };
  q.addEventListener('input', paint);
  paint();
  const m = modal({ title, body: h('div', null, q, custom, results), actions: [{ label: 'ปิด', kind: 'ghost' }] });
  setTimeout(() => q.focus(), 50);
}

// ---------- จบเซสชัน ----------
async function finishFlow(ctx, ses) {
  const db = ctx.db;
  const fresh = await repo.getSession(db, ses.id);
  const p = progressOf(fresh);
  const ok = await confirmModal({
    title: 'จบเซสชัน',
    body: h('div', null,
      h('p', null, `ทำ ${p.done} · ข้าม ${p.skipped}`, p.remaining ? ` · ยังไม่ได้ทำ ${p.remaining} (จะนับเป็นไม่ได้ทำ)` : ''),
      h('p', { class: 'small dim' }, 'จบเท่าที่เล่นจริง — แก้เซ็ตย้อนหลังได้จากหน้าประวัติ'),
    ),
    ok: 'จบเซสชัน',
  });
  if (!ok) return;
  await repo.endSession(db, ses.id, { discard: false });
  const cfg = await getSyncConfig(db);
  if (cfg && !fresh.demo) { await enqueueSession(db, ses.id); ctx.sync({ silent: true }); }
  toast('จบเซสชันแล้ว', { kind: 'ok' });
  ctx.navigate(`#/history/${ses.id}`);
}
