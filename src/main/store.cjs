// 데이터 파일 읽기·쓰기 — 쓰기는 임시 파일에 쓴 뒤 rename 해서 반쯤 쓰인 파일이 남지 않게 한다.
const fs = require('fs');
const path = require('path');

let seq = 0;
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${seq++}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

module.exports = { writeJson, readJson };
