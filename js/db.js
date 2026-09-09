// db.js — IndexedDB ชั้นล่างสุด: เปิด · migrate · transaction helper
// กติกา: ใน body ของ tx() ห้าม await อะไรที่ไม่ใช่ IDB request (เช่น fetch) — transaction จะ commit ทิ้งก่อน
// @ts-check

export const DB_NAME = 'liftlog';
export const DB_VERSION = 1;

export const STORES = Object.freeze({
  exercises: 'exercises',      // คลังท่า (keyPath: key)
  cards: 'cards',              // การ์ดของ Lee ตามสัญญา outputs/lee/sessions/*.json (keyPath: id)
  sessions: 'sessions',        // เซสชัน + ท่าในเซสชัน (embedded) (keyPath: id)
  sets: 'sets',                // เซ็ตรายแถว (keyPath: id) — index by_exercise / by_session / by_completed
  settings: 'settings',        // key/value
  sync_queue: 'sync_queue',    // งานที่รอส่งขึ้น GitHub (device-local)
  body_metrics: 'body_metrics',// น้ำหนักตัว/สายวัด (keyPath: date)
});
export const ALL_STORES = Object.freeze(Object.values(STORES));

export function openDB({ factory = globalThis.indexedDB, name = DB_NAME, version = DB_VERSION } = {}) {
  return new Promise((resolve, reject) => {
    if (!factory) return reject(new Error('IndexedDB ไม่พร้อมใช้งานในเบราว์เซอร์นี้'));
    let req;
    try { req = factory.open(name, version); } catch (e) { return reject(e); }
    req.onupgradeneeded = (ev) => migrate(req.result, ev.oldVersion);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { try { db.close(); } catch {} };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('เปิดฐานข้อมูลไม่สำเร็จ'));
    req.onblocked = () => reject(new Error('ฐานข้อมูลถูกเปิดค้างในแท็บอื่น — ปิดแท็บอื่นแล้วลองใหม่'));
  });
}

/** เพิ่ม schema เวอร์ชันใหม่ = เพิ่มบล็อก if (oldVersion < N) ด้านล่าง ห้ามแก้บล็อกเก่า */
function migrate(db, oldVersion) {
  if (oldVersion < 1) {
    const ex = db.createObjectStore(STORES.exercises, { keyPath: 'key' });
    ex.createIndex('by_group', 'group', { unique: false });

    const cards = db.createObjectStore(STORES.cards, { keyPath: 'id' });
    cards.createIndex('by_date', 'date', { unique: false });

    const ses = db.createObjectStore(STORES.sessions, { keyPath: 'id' });
    ses.createIndex('by_date', 'date', { unique: false });
    ses.createIndex('by_status', 'status', { unique: false });

    const sets = db.createObjectStore(STORES.sets, { keyPath: 'id' });
    sets.createIndex('by_exercise', 'exercise_key', { unique: false });
    sets.createIndex('by_session', 'session_id', { unique: false });
    sets.createIndex('by_completed', 'completed_at', { unique: false });

    db.createObjectStore(STORES.settings, { keyPath: 'key' });

    const q = db.createObjectStore(STORES.sync_queue, { keyPath: 'id' });
    q.createIndex('by_created', 'created_at', { unique: false });

    db.createObjectStore(STORES.body_metrics, { keyPath: 'date' });
  }
}

/** IDBRequest → Promise */
export function reqp(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('request failed'));
  });
}

/**
 * รัน body ภายใน transaction เดียว — resolve เมื่อ commit สำเร็จเท่านั้น (ไม่ใช่ตอน body คืนค่า)
 * body โยน error หรือ reject → abort ทั้งก้อน ข้อมูลเดิมอยู่ครบ
 */
export function tx(db, storeNames, mode, body) {
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  return new Promise((resolve, reject) => {
    let t;
    try { t = db.transaction(names, mode); } catch (e) { return reject(e); }
    const stores = {};
    for (const n of names) stores[n] = t.objectStore(n);
    let result;
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };
    t.oncomplete = () => { if (!settled) { settled = true; resolve(result); } };
    t.onerror = () => fail(t.error || new Error('transaction error'));
    t.onabort = () => fail(t.error || new Error('transaction aborted'));
    let p;
    try { p = Promise.resolve(body(stores, t)); }
    catch (e) { fail(e); try { t.abort(); } catch {} return; }
    p.then(
      (r) => { result = r; },
      (err) => { fail(err); try { t.abort(); } catch {} },
    );
  });
}

export function getAll(db, store) {
  return tx(db, [store], 'readonly', (s) => reqp(s[store].getAll()));
}
export function getOne(db, store, key) {
  return tx(db, [store], 'readonly', (s) => reqp(s[store].get(key)));
}
export function putOne(db, store, value) {
  return tx(db, [store], 'readwrite', (s) => { s[store].put(value); return value; });
}
export function deleteOne(db, store, key) {
  return tx(db, [store], 'readwrite', (s) => { s[store].delete(key); });
}
export function countStore(db, store) {
  return tx(db, [store], 'readonly', (s) => reqp(s[store].count()));
}
export function getAllByIndex(db, store, index, key) {
  return tx(db, [store], 'readonly', (s) => reqp(s[store].index(index).getAll(key)));
}

export function deleteDatabase({ factory = globalThis.indexedDB, name = DB_NAME } = {}) {
  return new Promise((resolve, reject) => {
    const req = factory.deleteDatabase(name);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error('delete failed'));
    req.onblocked = () => resolve(false);
  });
}
