// 전시실 테마: 벽 색 · 바닥 · 조명 밝기. 항목을 추가하면 선택지가 늘어난다.
import * as THREE from 'three';

// text = 벽에 쓰는 글자 색, base = 걸레받이, ceil = 천장, bg = 배경(문틈 등으로 보이는 바깥)
export const WALLS = {
  white: { label: '흰색',      color: 0xf6f4ef, text: '#2b2b2b', base: 0xb9b5ac, ceil: 0xfafafa, bg: 0xe9e6df },
  gray:  { label: '회색',      color: 0xaeb1b5, text: '#1f1f1f', base: 0x7d8084, ceil: 0xe9e9e9, bg: 0xc9cbce },
  navy:  { label: '짙은 남색', color: 0x1f2a44, text: '#f3efe4', base: 0x121a2c, ceil: 0x2a3146, bg: 0x141b2d },
};

function canvasTexture(draw, renderer) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
function speckle(g, n, colors, size) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i % colors.length];
    g.fillRect(Math.random() * 512, Math.random() * 512, size * (0.5 + Math.random()), size * (0.5 + Math.random()));
  }
}

// make(renderer) → 2m × 2m 를 덮는 반복 텍스처
export const FLOORS = {
  wood: {
    label: '나무', roughness: 0.55,
    make: (renderer) => canvasTexture((g) => {
      const rows = 8, rh = 512 / rows;
      for (let r = 0; r < rows; r++) {
        let x = -Math.random() * 200;
        while (x < 512) {
          const len = 180 + Math.random() * 160;
          g.fillStyle = `hsl(${32 + Math.random() * 5}, ${38 + Math.random() * 8}%, ${74 + Math.random() * 8}%)`;
          g.fillRect(x, r * rh, len, rh);
          g.strokeStyle = 'rgba(120,85,45,.10)';           // 나뭇결
          for (let i = 0; i < 7; i++) {
            const y = r * rh + 4 + Math.random() * (rh - 8);
            g.beginPath(); g.moveTo(x, y);
            g.bezierCurveTo(x + len * .3, y + 3, x + len * .6, y - 3, x + len, y + 1); g.stroke();
          }
          g.fillStyle = 'rgba(90,60,30,.35)'; g.fillRect(x + len - 1, r * rh, 1.5, rh);   // 이음매
          x += len;
        }
        g.fillStyle = 'rgba(90,60,30,.30)'; g.fillRect(0, r * rh, 512, 1.5);
      }
    }, renderer),
  },
  concrete: {
    label: '콘크리트', roughness: 0.8,
    make: (renderer) => canvasTexture((g) => {
      g.fillStyle = '#b8b6b1'; g.fillRect(0, 0, 512, 512);
      speckle(g, 2600, ['rgba(255,255,255,.07)', 'rgba(0,0,0,.06)', 'rgba(120,115,105,.08)'], 14);
      speckle(g, 1500, ['rgba(60,60,60,.10)', 'rgba(255,255,255,.10)'], 2.5);
      g.strokeStyle = 'rgba(70,70,70,.28)'; g.lineWidth = 2; g.strokeRect(0, 0, 512, 512);     // 2m 간격 줄눈
    }, renderer),
  },
  carpet: {
    label: '카펫', roughness: 1,
    make: (renderer) => canvasTexture((g) => {
      g.fillStyle = '#6f7684'; g.fillRect(0, 0, 512, 512);
      speckle(g, 9000, ['rgba(255,255,255,.07)', 'rgba(20,25,40,.10)', 'rgba(140,150,170,.10)'], 3);
    }, renderer),
  },
};

export const BRIGHTNESS = {
  dim:    { label: '어둡게', k: 0.6 },
  normal: { label: '보통',   k: 1 },
  bright: { label: '밝게',   k: 1.25 },
};

export const DEFAULT_THEME = { wall: 'white', floor: 'wood', brightness: 'normal' };

// 모르는 값이 들어오면 기본값으로
export function resolveTheme(theme = {}) {
  const pick = (table, key, fallback) => (Object.hasOwn(table, key) ? key : fallback);
  const wall = pick(WALLS, theme.wall, DEFAULT_THEME.wall), floor = pick(FLOORS, theme.floor, DEFAULT_THEME.floor);
  const brightness = pick(BRIGHTNESS, theme.brightness, DEFAULT_THEME.brightness);
  return { wall, floor, brightness, walls: WALLS[wall], floors: FLOORS[floor], k: BRIGHTNESS[brightness].k };
}
