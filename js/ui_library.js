// ui_library.js — คลังท่า: ค้น · กรองกลุ่ม · รายละเอียด (cue/ท่าสำรอง/ธง) · ลิงก์สื่อของผู้ใช้ · โน้ตเครื่อง · ประวัติของท่า
// สื่อ: ไม่มี URL ที่ตรวจแล้วในคลัง ⇒ ช่องให้ผู้ใช้วางลิงก์เอง ห้ามใส่ลิงก์สมมติ
// @ts-check
import * as repo from './repo.js';
import { LOAD_CONVENTIONS } from './model.js';
import { thaiDate, nowIso } from './util.js';
import { h, clear, topBar, pill, toast, modal, confirmModal, chips, field, pickFiles, readFileText, busy, fmtKg } from './ui_common.js';

const state = { q: '', group: 'all' };

export async function renderLibrary(ctx, root, params) {
  if (params[0]) return renderDetail(ctx, root, params[0]);
  const db = ctx.db;
  const [all, logged, active] = await Promise.all([repo.listExercises(db), repo.loggedExerciseKeys(db), repo.activeSession(db)]);
  clear(root);
  root.append(topBar('คลังท่า', { right: h('button', { class: 'btn sm', onclick: () => newExerciseFlow(ctx) }, '＋ ท่าใหม่') }));

  if (!all.length) {
    root.append(h('div', { class: 'card' },
      h('p', { class: 'muted' }, 'คลังท่ายังว่าง'),
      h('p', { class: 'small dim' }, 'คลัง 148 ท่าของพี่อยู่ใน Life OS (kb/fitness/exercise_library) — ส่งมาที่แอปได้ 2 ทาง: ซิงก์ (ตั้งค่า) หรือนำเข้าไฟล์ library.json'),
      h('button', { class: 'btn md mt', onclick: (e) => busy(e.currentTarget, () => importLibrary(ctx)) }, '📥 นำเข้า library.json'),
    ));
  }

  const loggedKeys = new Set(logged.map((l) => l.key));
  const groups = [...new Set(all.map((e) => e.group).filter(Boolean))];
  const q = h('input', { type: 'search', placeholder: 'ค้นชื่อไทย/อังกฤษ · กล้ามเนื้อ · อุปกรณ์', value: state.q, autocomplete: 'off' });
  const list = h('div', { class: 'list mt' });
  const count = h('p', { class: 'small dim' });
  const paint = () => {
    const term = q.value.trim().toLowerCase();
    state.q = q.value;
    clear(list);
    let hits = all.filter((e) => !e.archived);
    if (state.group === 'fav') hits = hits.filter((e) => e.favorite);
    else if (state.group === 'logged') hits = hits.filter((e) => loggedKeys.has(e.key));
    else if (state.group !== 'all') hits = hits.filter((e) => e.group === state.group);
    if (term) hits = hits.filter((e) => `${e.name} ${e.key} ${e.name_th || ''} ${e.muscles || ''} ${e.equipment || ''} ${e.subgroup || ''}`.toLowerCase().includes(term));
    count.textContent = `${hits.length} ท่า`;
    hits.slice(0, 200).forEach((e) => list.append(h('div', { class: 'item', onclick: () => ctx.navigate(`#/library/${encodeURIComponent(e.key)}`) },
      h('div', { class: 'grow' },
        h('div', { class: 't' }, e.favorite ? '★ ' : '', e.name || e.key, e.tags?.includes('benchmark') ? ' 🏆' : ''),
        h('div', { class: 's' }, [e.subgroup, e.equipment].filter(Boolean).join(' · ')),
      ),
      e.knee_load ? pill(e.knee_load, kneeKind(e.knee_load)) : null,
      loggedKeys.has(e.key) ? pill('เคยจด', 'ok') : null,
    )));
    if (!hits.length && all.length) list.append(h('p', { class: 'empty' }, 'ไม่พบ — ลองคำอื่น หรือกด "＋ ท่าใหม่"'));
  };
  q.addEventListener('input', paint);
  const groupChips = chips({
    options: [{ v: 'all', label: 'ทั้งหมด' }, { v: 'fav', label: '★' }, { v: 'logged', label: 'เคยจด' }, ...groups.map((g) => ({ v: g, label: g }))],
    value: state.group, small: true, allowNone: false,
    onChange: (v) => { state.group = v || 'all'; paint(); },
  });
  root.append(q, h('div', { class: 'mt' }, groupChips.el), count, list);
  paint();

  // ท่าที่เคยจดแต่ไม่อยู่ในคลัง (พิมพ์เอง/สลับเอง) — ยังเปิดดูประวัติได้
  const orphan = logged.filter((l) => !all.some((e) => e.key === l.key));
  if (orphan.length) {
    root.append(h('h2', null, 'เคยจด แต่ยังไม่มีในคลัง'));
    root.append(h('div', { class: 'list' }, orphan.map((l) => h('div', { class: 'item', onclick: () => ctx.navigate(`#/library/${encodeURIComponent(l.key)}`) },
      h('div', { class: 'grow' }, h('div', { class: 't' }, l.name || l.key), h('div', { class: 's' }, `${l.count} เซ็ต · ล่าสุด ${thaiDate(l.last.slice(0, 10))}`)),
    ))));
  }
  void active;
}

function kneeKind(level) {
  const l = String(level).toUpperCase();
  if (l.startsWith('LOW')) return 'ok';
  if (l.startsWith('HIGH')) return 'danger';
  return 'warn';
}

export async function importLibrary(ctx) {
  const files = await pickFiles({ accept: '.json,application/json' });
  if (!files.length) return;
  try {
    const data = JSON.parse(await readFileText(files[0]));
    const list = Array.isArray(data) ? data : Array.isArray(data?.exercises) ? data.exercises : null;
    if (!list) throw new Error('ไฟล์ไม่มี exercises[]');
    const n = await repo.upsertLibrary(ctx.db, list);
    toast(`นำเข้าคลังท่า ${n} ท่า`, { kind: 'ok' });
    ctx.rerender();
  } catch (e) {
    toast(`นำเข้าไม่ได้: ${e instanceof Error ? e.message : String(e)}`, { kind: 'err' });
  }
}

async function renderDetail(ctx, root, key) {
  const db = ctx.db;
  let ex = await repo.getExercise(db, key);
  const [history, active] = await Promise.all([repo.exerciseHistory(db, key), repo.activeSession(db)]);
  clear(root);
  root.append(topBar(ex ? (ex.name || ex.key) : key, { back: () => ctx.navigate('#/library') }));

  if (!ex) {
    root.append(h('div', { class: 'card' },
      h('p', { class: 'muted' }, 'ท่านี้ยังไม่มีในคลัง (มาจากการพิมพ์เอง/สลับเอง)'),
      h('button', { class: 'btn md', onclick: async () => { await repo.putExercise(db, { key, name: key, group: 'เพิ่มเอง', source: 'user', media: [], created_at: nowIso() }); ctx.rerender(); } }, 'สร้างท่านี้ในคลัง'),
    ));
  } else {
    const card = h('div', { class: 'card' },
      h('div', null,
        ex.group ? pill(ex.group) : null,
        ex.subgroup ? pill(ex.subgroup) : null,
        ex.knee_load ? pill(`เข่า ${ex.knee_load}`, kneeKind(ex.knee_load)) : null,
        ex.gym_has === true ? pill('ยิมมี ✅', 'ok') : ex.gym_has === false ? pill('ยิมไม่มี ❌', 'danger') : ex.gym_has === null && ex.source !== 'user' ? pill('ยิมมี? ยังไม่เช็ค', 'warn') : null,
        ex.tags?.includes('benchmark') ? pill('🏆 เบนช์มาร์ก', 'accent') : null,
        ex.source === 'user' ? pill('เพิ่มเอง') : null,
      ),
      h('div', { class: 'kv mt' },
        ex.muscles ? [h('b', null, 'กล้ามเนื้อ'), h('span', null, ex.muscles)] : null,
        ex.equipment ? [h('b', null, 'อุปกรณ์'), h('span', null, ex.equipment)] : null,
        ex.knee_note ? [h('b', null, 'โหลดเข่า'), h('span', null, ex.knee_note)] : null,
      ),
      ex.cues ? h('div', { class: 'cue' }, h('b', null, 'จุดคุมฟอร์ม: '), ex.cues) : null,
      ex.flags ? h('div', { class: /^ไม่มี/u.test(ex.flags) ? 'note-box' : 'warn-box' }, h('b', null, 'ธงของพี่: '), ex.flags) : null,
      ex.alternatives ? h('div', { class: 'alt-box' }, h('b', null, 'ท่าสำรอง: '), ex.alternatives) : null,
      ex.see_also ? h('p', { class: 'small dim' }, ex.see_also) : null,
      ex.source_file ? h('p', { class: 'tiny dim' }, `ที่มา: ${ex.source_file}`) : null,
    );
    root.append(card);

    // ---- สื่อ: ลิงก์ของผู้ใช้ ----
    root.append(h('h2', null, 'ดูท่า (วิดีโอ/รูป)'));
    const media = h('div', { class: 'list' });
    const paintMedia = () => {
      clear(media);
      (ex.media || []).forEach((m, i) => media.append(h('div', { class: 'item' },
        h('a', { class: 'grow', href: m.url, target: '_blank', rel: 'noopener noreferrer' }, h('div', { class: 't' }, m.label || m.url), h('div', { class: 's' }, m.url, ' · ต้องใช้อินเทอร์เน็ต')),
        h('button', { class: 'btn sm ghost danger', onclick: async () => { ex.media.splice(i, 1); await repo.putExercise(db, ex); paintMedia(); } }, '×'),
      )));
      if (!(ex.media || []).length) media.append(h('p', { class: 'small dim' }, 'ยังไม่มีสื่อที่ตรวจแล้วสำหรับท่านี้ — วางลิงก์ที่พี่ใช้จริงได้ (YouTube ฯลฯ) · ขณะออฟไลน์ยังอ่าน cue และจดได้ตามปกติ'));
    };
    paintMedia();
    root.append(media, h('button', { class: 'btn md ghost mt', onclick: () => addMediaFlow(ctx, ex, paintMedia) }, '＋ เพิ่มลิงก์'));

    // ---- โน้ตเครื่อง / วิธีนับน้ำหนัก ----
    root.append(h('h2', null, 'ของพี่เอง'));
    const notes = h('textarea', { placeholder: 'โน้ตเครื่อง: เบาะตำแหน่ง · ที่จับ · เครื่อง A/B · ค่าที่ตั้ง', value: ex.machine_notes || '' });
    notes.addEventListener('change', async () => { ex.machine_notes = notes.value.trim(); await repo.putExercise(db, ex); toast('บันทึกโน้ตแล้ว', { kind: 'ok', ms: 1500 }); });
    const conv = h('select', null, Object.entries(LOAD_CONVENTIONS).map(([k, v]) => h('option', { value: k, selected: (ex.load_convention || 'unknown') === k }, v)));
    conv.addEventListener('change', async () => { ex.load_convention = conv.value; await repo.putExercise(db, ex); toast('เปลี่ยนวิธีนับน้ำหนัก — ประวัติเก่าไม่ถูกแปลง เทียบใหม่นับจากนี้', { ms: 5000 }); });
    const fav = h('button', { class: 'btn md ghost', onclick: async () => { ex.favorite = !ex.favorite; await repo.putExercise(db, ex); ctx.rerender(); } }, ex.favorite ? '★ อยู่ในรายการโปรด' : '☆ เพิ่มรายการโปรด');
    root.append(notes, h('label', { class: 'f' }, 'วิธีนับน้ำหนักของท่านี้'), conv, h('div', { class: 'mt' }, fav));
    if (active) root.append(h('button', { class: 'btn md mt', onclick: async () => { await repo.addExercise(db, active.id, { key: ex.key, name: ex.name || ex.key, weight: !/bodyweight|น้ำหนักตัว/i.test(ex.equipment || ''), equip: ex.equipment || '', cue: ex.cues || '', alt: ex.alternatives || '', knee: ex.knee_load || '' }); toast('เพิ่มเข้าเซสชันแล้ว', { kind: 'ok' }); ctx.navigate(`#/play/${active.id}`); } }, '＋ เพิ่มเข้าเซสชันที่กำลังเล่น'));
    if (ex.source === 'user') root.append(h('button', { class: 'btn md ghost danger mt', onclick: async () => { const ok = await confirmModal({ title: 'ลบท่านี้ออกจากคลัง?', text: 'ประวัติที่จดไว้ยังอยู่', ok: 'ลบ', danger: true }); if (!ok) return; await repo.deleteExercise(db, ex.key); ctx.navigate('#/library'); } }, 'ลบท่านี้ออกจากคลัง'));
  }

  // ---- ประวัติของท่านี้ ----
  root.append(h('h2', null, `ประวัติ (${history.length} ครั้ง)`));
  if (!history.length) root.append(h('p', { class: 'dim small' }, 'ยังไม่มีข้อมูล — จุดแรกจะขึ้นหลังจดครั้งแรก'));
  else {
    const maxKg = Math.max(...history.map((g) => g.summary.top_kg ?? 0), 0);
    root.append(h('div', { class: 'card' }, history.slice(0, 30).map((g) => h('div', { class: 'bar', onclick: () => ctx.navigate(`#/history/${g.session_id}`) },
      h('span', { class: 'lb' }, g.date.slice(5).replace('-', '/')),
      maxKg > 0 && g.summary.top_kg !== null ? h('i', { style: { width: `${Math.max(2, Math.round((g.summary.top_kg / maxKg) * 100))}%` } }) : h('i', { style: { width: '2px' } }),
      h('span', { class: 'v' }, g.summary.text, g.summary.rir !== null ? ` · RIR ${g.summary.rir}` : ''),
    ))));
    root.append(h('p', { class: 'tiny dim' }, 'แท่ง = น้ำหนักสูงสุดของ working set ในวันนั้น (เทียบในท่าเดียวกันเท่านั้น) · แตะแถวเพื่อเปิดเซสชัน'));
  }
}

function addMediaFlow(ctx, ex, onDone) {
  const label = field({ label: 'ชื่อ (เช่น คลิปฟอร์ม ช่อง X)', placeholder: 'ป้าย' });
  const url = field({ label: 'ลิงก์ (http/https)', type: 'url', placeholder: 'https://…', inputmode: 'url' });
  modal({
    title: 'เพิ่มลิงก์สื่อ',
    body: h('div', null, label.el, url.el, h('p', { class: 'small dim' }, 'ใช้ลิงก์ที่พี่ดูแล้วว่าใช่จริง — แอปไม่สร้างลิงก์ให้')),
    actions: [
      { label: 'ยกเลิก', kind: 'ghost' },
      { label: 'เพิ่ม', kind: 'primary', fn: async () => {
        const u = url.input.value.trim();
        if (!/^https?:\/\/\S+$/i.test(u)) { toast('ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://', { kind: 'err' }); return false; }
        ex.media = ex.media || [];
        ex.media.push({ url: u, label: label.input.value.trim() || u, added_at: nowIso() });
        await repo.putExercise(ctx.db, ex);
        onDone();
      } },
    ],
  });
}

function newExerciseFlow(ctx) {
  const name = field({ label: 'ชื่อท่า (กุญแจสถิติ — สะกดให้เหมือนเดิมทุกครั้ง)', placeholder: 'เช่น Machine Row (เครื่อง B)' });
  const group = field({ label: 'กลุ่ม', placeholder: 'ขา / หลัง / อก / ไหล่ / แขน / แกนกลาง …' });
  const equip = field({ label: 'อุปกรณ์', placeholder: 'เครื่อง / ดัมเบล / เคเบิล / bodyweight' });
  let weight = true;
  const w = chips({ options: [{ v: 'y', label: 'มีน้ำหนัก' }, { v: 'n', label: 'ไม่มีน้ำหนัก' }], value: 'y', allowNone: false, small: true, onChange: (v) => { weight = v === 'y'; } });
  modal({
    title: 'เพิ่มท่าของตัวเอง',
    body: h('div', null, name.el, group.el, equip.el, h('label', { class: 'f' }, 'การจด'), w.el),
    actions: [
      { label: 'ยกเลิก', kind: 'ghost' },
      { label: 'บันทึก', kind: 'primary', fn: async () => {
        const n = name.input.value.trim();
        if (!n) { toast('ต้องมีชื่อท่า', { kind: 'err' }); return false; }
        const existing = await repo.getExercise(ctx.db, n);
        if (existing) { toast('มีท่าชื่อนี้อยู่แล้ว', { kind: 'err' }); return false; }
        await repo.putExercise(ctx.db, { key: n, name: n, group: group.input.value.trim() || 'เพิ่มเอง', equipment: equip.input.value.trim(), weight, source: 'user', media: [], created_at: nowIso() });
        toast('เพิ่มท่าแล้ว', { kind: 'ok' });
        ctx.navigate(`#/library/${encodeURIComponent(n)}`);
      } },
    ],
  });
}

export { fmtKg };
