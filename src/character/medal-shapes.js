// 훈장 모양: 선생님이 고르는 모양을 점(다각형)으로 정의한다.
// 같은 점을 교사 화면의 미리보기(SVG) · 별명표의 작은 표식(캔버스) · 캐릭터 가슴의 3D 훈장이 함께 쓴다.
// 좌표: 가운데 (0, 0), 반지름 약 1, y 는 위쪽이 +
//
// 훈장 하나 = { id, name, shape, metal(메달 색), ribbon(리본 색), name_color(이름 글자 색) }
const ring = (n, f) => Array.from({ length: n }, (_, i) => f(i / n * Math.PI * 2, i));

export const MEDAL_SHAPES = {
  circle:  { label: '동그라미', points: ring(28, (a) => [Math.sin(a), Math.cos(a)]) },
  star:    { label: '별',       points: ring(10, (a, i) => { const r = i % 2 ? 0.46 : 1.08; return [r * Math.sin(a), r * Math.cos(a)]; }) },
  shield:  { label: '방패',     points: [[-0.86, 0.95], [0.86, 0.95], [0.86, 0.1], [0.62, -0.5], [0, -1.05], [-0.62, -0.5], [-0.86, 0.1]] },
  heart:   { label: '하트',     points: ring(36, (a) => { const s = Math.sin(a), x = 16 * s * s * s, y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a); return [x / 16.5, (y + 2.5) / 16.5]; }) },
  flower:  { label: '꽃',       points: ring(48, (a) => { const r = 0.74 + 0.3 * Math.cos(6 * a); return [r * Math.sin(a), r * Math.cos(a)]; }) },
  hexagon: { label: '육각형',   points: ring(6, (a) => [1.02 * Math.sin(a), 1.02 * Math.cos(a)]) },
  diamond: { label: '마름모',   points: [[0, 1.1], [0.82, 0], [0, -1.1], [-0.82, 0]] },
  sun:     { label: '해',       points: ring(24, (a, i) => { const r = i % 2 ? 0.7 : 1.08; return [r * Math.sin(a), r * Math.cos(a)]; }) },
};
export const SHAPE_KEYS = Object.keys(MEDAL_SHAPES);
export const METALS = { '#ffd35a': '금', '#d9dee6': '은', '#d98b4a': '동', '#7ed6c4': '옥', '#f08fb0': '분홍' };
export const DEFAULT_MEDAL = { name: '', shape: 'star', metal: '#ffd35a', ribbon: '#c8372d', name_color: '#b8860b' };
export const MAX_MEDALS_ON_TAG = 5, MAX_MEDALS_ON_CHEST = 3;

const HEX = /^#[0-9a-f]{6}$/i;
export const medalPoints = (shape) => (MEDAL_SHAPES[shape] ?? MEDAL_SHAPES.circle).points;
// 받은 값이 이상해도 그릴 수 있게 다듬는다
export const cleanMedal = (m) => ({
  id: m?.id ?? '', name: String(m?.name ?? '').slice(0, 20), shape: MEDAL_SHAPES[m?.shape] ? m.shape : 'circle',
  metal: HEX.test(m?.metal) ? m.metal : DEFAULT_MEDAL.metal, ribbon: HEX.test(m?.ribbon) ? m.ribbon : DEFAULT_MEDAL.ribbon,
  name_color: HEX.test(m?.name_color) ? m.name_color : DEFAULT_MEDAL.name_color,
});

// 색을 조금 어둡게 (테두리 · 가운데 무늬용)
export function darker(hex, k = 0.72) {
  const n = parseInt(hex.slice(1), 16), c = (s) => Math.round(((n >> s) & 255) * k).toString(16).padStart(2, '0');
  return '#' + c(16) + c(8) + c(0);
}

// 훈장 그림(SVG 글): 위에 리본, 아래에 메달. 교사 화면의 미리보기와 훈장 이름 창에서 쓴다
export function medalSvg(medal) {
  const m = cleanMedal(medal), pts = medalPoints(m.shape).map(([x, y]) => `${(x * 15).toFixed(1)},${(-y * 15 + 4).toFixed(1)}`).join(' ');
  return `<svg viewBox="-20 -24 40 46" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
    + `<path d="M-9 -23H-1L4 -10H-4Z" fill="${m.ribbon}"/><path d="M9 -23H1L-4 -10H4Z" fill="${darker(m.ribbon, 0.8)}"/>`
    + `<polygon points="${pts}" fill="${m.metal}" stroke="${darker(m.metal)}" stroke-width="1.6" stroke-linejoin="round"/>`
    + `<circle cx="0" cy="4" r="4.2" fill="${darker(m.metal, 0.82)}" opacity=".7"/><circle cx="-4" cy="-1" r="2" fill="#fff" opacity=".55"/></svg>`;
}

// 캔버스에 작은 훈장 표식을 그린다 (cx, cy = 가운데, r = 반지름). 별명표에서 쓴다
export function drawMedal(g, medal, cx, cy, r) {
  const m = cleanMedal(medal), pts = medalPoints(m.shape);
  g.fillStyle = m.ribbon; g.fillRect(cx - r * 0.34, cy - r * 1.5, r * 0.68, r * 0.9);
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(cx + x * r, cy - y * r) : g.moveTo(cx + x * r, cy - y * r))); g.closePath();
  g.fillStyle = m.metal; g.fill(); g.lineWidth = Math.max(1.5, r * 0.14); g.strokeStyle = darker(m.metal); g.lineJoin = 'round'; g.stroke();
  g.beginPath(); g.arc(cx - r * 0.28, cy - r * 0.3, r * 0.16, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,.7)'; g.fill();
}
