// Claude Code 시작 화면의 픽셀 캐릭터를 본뜬 아이콘을 만든다 — 외부 의존성 없이 PNG/ICO/SVG 를 직접 쓴다.
//   node make-icon.cjs  →  icon.png(256) · icon.ico(16~256) · icon.svg
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BODY = [0xd9, 0x77, 0x57]; // Claude 주황
const EYE = [0x1f, 0x1e, 0x1d];
// B = 몸, E = 눈, . = 투명 (11 x 8, 아래에서 정사각형으로 가운데 정렬)
const ART = [
  '..BBBBBBB..',
  '..BEBBBEB..',
  '..BEBBBEB..',
  'BBBBBBBBBBB',
  'BBBBBBBBBBB',
  '..BBBBBBB..',
  '..B.B.B.B..',
  '..B.B.B.B..',
];
const W = ART[0].length;
const H = ART.length;
const GRID = 13; // 여백 포함 정사각 격자
const OX = (GRID - W) / 2;
const OY = (GRID - H) / 2;

function pixel(gx, gy) {
  const x = Math.floor(gx - OX);
  const y = Math.floor(gy - OY);
  if (gx < OX || gy < OY || x >= W || y >= H) return null;
  const c = ART[y][x];
  return c === 'B' ? BODY : c === 'E' ? EYE : null;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const c = pixel(((x + 0.5) / size) * GRID, ((y + 0.5) / size) * GRID);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      if (c) { raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255; }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ICO 는 PNG 를 그대로 품을 수 있다(Vista+)
function ico(sizes) {
  const imgs = sizes.map(png);
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    head[e] = s >= 256 ? 0 : s; head[e + 1] = s >= 256 ? 0 : s;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(imgs[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += imgs[i].length;
  });
  return Buffer.concat([head, ...imgs]);
}

function svg() {
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const rects = [];
  ART.forEach((line, y) => [...line].forEach((ch, x) => {
    if (ch === '.') return;
    rects.push(`<rect x="${x + OX}" y="${y + OY}" width="1.02" height="1.02" fill="${hex(ch === 'B' ? BODY : EYE)}"/>`);
  }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

const ROOT = path.join(__dirname, '..');
fs.writeFileSync(path.join(ROOT, 'src', 'renderer', 'icon.png'), png(256));
fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico([16, 24, 32, 48, 64, 256]));
fs.writeFileSync(path.join(ROOT, 'src', 'renderer', 'icon.svg'), svg());
console.log('src/renderer/icon.png · src/renderer/icon.svg · build/icon.ico');
