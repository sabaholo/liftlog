// tools/make_icons.mjs — สร้างไอคอน PNG (บาร์เบลบนพื้นเข้ม) โดยไม่ใช้ไลบรารีภายนอก
// ใช้: node tools/make_icons.mjs   → icons/icon-180.png · icon-192.png · icon-512.png
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');

let crcTable = null;
function crc32Fallback(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const crc32 = typeof zlib.crc32 === 'function' ? (b) => zlib.crc32(b) >>> 0 : crc32Fallback;

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [15, 17, 21];
const BAR = [245, 182, 66];
const PLATE = [238, 241, 247];

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function shade(u, v) {
  // พิกัด 0..1 — บาร์กลาง · เพลทนอก 2 คู่ · เพลทใน 2 คู่
  if (inRoundRect(u, v, 0.15, 0.27, 0.245, 0.73, 0.03)) return PLATE;
  if (inRoundRect(u, v, 0.755, 0.27, 0.85, 0.73, 0.03)) return PLATE;
  if (inRoundRect(u, v, 0.265, 0.34, 0.345, 0.66, 0.025)) return PLATE;
  if (inRoundRect(u, v, 0.655, 0.34, 0.735, 0.66, 0.025)) return PLATE;
  if (inRoundRect(u, v, 0.08, 0.465, 0.92, 0.535, 0.035)) return BAR;
  return BG;
}

function render(size, ss = 3) {
  const big = size * ss;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x * ss + sx + 0.5) / big;
          const v = (y * ss + sy + 0.5) / big;
          const c = shade(u, v);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = ss * ss;
      const o = (y * size + x) * 4;
      rgba[o] = Math.round(r / n);
      rgba[o + 1] = Math.round(g / n);
      rgba[o + 2] = Math.round(b / n);
      rgba[o + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [180, 192, 512]) {
  const file = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(file, render(size));
  console.log('wrote', path.relative(process.cwd(), file), fs.statSync(file).size, 'bytes');
}
