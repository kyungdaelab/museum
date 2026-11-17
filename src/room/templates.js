// 전시실 유형별 '틀': 유형과 최대 작품 수를 받아 벽 · 자리(슬롯) · 입구 위치를 계산한다. (3D 는 만들지 않고 숫자만 계산)
//
// ▸ 새 유형(예: 혼합형) 추가: ROOM_TYPES 에 { label, accepts, layout } 항목을 하나 추가하면 됩니다.
//
// 좌표: 입구는 항상 서쪽 벽(x = 0) 가운데. 동쪽(+x)으로 깊어지고, z 는 0(남쪽 벽) ~ -depth(북쪽 벽).
// layout 결과:
//   width, depth        방 전체 크기(m)
//   walls               [x1, z1, x2, z2, y0?]  벽 중심선. y0 이 있으면 그 높이부터 시작(문 위 상인방)
//   blocks              [{ x, z, w, d, h }]     가벽처럼 서 있는 상자 (충돌 있음)
//   slots               { 번호: { kind: 'wall', x, z, dir } | { kind: 'floor', x, z } }   dir = 작품이 바라보는 방향
//   zones               [{ name, minX, maxX }]  방 이름 표시용
//   board               입구 안내판 { x, z, dir }      panels: 벽 설명 패널 [{ x, z, dir }]
//   spawn               입장 위치 { x, z, yaw }
export const MAX_ARTWORKS = 30;      // 시스템 상한
export const WALL_H = 4.2, WALL_T = 0.3, DOOR_H = 2.8, DOOR_W = 3;

const wall = (x, z, dir) => ({ kind: 'wall', x, z, dir });
const floor = (x, z) => ({ kind: 'floor', x, z });
const IN = WALL_T / 2;               // 벽 중심선 → 벽 표면까지 거리

function entrance(layout) {          // 입구 안내판과 입장 위치 (모든 유형 공통)
  const z = -layout.depth / 2;
  layout.door = { x: 0, z, dir: 'E' };
  layout.board = { x: 5.2, z, dir: 'W' };
  layout.spawn = { x: 1.6, z, yaw: -Math.PI / 2 };       // 동쪽(안쪽)을 바라보며 시작
  return layout;
}

/* ── 평면 전용: 벽면 갤러리형 ──
   방 개수: 10개 이하 1개, 11~20개 2개, 21~30개 3개. 방들은 동쪽으로 한 줄로 이어진다.
   동선(자리 번호 순서): 북쪽 벽을 따라 안쪽으로 → 마지막 방 동쪽 벽 → 남쪽 벽을 따라 입구로 (한 방향으로 한 바퀴)
   작품 사이 간격은 모든 벽에서 SPACING 으로 같다. */
function flatLayout(n) {
  const SPACING = 2.6, DEPTH = 8;
  const rooms = Math.ceil(n / 10);
  const east = n % 2 ? 1 : n >= 4 ? 2 : 0;               // 마지막 방 동쪽 벽에 거는 수 (남·북 벽 수를 같게 맞추기 위함)
  const pairs = (n - east) / 2;                          // 남·북 벽에 마주 보게 거는 쌍의 수
  const perRoom = Array.from({ length: rooms }, (_, i) => Math.floor(pairs / rooms) + (i < pairs % rooms ? 1 : 0));

  let x = 0;
  const spans = perRoom.map((k, i) => { const w = Math.max(k * SPACING + 0.6, i === 0 ? 8 : 6); return { k, x0: x, x1: (x += w), w }; });
  const width = x, mid = -DEPTH / 2;
  const walls = [[0, 0, width, 0], [0, -DEPTH, width, -DEPTH], [0, 0, 0, -DEPTH], [width, 0, width, -DEPTH]];
  for (const s of spans.slice(0, -1)) {                  // 방 사이 벽: 가운데에 문
    walls.push([s.x1, 0, s.x1, mid + DOOR_W / 2], [s.x1, mid - DOOR_W / 2, s.x1, -DEPTH], [s.x1, mid + DOOR_W / 2, s.x1, mid - DOOR_W / 2, DOOR_H]);
  }

  const slots = {}; let no = 1;
  const along = (s, j) => s.x0 + (s.w - s.k * SPACING) / 2 + SPACING / 2 + j * SPACING;
  for (const s of spans) for (let j = 0; j < s.k; j++) slots[no++] = wall(along(s, j), -DEPTH + IN, 'S');
  for (let j = 0; j < east; j++) slots[no++] = wall(width - IN, mid - ((east - 1) / 2 - j) * SPACING, 'W');
  for (const s of [...spans].reverse()) for (let j = s.k - 1; j >= 0; j--) slots[no++] = wall(along(s, j), -IN, 'N');

  return entrance({
    width, depth: DEPTH, walls, blocks: [], slots, panels: [],
    zones: rooms > 1 ? spans.map((s, i) => ({ name: `${i + 1}실`, minX: s.x0, maxX: s.x1 })) : [],
  });
}

/* ── 입체 전용: 넓은 홀형 ──
   받침대 중심 간격 GRID. 받침대 한 변은 최대 1.3m 이므로 받침대 사이 빈 공간은 항상 2.5m 이상.
   arrangement 'grid'   : 입구에서 가까운 줄부터 차례로 번호
               'circle' : 가운데 1번, 그 둘레로 동심원 (안쪽 원부터 6 · 12 · 18자리) */
export const PEDESTAL_MAX_SIDE = 1.3;
const GRID = 3.8, FRONT = 8.8, MARGIN = 3.5;      // 받침대 간격, 입구~첫 받침대 거리, 벽~받침대 거리

function solidLayout(n, arrangement = 'grid') {
  const slots = {}; let width, depth, no = 1;
  if (arrangement === 'circle') {
    const pts = [];                                      // 홀 중심 기준 [dx, dz]
    const ring = (count, r, phase = 0) => { for (let i = 0; i < count; i++) { const a = Math.PI + phase + i * 2 * Math.PI / count; pts.push([r * Math.cos(a), r * Math.sin(a)]); } };
    let rMax = 0;
    if (n <= 6) { rMax = n > 1 ? GRID / (2 * Math.sin(Math.PI / n)) : 0; ring(n, rMax); }
    else {
      pts.push([0, 0]);
      for (let k = 1, left = n - 1; left > 0; k++) { const c = Math.min(6 * k, left); rMax = k * GRID; ring(c, rMax, k % 2 ? 0 : Math.PI / c); left -= c; }
    }
    depth = Math.max(9, 2 * rMax + 2 * MARGIN); width = FRONT + 2 * rMax + MARGIN;
    for (const [dx, dz] of pts) slots[no++] = floor(FRONT + rMax + dx, -depth / 2 + dz);
  } else {
    const across = Math.max(1, Math.ceil(Math.sqrt(n / 1.4)));       // 한 줄에 놓는 수 (홀을 안쪽으로 길게)
    const lines = Math.ceil(n / across);
    depth = Math.max(9, (across - 1) * GRID + 2 * MARGIN); width = FRONT + (lines - 1) * GRID + MARGIN;
    for (let l = 0; l < lines; l++) {
      const count = Math.min(across, n - l * across);                // 마지막 줄은 가운데 정렬
      for (let j = 0; j < count; j++) slots[no++] = floor(FRONT + l * GRID, -depth / 2 + (j - (count - 1) / 2) * GRID);
    }
  }
  return entrance({
    width, depth, slots, blocks: [], zones: [],
    walls: [[0, 0, width, 0], [0, -depth, width, -depth], [0, 0, 0, -depth], [width, 0, width, -depth]],
    panels: [{ x: width - IN, z: -depth / 2, dir: 'W' }],            // 안쪽 벽: 전시 제목 · 설명 패널
  });
}

/* ── 혼합형: 가운데에 입체 작품 받침대, 남·북 벽에 평면 작품 ──
   자리 번호: 1 ~ flatCount 번은 벽 자리(북쪽 벽을 따라 안쪽으로 → 남쪽 벽을 따라 입구로), 그 뒤 번호는 받침대 자리.
   홀 크기는 받침대 수로 정하고, 벽 길이가 그림 수에 모자라면 홀을 안쪽으로 늘린다(받침대는 가운데로 옮김). */
export const mixedCounts = (cfg) => {
  const total = clampCount(cfg.maxArtworks), raw = Math.round(Number(cfg.flatCount));
  const flat = Math.min(total, Math.max(0, Number.isFinite(raw) ? raw : Math.ceil(total / 2)));
  return { total, flat, solid: total - flat };
};
function mixedLayout(cfg) {
  const SPACING = 2.6, { flat: nFlat, solid: nSolid } = mixedCounts(cfg);
  const hall = solidLayout(nSolid, cfg.arrangement);
  const north = Math.ceil(nFlat / 2), south = nFlat - north;
  const need = north * SPACING + 1.2, extra = Math.max(0, need - hall.width);
  const width = hall.width + extra, depth = hall.depth;
  const slots = {}; let no = 1;
  const along = (k, j) => (width - k * SPACING) / 2 + SPACING / 2 + j * SPACING;
  for (let j = 0; j < north; j++) slots[no++] = wall(along(north, j), -depth + IN, 'S');
  for (let j = south - 1; j >= 0; j--) slots[no++] = wall(along(south, j), -IN, 'N');
  for (const s of Object.values(hall.slots)) slots[no++] = floor(s.x + extra / 2, s.z);
  return entrance({
    width, depth, slots, blocks: [], zones: [],
    walls: [[0, 0, width, 0], [0, -depth, width, -depth], [0, 0, 0, -depth], [width, 0, width, -depth]],
    panels: [{ x: width - IN, z: -depth / 2, dir: 'W' }],
  });
}

export const ROOM_TYPES = {
  flat:  { label: '평면 전용', accepts: ['image'],          layout: (n) => flatLayout(n) },
  solid: { label: '입체 전용', accepts: ['model', 'splat'], layout: (n, cfg) => solidLayout(n, cfg.arrangement) },
  mixed: { label: '혼합',      accepts: ['image', 'model', 'splat'], layout: (n, cfg) => mixedLayout(cfg) },
};

export function clampCount(n) { return Math.min(MAX_ARTWORKS, Math.max(1, Math.round(Number(n)) || 1)); }

// 전시실 설정 → 틀. 모르는 유형이면 오류
export function makeLayout(config) {
  const type = ROOM_TYPES[config.type];
  if (!type) throw new Error(`알 수 없는 전시실 유형입니다: ${config.type}`);
  const count = clampCount(config.maxArtworks);
  return { ...type.layout(count, config), type, count };
}
