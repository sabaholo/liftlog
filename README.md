# Lift Log — สมุดเวทส่วนตัวบน iPhone

PWA ไม่มี build step · ข้อมูลอยู่ในเครื่อง (IndexedDB) · ไม่มีบัญชี ไม่มี backend ไม่มี analytics
ออกแบบจากวิธีใช้จริงของ Rock (9/9/2026): **หยิบมือถือ "ก่อนเริ่มท่า"** → เห็นท่านี้เต็ม ๆ (cue · ท่าสำรอง · ครั้งก่อน) + จดท่าละบรรทัด `kg · ครั้ง × เซ็ต · RIR` → บันทึก 1–2 แตะ → เห็นท่าต่อไป

## รันในเครื่อง

```
npm test                # node:test + fake-indexeddb (33 เทสต์)
npm run serve           # http://127.0.0.1:8787/  (dev: ไม่ใช้ service worker)
npm run icons           # สร้าง icons/*.png ใหม่
```

ลองหน้าจดทันทีโดยไม่ต้องมีการ์ดจริง: เปิด `/#/demo` (เซสชันจากการ์ดตัวอย่าง ติดป้าย demo ไม่เข้าสถิติ)

## โครงไฟล์

```
index.html · manifest.json · sw.js        shell + service worker (ออฟไลน์)
css/app.css                               ธีมเข้ม ปุ่ม ≥62px
js/db.js        IndexedDB: stores + transaction helper (ห้าม await ของที่ไม่ใช่ IDB ใน tx)
js/model.js     กติกาข้อมูลล้วน: อ่านชื่อท่า/dose ของการ์ด Lee · ขยายบรรทัดเดียวเป็น N เซ็ต · สรุป · เลือกการ์ด
js/repo.js      อ่าน/เขียนทุกอย่าง (sessions+sets ใน transaction เดียว) · ครั้งก่อน · ประวัติ
js/backup.js    export JSON/CSV · validate · restore-replace แบบ atomic
js/sync.js      GitHub contents API (opt-in): มือถือเขียน sessions/ · Life OS เขียน cards/ + library.json
js/ui_*.js      หน้าจอ 4 หน้า + หน้าเล่น · ui_common = DOM helper/modal/numpad/stepper
data/demo/      การ์ดตัวอย่าง (ติดป้าย demo)
test/           node:test
tools/          dev server · ตัวสร้างไอคอน
```

## ขึ้นไอโฟน

1. โฮสต์โฟลเดอร์นี้บน HTTPS — ของจริง: **https://sabaholo.github.io/liftlog/** (GitHub Pages ของ repo นี้ · โค้ดล้วน ไม่มีข้อมูลผู้ใช้ · เปิด 9/9/2026)
2. Safari เปิด URL → ปุ่มแชร์ → **เพิ่มไปยังหน้าจอโฮม** → เปิดจากไอคอนเสมอ (ข้อมูลของ Home Screen app กับของ Safari เป็นคนละชุด)
3. ตั้งค่า → ซิงก์ (ถ้าใช้) หรือ นำเข้าการ์ด/คลังจากไฟล์

## ข้อมูลเข้า/ออก

| ทาง | อะไร | วิธี |
|---|---|---|
| เข้า | การ์ดของ Lee (`outputs/lee/sessions/*.json` โครงเดิม ไม่แปลง) | ซิงก์จาก `cards/` หรือ นำเข้าไฟล์ |
| เข้า | คลังท่า `library.json` (สร้างจาก `kb/fitness/exercise_library/*.md` ด้วย `scripts/liftlog_push.js` ใน Life OS) | ซิงก์ หรือ นำเข้าไฟล์ |
| ออก | เซสชันที่จบ → `sessions/<id>.json` | ซิงก์อัตโนมัติเมื่อออนไลน์ (ต่อคิวเมื่อออฟไลน์) |
| ออก | CSV รูปแบบ `kb/life/gym_log.csv` | ตั้งค่า → ส่งออก CSV |
| สำรอง | JSON ทั้งชุด (schema_version) | ตั้งค่า → ส่งออก JSON · กู้คืน = แทนที่ทั้งชุด |

ท่อฝั่ง Life OS: `node scripts/liftlog_push.js` (การ์ด+คลัง → repo ข้อมูล) · `node scripts/liftlog_pull.js` (sessions → gym_log.csv)

## ซิงก์ (opt-in)

- repo ส่วนตัว `liftlog-data` แยกจาก repo โค้ด · หนึ่งผู้เขียนต่อโฟลเดอร์: มือถือเขียน `sessions/` · Life OS เขียน `cards/` `library.json` ⇒ ไม่มี merge conflict โดยโครงสร้าง
- token = fine-grained PAT · Repository access: เฉพาะ `liftlog-data` · Permissions: Contents **Read and write** · เก็บใน IndexedDB ของเครื่อง ไม่ออกไปกับไฟล์สำรอง
- แอปไม่บอกว่า "ส่งแล้ว" จนกว่า API ตอบ 200/201 · ล้มเหลว = คิวยังอยู่ + เหตุผลแสดงในตั้งค่า

## กติกาข้อมูลที่บังคับในโค้ด

- เซสชัน = snapshot ของการ์ดขณะเริ่ม · แก้การ์ดทีหลังไม่กระทบประวัติ
- เซ็ตเก็บรายแถว (แม้จดบรรทัดเดียว) → แยกเซ็ต/แก้ย้อนหลังได้ · top-set/volume คิดจากของจริง
- ช่องว่าง ≠ ศูนย์ · ปุ่มบันทึกปิดระหว่างเขียน · "บันทึกแล้ว" ขึ้นหลัง transaction commit เท่านั้น · เลิกทำได้ 7 วินาที
- เซสชันที่ทิ้ง = เซ็ตติด `discarded` ไม่เข้าสถิติ · demo ไม่เข้าสถิติ ไม่ออกไปกับ CSV
- timer เก็บ `end_at` แล้วคำนวณใหม่เมื่อกลับเข้าแอป (ไม่รับรองเสียง/แจ้งเตือนตอนล็อกจอ)
- การ์ดวันนี้ = ตรงวันเท่านั้น · ใบล่วงหน้า/อดีตให้ผู้ใช้เลือกเอง (บั๊กเดิม 31/8) · 1 วันหลายใบ = เลือกเอง
- ชื่อท่าในการ์ด `"Squat — Rock (Smith)"` → กุญแจ `Squat (Smith)` (เก็บ variant เพราะโหลดต่างกันจริง) · ท่า `— แนน` ไม่เข้าเซสชันรุ่นนี้ (โชว์อย่างเดียว)
- ดัมเบล/บาร์: วิธีนับน้ำหนักตั้งต่อท่าในคลัง (`load_convention`) · เปลี่ยน = เริ่มชุดเปรียบเทียบใหม่ ไม่แปลงย้อนหลัง

## ออกเวอร์ชันใหม่

แก้ `VERSION` ใน `sw.js` และ `APP_VERSION` ใน `js/util.js` → push → ผู้ใช้เห็น toast "มีเวอร์ชันใหม่" → แตะอัปเดต

## สถานะการทดสอบ (9/9/2026)

**ทดสอบแล้ว (เครื่อง PC):** node:test 33/33 — กติกาข้อมูล · เขียน/อ่าน IndexedDB · ปิดแล้วเปิดใหม่ค่าครบ · ครั้งก่อน · เลิกทำ/ข้าม/สลับ/เพิ่ม/เลื่อน · ทิ้งเซสชัน · แก้ย้อนหลัง · export/import ครบ+ซ้ำไม่เพิ่ม+ล้มกลางทาง rollback · CSV · ซิงก์กับ fetch จำลอง (push/pull/ล้มเหลว/sha ชน) · เปิดหน้าวันนี้ + หน้าจดใน Chrome จอไอโฟนจำลอง ไม่มี error

**ยังไม่ได้ทดสอบ:** บนไอโฟนจริงทุกอย่าง — Add to Home Screen · ออฟไลน์ (airplane mode) · ล็อกจอแล้วกลับมา · เลือกไฟล์จาก Files/iCloud · แชร์ไฟล์ออก · ซิงก์กับ GitHub จริง (ต้องมี repo + token) · การแตะจริงของทุกปุ่ม (ในเครื่องทดสอบด้วยเทสต์ชั้นข้อมูล ไม่ได้คลิกผ่าน UI)

## ความเป็นส่วนตัว

ไม่ส่งอะไรออกจากเครื่อง ยกเว้น (1) ซิงก์ที่เปิดเอง → api.github.com เท่านั้น (2) ลิงก์สื่อที่กดเอง · repo โค้ดนี้ไม่มีข้อมูลผู้ใช้ · ข้อมูลอยู่ใน repo ข้อมูลส่วนตัวหรือในเครื่อง
