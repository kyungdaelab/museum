// RoomBuilder: 전시실 설정(유형 · 최대 작품 수 · 테마)을 받아 공간을 만든다.
// 만든 것은 모두 room.root 아래에 두어, room.dispose() 한 번으로 장면에서 떼어 내고 메모리에서 해제한다.
//
// 설정 예:
//   { id, title, teacher, period: { start, end }, description,
//     type: 'flat' | 'solid', maxArtworks: 1~30, arrangement: 'grid' | 'circle' (입체 전용),
//     theme: { wall: 'white' | 'gray' | 'navy', floor: 'wood' | 'concrete' | 'carpet', brightness: 'dim' | 'normal' | 'bright' } }
import * as THREE from 'three';
import { disposeTree } from '../core/dispose.js';
import { makeLayout, WALL_H, WALL_T } from './templates.js';
import { resolveTheme } from './themes.js';

const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
export const DIRS = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

// 긴 글을 폭에 맞춰 줄바꿈 (한글은 글자 단위로 나눔)
function wrapLines(g, text, maxW, maxLines) {
  const lines = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const ch of para) {
      if (g.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch === ' ' ? '' : ch; }
      else line += ch;
    }
    lines.push(line);
  }
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/.$/, '…'); }
  return lines;
}
export function periodText(period) {
  if (!period) return '';
  if (typeof period === 'string') return period;
  return [period.start, period.end].filter(Boolean).join(' ~ ');
}

// 글자판 텍스처. rows = [{ text, size, weight, color, gap, maxLines }]
function textPanelTexture(rows, { w = 1024, h = 768, bg, fg }) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.textBaseline = 'top';
  let y = 70;
  for (const r of rows) {
    if (!r.text) continue;
    g.font = `${r.weight ?? 400} ${r.size}px ${FONT}`; g.fillStyle = r.color ?? fg;
    for (const line of wrapLines(g, r.text, w - 140, r.maxLines ?? 2)) { g.fillText(line, 70, y); y += r.size * 1.4; }
    y += r.gap ?? 16;
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function buildRoom({ scene, renderer }, config, { showSlots = false } = {}) {
  const layout = makeLayout(config), theme = resolveTheme(config.theme);
  const root = new THREE.Group(); root.name = `room:${config.id ?? ''}`;
  const colliders = [], circles = [], camBlockers = [], lights = [];
  const { width, depth } = layout;

  const matWall = new THREE.MeshStandardMaterial({ color: theme.walls.color, roughness: 0.95 });
  const matBase = new THREE.MeshStandardMaterial({ color: theme.walls.base, roughness: 0.8 });
  const addBox = (minX, maxX, minZ, maxZ, y0, y1, mat, { collide = true, block = true } = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, y1 - y0, maxZ - minZ), mat);
    m.position.set((minX + maxX) / 2, (y0 + y1) / 2, (minZ + maxZ) / 2);
    root.add(m);
    if (collide) colliders.push({ minX, maxX, minZ, maxZ });
    if (block) camBlockers.push(m);
    return m;
  };

  // 벽 (+ 걸레받이). y0 이 있으면 문 위 상인방이라 충돌 없음
  for (const [x1, z1, x2, z2, y0 = 0] of layout.walls) {
    const h = WALL_T / 2, minX = Math.min(x1, x2) - h, maxX = Math.max(x1, x2) + h, minZ = Math.min(z1, z2) - h, maxZ = Math.max(z1, z2) + h;
    addBox(minX, maxX, minZ, maxZ, y0, WALL_H, matWall, { collide: y0 === 0 });
    if (y0 === 0) addBox(minX - .02, maxX + .02, minZ - .02, maxZ + .02, 0, 0.1, matBase, { collide: false, block: false });
  }
  for (const b of layout.blocks) addBox(b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2, 0, b.h, matWall);

  // 바닥 · 천장
  const floorTex = theme.floors.make(renderer); floorTex.repeat.set(width / 2, depth / 2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ map: floorTex, roughness: theme.floors.roughness }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(width / 2, 0, -depth / 2); root.add(floor); camBlockers.push(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ color: theme.walls.ceil, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(width / 2, WALL_H, -depth / 2); root.add(ceil); camBlockers.push(ceil);

  // 천장 조명 패널(장식) — 하나의 물체로 묶어 그림
  {
    const nx = Math.max(1, Math.round(width / 4.5)), nz = Math.max(1, Math.round(depth / 4.5));
    const panels = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ color: 0xffffff }), nx * nz);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++)
      panels.setMatrixAt(i * nz + j, m.compose(new THREE.Vector3((i + .5) * width / nx, WALL_H - 0.01, -(j + .5) * depth / nz), q, one));
    root.add(panels);
  }
  // 실제 조명: 전체를 밝히는 빛 + 천장 점조명(성능을 위해 최대 6개) + 입체감용 방향 조명
  const addLight = (l) => { l.intensity *= theme.k; l.userData.base = l.intensity; root.add(l); lights.push(l); return l; };
  addLight(new THREE.HemisphereLight(0xffffff, 0xf0e6d6, 2.1));
  addLight(new THREE.DirectionalLight(0xffffff, 0.6)).position.set(-3, 8, 5);
  {
    let nx = Math.max(1, Math.round(width / 10)), nz = Math.max(1, Math.round(depth / 10));
    while (nx * nz > 6) { if (nx >= nz) nx--; else nz--; }
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++)
      addLight(new THREE.PointLight(0xfff6e8, 12, 26, 1.6)).position.set((i + .5) * width / nx, WALL_H - 0.5, -(j + .5) * depth / nz);
  }

  // 벽에 붙는 물체를 위치·방향에 맞춰 놓기 (dir = 바라보는 방향)
  const place = (obj, { x, z, dir }, y, off = 0.01) => {
    const [nx, nz] = DIRS[dir];
    obj.position.set(x + nx * off, y, z + nz * off); obj.rotation.y = Math.atan2(nx, nz); root.add(obj);
    return obj;
  };

  { // 입구 유리문 (장식)
    const g = new THREE.Group(), frame = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5 });
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(3, 2.6), new THREE.MeshBasicMaterial({ color: 0xcfe6f2 })));
    for (const [x, y, w, h] of [[-1.5, 0, .08, 2.7], [1.5, 0, .08, 2.7], [0, 0, .06, 2.6], [0, 1.33, 3.08, .08]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, .06), frame); b.position.set(x, y, 0.02); g.add(b);
    }
    place(g, layout.door, 1.3, WALL_T / 2 + 0.01);
  }

  { // 입구 안내판: 전시 제목 · 담당 교사 · 전시 기간 (세워 둔 판, 입구를 향함)
    const W = 2.6, H = 2.2, T = 0.16, b = layout.board, [nx] = DIRS[b.dir];
    addBox(b.x - T / 2, b.x + T / 2, b.z - W / 2, b.z + W / 2, 0, H, matWall);
    const tex = textPanelTexture([
      { text: layout.type.label + ' 전시실', size: 34, weight: 700, color: '#3d7be0', gap: 26 },
      { text: config.title || '제목 없는 전시', size: 78, weight: 700, gap: 44, maxLines: 3 },
      { text: config.teacher ? `담당 교사   ${config.teacher}` : '', size: 40, gap: 10 },
      { text: periodText(config.period) ? `전시 기간   ${periodText(config.period)}` : '', size: 40, gap: 34 },
      { text: config.description, size: 32, color: '#666', maxLines: 4 },
    ], { w: 1024, h: 866, bg: '#fffdf8', fg: '#2b2b2b' });
    place(new THREE.Mesh(new THREE.PlaneGeometry(W - 0.3, (W - 0.3) * 866 / 1024), new THREE.MeshBasicMaterial({ map: tex })),
      { x: b.x + nx * T / 2, z: b.z, dir: b.dir }, 1.2);
  }

  // 벽 설명 패널 (입체 전용 홀의 안쪽 벽): 전시 제목 · 설명
  for (const p of layout.panels) {
    const tex = textPanelTexture([
      { text: config.title || '제목 없는 전시', size: 96, weight: 700, gap: 40, maxLines: 2 },
      { text: config.description, size: 44, maxLines: 6, gap: 30 },
      { text: [config.teacher, periodText(config.period)].filter(Boolean).join('  ·  '), size: 36, color: theme.walls.text + 'aa' },
    ], { w: 1600, h: 900, fg: theme.walls.text });
    place(new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.15), new THREE.MeshBasicMaterial({ map: tex, transparent: true })), p, 2.15);
  }

  if (showSlots)       // 확인용: 자리 번호표 (파랑 = 벽, 주황 = 바닥)
    for (const [no, s] of Object.entries(layout.slots)) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = s.kind === 'wall' ? '#3d7be0' : '#e2893d'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.font = '700 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(no, 64, 68);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c) }));
      sp.scale.set(0.42, 0.42, 1);
      const [nx, nz] = s.kind === 'wall' ? DIRS[s.dir] : [0, 0];
      sp.position.set(s.x + nx * 0.1, s.kind === 'wall' ? 2.85 : 2.4, s.z + nz * 0.1); root.add(sp);
    }

  scene.add(root);
  const prevBg = scene.background;
  scene.background = new THREE.Color(theme.walls.bg);

  return {
    config, layout, theme, root, colliders, circles, camBlockers, lights,
    type: layout.type, slots: layout.slots, spawn: layout.spawn, wallH: WALL_H, textColor: theme.walls.text,
    zoneName(pos) { return layout.zones.find((z) => pos.x >= z.minX && pos.x <= z.maxX)?.name ?? ''; },
    // 전시실에서 나갈 때: 이 전시실이 만든 모든 3D 자원을 해제
    dispose() {
      disposeTree(root);
      colliders.length = circles.length = camBlockers.length = lights.length = 0;
      scene.background = prevBg;
    },
  };
}
