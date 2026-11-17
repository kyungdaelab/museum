// 전시실 평면도: 벽과 자리(슬롯)를 그린다. 마법사의 예시 그림과 작품 자리 배치에 함께 쓴다.
import { makeLayout, mixedCounts } from '../room/templates.js';
import { el } from './dom.js';

const DIR = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const SVG = 'http://www.w3.org/2000/svg';

// DB 의 전시실 값 → 공간 틀 (DB 의 유형 'sculpture' = 앱 안의 'solid')
const APP_TYPE = { flat: 'flat', sculpture: 'solid', mixed: 'mixed' };
export const layoutOf = (room) => makeLayout({ type: APP_TYPE[room.type] ?? 'flat', maxArtworks: room.max_artworks, arrangement: room.theme?.arrangement, flatCount: room.theme?.flatCount });
// 혼합형에서 벽 자리 수 (1 ~ 이 번호까지가 그림 자리, 그 뒤가 받침대 자리). 혼합형이 아니면 null
export const flatCountOf = (room) => (room.type === 'mixed' ? mixedCounts({ maxArtworks: room.max_artworks, flatCount: room.theme?.flatCount }).flat : null);

/* 평면도 요소 만들기.
   opts.slot(no, info) → 그 자리에 놓을 버튼 요소 (없으면 번호만 있는 점). info = { kind: 'wall' | 'floor' }
   위쪽이 북쪽, 왼쪽 초록 선이 입구 */
export function buildPlan(layout, opts = {}) {
  const { width, depth } = layout;
  const box = el('div', 'plan');
  box.style.aspectRatio = `${width + 0.8} / ${depth + 0.8}`;
  box.style.setProperty('--ratio', String((width + 0.8) / (depth + 0.8)));
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `-0.4 ${-depth - 0.4} ${width + 0.8} ${depth + 0.8}`);
  const line = (x1, z1, x2, z2, cls) => { const l = document.createElementNS(SVG, 'line'); l.setAttribute('x1', x1); l.setAttribute('y1', z1); l.setAttribute('x2', x2); l.setAttribute('y2', z2); l.setAttribute('class', cls); svg.append(l); };
  const floor = document.createElementNS(SVG, 'rect');
  floor.setAttribute('x', 0); floor.setAttribute('y', -depth); floor.setAttribute('width', width); floor.setAttribute('height', depth); floor.setAttribute('class', 'pFloor'); svg.append(floor);
  for (const [x1, z1, x2, z2, y0] of layout.walls) if (!y0) line(x1, z1, x2, z2, 'pWall');
  line(0, layout.door.z - 1.5, 0, layout.door.z + 1.5, 'pDoor');
  line(layout.board.x, layout.board.z - 1.3, layout.board.x, layout.board.z + 1.3, 'pBoard');
  box.append(svg);

  // 자리: 평면도 위에 겹쳐 놓는 버튼 (위치는 % 로 잡아 크기가 바뀌어도 따라감)
  const px = (x) => `${(x + 0.4) / (width + 0.8) * 100}%`, py = (z) => `${(z + depth + 0.4) / (depth + 0.8) * 100}%`;
  for (const [no, s] of Object.entries(layout.slots)) {
    const [nx, nz] = s.kind === 'wall' ? DIR[s.dir] : [0, 0];
    const node = opts.slot ? opts.slot(Number(no), s) : el('span', 'pDot ' + s.kind, no);
    node.style.left = px(s.x + nx * 0.75); node.style.top = py(s.z + nz * 0.75);      // 벽 자리는 벽에서 방 안쪽으로 조금 띄움
    box.append(node);
  }
  return box;
}
