// 클마고치 진화 시트 — 캐릭터마다 아기 · 어린이 · 어른을 한 줄에, 두 마리씩 나란히.
//   npm run sheet [출력경로]   (기본: docs/pet-sheet.png)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

require(path.join(__dirname, '..', 'src', 'renderer', 'pet-art.js'));
const { PAL, SPECIES } = globalThis.PET_ART;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const SCALE = 6, CELL = 15, PER_ROW = 2;
const COLS = PER_ROW * 3, ROWS = Math.ceil(SPECIES.length / PER_ROW);
const GAP = 12; // 캐릭터 묶음 사이 여백
const W = COLS * CELL * SCALE + (PER_ROW - 1) * GAP, H = ROWS * CELL * SCALE;
const BG = hex('#17181c'), TILE = hex('#212328');
const img = Buffer.alloc(W * H * 3);
const put = (x, y, c) => { const o = (y * W + x) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, BG);

SPECIES.forEach(([, ...stages], i) => {
  const group = i % PER_ROW;
  stages.forEach((art, s) => {
    const tx = (group * 3 + s) * CELL * SCALE + group * GAP, ty = Math.floor(i / PER_ROW) * CELL * SCALE;
    for (let y = 3; y < CELL * SCALE - 3; y++) for (let x = 3; x < CELL * SCALE - 3; x++) put(tx + x, ty + y, TILE);
    const w = Math.max(...art.map((r) => r.length));
    // 바닥에 맞춰 세운다 — 위젯에서도 발이 같은 선에 놓인다
    const ox = Math.floor((CELL - w) / 2), oy = CELL - 1 - art.length;
    art.forEach((line, ay) => [...line].forEach((ch, ax) => {
      if (!PAL[ch]) return;
      const c = hex(PAL[ch]);
      for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++)
        put(tx + (ox + ax) * SCALE + dx, ty + (oy + ay) * SCALE + dy, c);
    }));
  });
});

const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
const out = process.argv[2] || path.join(__dirname, '..', 'docs', 'pet-sheet.png');
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(out);
SPECIES.forEach(([n], i) => process.stdout.write(`${i % PER_ROW ? '   ' : '\n'}${String(Math.floor(i / PER_ROW) + 1).padStart(2)}줄 ${i % PER_ROW ? '오른쪽' : '왼쪽'}: ${n}`));
console.log();
