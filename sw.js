// sw.js — service worker: แคช shell ให้เปิดได้ตอนออฟไลน์ที่ยิม
// ออกเวอร์ชันใหม่ = แก้ VERSION (ชื่อแคชเปลี่ยน → ดึง SHELL ใหม่ทั้งชุด → ลบแคชเก่า)
const VERSION = '0.1.1';
const CACHE = `liftlog-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/util.js',
  './js/model.js',
  './js/db.js',
  './js/repo.js',
  './js/backup.js',
  './js/sync.js',
  './js/ui_common.js',
  './js/ui_today.js',
  './js/ui_play.js',
  './js/ui_library.js',
  './js/ui_history.js',
  './js/ui_settings.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './data/demo/demo_card.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('liftlog-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // api.github.com / ลิงก์สื่อภายนอก ไม่ผ่านแคช

  if (req.mode === 'navigate') {
    // หน้าเว็บ: เอาของสดก่อน ออฟไลน์ค่อยใช้แคช
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        const c = await caches.open(CACHE);
        c.put('./index.html', net.clone());
        return net;
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // ไฟล์ static: แคชก่อน แล้วอัปเดตเบื้องหลัง
  event.respondWith((async () => {
    const c = await caches.open(CACHE);
    const cached = await c.match(req);
    const refresh = fetch(req).then((res) => {
      if (res && res.ok) c.put(req, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await refresh) || Response.error();
  })());
});
