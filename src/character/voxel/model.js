// 복셀 캐릭터 데이터: 격자 · 부위 · 색 영역 · 잠금, 그리고 기본 인간 모형
//
// 좌표(격자 칸): x = 좌우(0 ~ 폭-1), y = 위아래(0 = 발바닥), z = 앞뒤(0 = 얼굴 쪽).
// 칸마다 세 가지를 기록한다.
//   ci     : 색 번호(팔레트 번호). 0 = 빈 칸
//   part   : 부위 번호 (1 머리, 2 몸통, 3 왼팔, 4 오른팔, 5 왼다리, 6 오른다리) — 걷기 애니메이션용
//   locked : 1 = 기본 모형(삭제·이동 불가, 색만 변경 가능), 0 = 학생이 추가한 픽셀
// 팔레트: [{ color: '#rrggbb', region: 영역 이름 | null }]. 영역이 있는 색은 그 영역의 색을 바꾸면 한꺼번에 바뀐다.

export const PARTS = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];      // 부위 번호 = 순서 + 1
export const P = { head: 1, torso: 2, armL: 3, armR: 4, legL: 5, legR: 6 };

// 기본 색 영역. 순서가 곧 팔레트 번호(1~6)이고, .vox 파일에서도 팔레트 1~6번을 이 순서로 읽는다.
export const REGIONS = [
  { key: 'skin',   label: '피부',     color: '#ffd9b8', choices: ['#ffe3c9', '#ffd9b8', '#f1c27d', '#c68642', '#8d5524', '#a8d8ea', '#c5e1a5', '#d7bde2'] },
  { key: 'hair',   label: '머리카락', color: '#5a3825', choices: ['#2b2b2b', '#5a3825', '#a0622d', '#e6b85c', '#d94f4f', '#f08fb0', '#4f7fd9', '#f2f2f2'] },
  { key: 'eye',    label: '눈',       color: '#2a2a2a', choices: ['#2a2a2a', '#5a3825', '#2f6fd0', '#2f9e6a', '#8e6bd6', '#c0392b'] },
  { key: 'top',    label: '상의',     color: '#3d7be0', choices: ['#3d7be0', '#e25555', '#f2b33d', '#4caf7a', '#8e6bd6', '#f08fb0', '#2f3542', '#f4f1ea'] },
  { key: 'bottom', label: '하의',     color: '#3b4a6b', choices: ['#3b4a6b', '#2b2b2b', '#6b4a3b', '#4a6b52', '#8a8f99', '#d9c7a8', '#c0392b', '#f4f1ea'] },
  { key: 'shoes',  label: '신발',     color: '#f4f1ea', choices: ['#f4f1ea', '#2b2b2b', '#c0392b', '#3d7be0', '#f2b33d', '#6b4a3b'] },
];

export class VoxelModel {
  constructor(sx, sy, sz) {
    this.size = [sx, sy, sz];
    const n = sx * sy * sz;
    this.ci = new Uint8Array(n); this.part = new Uint8Array(n); this.locked = new Uint8Array(n);
    this.palette = [null];             // 0번은 '빈 칸'
  }
  inside(x, y, z) { const [sx, sy, sz] = this.size; return x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz; }
  index(x, y, z) { return x + this.size[0] * (z + this.size[2] * y); }
  get(x, y, z) { return this.inside(x, y, z) ? this.ci[this.index(x, y, z)] : 0; }
  // 색 번호 찾기(없으면 추가). 영역 이름을 주면 그 영역의 색 번호
  colorIndex(color, region = null) {
    let i = this.palette.findIndex((p) => p && (region ? p.region === region : !p.region && p.color === color));
    if (i < 0) { if (this.palette.length > 255) throw new Error('색은 255가지까지 쓸 수 있습니다'); i = this.palette.push({ color, region }) - 1; }
    return i;
  }
  // 칸 채우기 (기본 모형을 만들 때는 locked = 1)
  set(x, y, z, ci, part, locked = 1) {
    if (!this.inside(x, y, z)) return false;
    const i = this.index(x, y, z);
    this.ci[i] = ci; this.part[i] = part; this.locked[i] = locked;
    return true;
  }
  // ── 학생 픽셀(2층)용: 잠긴 칸은 지우거나 덮어쓸 수 없다 ──
  isLocked(x, y, z) { return this.inside(x, y, z) && this.locked[this.index(x, y, z)] === 1; }
  addVoxel(x, y, z, color) {
    if (!this.inside(x, y, z) || this.get(x, y, z)) return false;       // 이미 찬 칸(잠긴 칸 포함)에는 추가 불가
    return this.set(x, y, z, this.colorIndex(color), partAt(this, x, y, z), 0);
  }
  removeVoxel(x, y, z) {
    if (!this.get(x, y, z) || this.isLocked(x, y, z)) return false;
    const i = this.index(x, y, z); this.ci[i] = this.part[i] = 0;
    return true;
  }
  // 칸 하나의 색 바꾸기. 잠긴 칸도 색은 바꿀 수 있다 (영역에서 떼어 내 그 칸만 다른 색이 됨)
  paintVoxel(x, y, z, color) {
    if (!this.get(x, y, z)) return false;
    this.ci[this.index(x, y, z)] = this.colorIndex(color);
    return true;
  }
  count() { let n = 0; for (const c of this.ci) if (c) n++; return n; }
  clone() {
    const m = new VoxelModel(...this.size);
    m.ci.set(this.ci); m.part.set(this.part); m.locked.set(this.locked);
    m.palette = this.palette.map((p) => (p ? { ...p } : null));
    return m;
  }
  // 부위별 범위 { head: { min: [x,y,z], max: [x,y,z] }, … } (빈 부위는 없음)
  // 기본 모형(잠긴 칸)만 센다 → 학생이 픽셀을 붙여도 관절 위치는 변하지 않음
  partBounds() {
    const [sx, sy, sz] = this.size, out = {};
    for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
      const i = this.index(x, y, z); if (!this.ci[i] || !this.locked[i]) continue;
      const b = (out[PARTS[this.part[i] - 1]] ??= { min: [x, y, z], max: [x, y, z] });
      b.min = [Math.min(b.min[0], x), Math.min(b.min[1], y), Math.min(b.min[2], z)];
      b.max = [Math.max(b.max[0], x), Math.max(b.max[1], y), Math.max(b.max[2], z)];
    }
    return out;
  }
}

// 위치만 보고 부위를 정하는 규칙 (.vox 를 불러올 때와 학생 픽셀에 사용). 16 × 32 격자 기준 비율:
//   위쪽 절반 = 머리, 아래 6/32 = 다리(가운데에서 좌우로 나뉨), 그 사이 = 몸통. 몸통 높이에서 좌우 1/4 바깥 = 팔
//   캐릭터는 z = 0 쪽을 바라보므로 캐릭터의 오른쪽은 x 가 큰 쪽이다.
export function partAt(model, x, y, z) {
  const [sx, sy] = model.size;
  if (y >= sy / 2) return P.head;
  if (y < Math.round(sy * 6 / 32)) return x < sx / 2 ? P.legL : P.legR;
  if (x < sx / 4) return P.armL;
  if (x >= sx * 3 / 4) return P.armR;
  return P.torso;
}

// ── 기본 인간 모형: 폭 16 × 깊이 12 × 높이 32. 머리 16칸 + 몸통·다리 16칸의 2등신 ──
export function createBaseModel() {
  const m = new VoxelModel(16, 32, 12);
  const c = Object.fromEntries(REGIONS.map((r) => [r.key, m.colorIndex(r.color, r.key)]));
  const box = (x0, x1, y0, y1, z0, z1, ci, part) => {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) m.set(x, y, z, ci, part);
  };
  // 다리(6칸): 신발 2칸 + 바지 4칸. 신발은 앞으로 한 칸 나옴
  for (const [x0, part] of [[5, P.legL], [8, P.legR]]) {
    box(x0, x0 + 2, 0, 1, 3, 7, c.shoes, part);
    box(x0, x0 + 2, 2, 5, 4, 7, c.bottom, part);
  }
  // 몸통(10칸): 아래 3칸은 하의, 위 7칸은 상의
  box(4, 11, 6, 8, 3, 8, c.bottom, P.torso);
  box(4, 11, 9, 15, 3, 8, c.top, P.torso);
  // 팔(8칸): 소매 5칸 + 손 3칸
  for (const [x0, part] of [[2, P.armL], [12, P.armR]]) {
    box(x0, x0 + 1, 11, 15, 4, 7, c.top, part);
    box(x0, x0 + 1, 8, 10, 4, 7, c.skin, part);
  }
  // 머리(16칸): 폭 14 × 깊이 12 의 상자에서 모서리를 깎아 둥글게
  for (let y = 16; y <= 31; y++) for (let z = 0; z <= 11; z++) for (let x = 1; x <= 14; x++) {
    const out = Math.max(0, 3 - x, x - 12) + Math.max(0, 18 - y, y - 29) + Math.max(0, 2 - z, z - 9);
    if (out > 2) continue;
    const hair = y >= 28 || (z >= 8 && y >= 18) || ((x <= 2 || x >= 13) && y >= 22) || (z <= 1 && y >= 26);
    m.set(x, y, z, hair ? c.hair : c.skin, P.head);
  }
  for (const x0 of [4, 10]) box(x0, x0 + 1, 21, 23, 0, 0, c.eye, P.head);      // 눈: 2 × 3칸
  return m;
}

/* ── 작업 모형: 기본 모형 + 학생이 바꾼 것 ──
   기본 모형 둘레에 여유 칸을 둔 더 큰 격자(기본 16 × 32 × 12 → 폭 24 × 높이 40 × 깊이 20)에 기본 모형을 넣고,
   그 위에 설정(config)의 영역 색 · 칸별 색칠(paint) · 추가 픽셀(extra)을 적용한다.
   설정 안의 좌표는 '기본 모형 격자' 기준이라 여유 칸 크기가 바뀌어도 그대로 쓸 수 있다.
     paint : [[x, y, z, '#색'], …]          기본 모형 칸의 색을 따로 칠한 것
     extra : [[x, y, z, '#색', 부위번호], …]  추가 픽셀 (붙은 부위에 소속되어 함께 움직임) */
export const MARGIN = { x: 4, top: 8, z: 4 };        // 좌우 4칸씩, 위로 8칸, 앞뒤 4칸씩
export const MAX_EXTRA = 400;                         // 추가 픽셀 최대 개수

export function buildWorkModel(config = {}, base = getBaseModel()) {
  const [bx, by, bz] = base.size, ox = MARGIN.x, oz = MARGIN.z;
  const m = new VoxelModel(bx + 2 * MARGIN.x, by + MARGIN.top, bz + 2 * MARGIN.z);
  m.origin = [ox, 0, oz]; m.baseSize = [bx, by, bz];
  m.palette = base.palette.map((p) => (p ? { ...p, color: (p.region && config.colors?.[p.region]) || p.color } : null));
  for (let y = 0; y < by; y++) for (let z = 0; z < bz; z++) for (let x = 0; x < bx; x++) {
    const i = base.index(x, y, z);
    if (base.ci[i]) m.set(x + ox, y, z + oz, base.ci[i], base.part[i], 1);
  }
  m.pristine = m.ci.slice();                          // 색칠 전 상태 (어느 칸을 따로 칠했는지 알아내는 데 사용)
  try {
    for (const [x, y, z, color] of config.paint ?? []) if (m.isLocked(x + ox, y, z + oz)) m.paintVoxel(x + ox, y, z + oz, color);
    let n = 0;
    for (const [x, y, z, color, part] of config.extra ?? []) {
      const X = x + ox, Z = z + oz;
      if (n >= MAX_EXTRA || !m.inside(X, y, Z) || m.get(X, y, Z)) continue;
      m.set(X, y, Z, m.colorIndex(color), part, 0); n++;
    }
  } catch { /* 색 종류가 255가지를 넘으면 나머지는 생략 */ }
  return m;
}

// 작업 모형 → 설정에 저장할 값 { paint, extra }
export function extractEdits(m) {
  const [sx, sy, sz] = m.size, [ox, , oz] = m.origin, paint = [], extra = [];
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const i = m.index(x, y, z), c = m.ci[i];
    if (!c) continue;
    if (!m.locked[i]) extra.push([x - ox, y, z - oz, m.palette[c].color, m.part[i]]);
    else if (c !== m.pristine[i]) paint.push([x - ox, y, z - oz, m.palette[c].color]);
  }
  return { paint, extra };
}

// 지금 쓰는 기본 모형. setBaseModel 로 바꾸면(예: .vox 를 불러왔을 때) 이후에 만드는 캐릭터부터 적용된다.
let baseModel = null;
export const getBaseModel = () => (baseModel ??= createBaseModel());
export const setBaseModel = (model) => { baseModel = model; };
