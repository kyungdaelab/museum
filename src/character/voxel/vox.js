// MagicaVoxel(.vox) 파일 불러오기 · 내보내기 — 기본 인간 모형을 바꿀 때 사용
//
// 약속:
//   · MagicaVoxel 팔레트 1~6번 = 피부, 머리카락, 눈, 상의, 하의, 신발 (이 색으로 칠한 칸은 영역 색 바꾸기에 반응)
//     그 밖의 번호로 칠한 칸은 색이 고정된다 (예: 입, 볼터치).
//   · 부위(머리·몸통·팔·다리)는 위치로 자동 판정한다 (model.js 의 partAt 규칙). 기본 모형과 비슷한 비율로 만들면 된다.
//   · MagicaVoxel 은 위쪽이 z 축이고, 모형이 -y 쪽(화면 앞)을 바라보게 만든다.
//   · 불러온 칸은 모두 locked = 1 (기본 모형).
// 내보낸 파일을 MagicaVoxel 에서 고친 뒤 다시 불러오는 식으로 쓰면 편하다.
import { VoxelModel, REGIONS, partAt } from './model.js';

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

// ArrayBuffer → VoxelModel. 형식이 맞지 않으면 오류
export function parseVox(buffer) {
  const dv = new DataView(buffer), id = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (buffer.byteLength < 20 || id(0) !== 'VOX ') throw new Error('MagicaVoxel(.vox) 파일이 아닙니다');
  let size = null, xyzi = null, rgba = null;
  // MAIN 청크 안의 하위 청크들을 차례로 읽음. 모형이 여러 개면 첫 번째만 사용
  for (let o = 20; o + 12 <= buffer.byteLength;) {
    const name = id(o), n = dv.getInt32(o + 4, true), kids = dv.getInt32(o + 8, true), body = o + 12;
    if (name === 'SIZE' && !size) size = [dv.getInt32(body, true), dv.getInt32(body + 4, true), dv.getInt32(body + 8, true)];
    else if (name === 'XYZI' && !xyzi) xyzi = { count: dv.getInt32(body, true), at: body + 4 };
    else if (name === 'RGBA') rgba = body;
    o = body + n + kids;
  }
  if (!size || !xyzi) throw new Error('.vox 파일에서 모형을 찾지 못했습니다');
  const [vx, vy, vz] = size;
  if (vx > 64 || vy > 64 || vz > 96) throw new Error(`모형이 너무 큽니다 (${vx} × ${vy} × ${vz}). 폭·깊이 64칸, 높이 96칸 이하로 만들어 주세요`);

  // MagicaVoxel (x, y, z: z 가 위, -y 가 앞) → 우리 격자 (x, y: 위, z: 0 이 앞). 좌우가 뒤집히지 않게 x 를 반대로
  const m = new VoxelModel(vx, vz, vy);
  for (const r of REGIONS) m.colorIndex(r.color, r.key);            // 팔레트 1~6 = 영역
  const colorOf = (i) => (rgba ? hex(dv.getUint8(rgba + (i - 1) * 4), dv.getUint8(rgba + (i - 1) * 4 + 1), dv.getUint8(rgba + (i - 1) * 4 + 2)) : '#b0b0b0');
  if (rgba) REGIONS.forEach((r, k) => { m.palette[k + 1].color = colorOf(k + 1); });      // 파일에 칠해진 색을 영역의 기본 색으로
  for (let k = 0; k < xyzi.count; k++) {
    const o = xyzi.at + k * 4, x = dv.getUint8(o), y = dv.getUint8(o + 1), z = dv.getUint8(o + 2), i = dv.getUint8(o + 3);
    if (!i) continue;
    const X = vx - 1 - x, Y = z, Z = y;
    m.set(X, Y, Z, i <= REGIONS.length ? i : m.colorIndex(colorOf(i)), 1, 1);
  }
  for (let Y = 0; Y < vz; Y++) for (let Z = 0; Z < vy; Z++) for (let X = 0; X < vx; X++)
    if (m.get(X, Y, Z)) m.part[m.index(X, Y, Z)] = partAt(m, X, Y, Z);
  if (!m.count()) throw new Error('.vox 파일에 복셀이 하나도 없습니다');
  return m;
}

// VoxelModel → .vox 파일 내용(ArrayBuffer). 영역 색은 팔레트 1~6번에 들어간다.
export function exportVox(model) {
  const [sx, sy, sz] = model.size, vox = [];
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const c = model.get(x, y, z);
    if (c) vox.push(sx - 1 - x, z, y, c);
  }
  const chunks = [
    ['SIZE', (dv, o) => { dv.setInt32(o, sx, true); dv.setInt32(o + 4, sz, true); dv.setInt32(o + 8, sy, true); }, 12],
    ['XYZI', (dv, o) => { dv.setInt32(o, vox.length / 4, true); vox.forEach((b, k) => dv.setUint8(o + 4 + k, b)); }, 4 + vox.length],
    ['RGBA', (dv, o) => {
      for (let i = 1; i < 256; i++) {
        const p = model.palette[i], n = p ? parseInt(p.color.slice(1), 16) : 0x808080;
        dv.setUint8(o + (i - 1) * 4, n >> 16); dv.setUint8(o + (i - 1) * 4 + 1, n >> 8 & 255); dv.setUint8(o + (i - 1) * 4 + 2, n & 255); dv.setUint8(o + (i - 1) * 4 + 3, 255);
      }
    }, 1024],
  ];
  const kids = chunks.reduce((s, c) => s + 12 + c[2], 0), buf = new ArrayBuffer(20 + kids), dv = new DataView(buf);
  const tag = (o, s) => { for (let i = 0; i < 4; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, 'VOX '); dv.setInt32(4, 150, true); tag(8, 'MAIN'); dv.setInt32(12, 0, true); dv.setInt32(16, kids, true);
  let o = 20;
  for (const [name, write, n] of chunks) { tag(o, name); dv.setInt32(o + 4, n, true); dv.setInt32(o + 8, 0, true); write(dv, o + 12); o += 12 + n; }
  return buf;
}
