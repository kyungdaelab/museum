// 선물 아이템의 3D 모양과 반짝임 (후광 · 날개 · 훈장 · 왕관 · 망토 · 별가루)
// 캐릭터(VoxelAvatar)의 몸 위에 얹는다. 좌표: 원점 = 발바닥 중앙, 앞 = -z, 단위 m
//
// createItems(ids, body) → THREE.Group  (userData.tick(시간) 을 매 프레임 부르면 움직이고 반짝인다)
//   body = { headTop, headY, headR, headBack, shoulderY, chestY, chestFront, back, torsoW }
import * as THREE from 'three';
import { ITEM_IDS } from './item-list.js';
import { medalPoints, cleanMedal, darker, MAX_MEDALS_ON_CHEST } from './medal-shapes.js';
import { cleanGift, isMedal, MAX_GEAR } from './gift-kinds.js';

// 재질은 모든 캐릭터가 함께 쓴다 (캐릭터 30명이 있어도 재질 수는 늘지 않음)
const GOLD = new THREE.MeshBasicMaterial({ color: 0xffd35a });
const GOLD_DARK = new THREE.MeshBasicMaterial({ color: 0xe0a326 });
const GLOW = new THREE.MeshBasicMaterial({ color: 0xffe9a3, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const WHITE = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9aa6c4, side: THREE.DoubleSide });
const RED = new THREE.MeshLambertMaterial({ color: 0xc8372d, emissive: 0x3a0d0a, side: THREE.DoubleSide });
const GEM = new THREE.MeshBasicMaterial({ color: 0xe5484d });

let sparkMaterial = null;
function sparkMat() {                 // 네 갈래 별 모양의 반짝이 (빛을 더하는 방식이라 어두운 곳에서 더 잘 보임)
  if (sparkMaterial) return sparkMaterial;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,180,.75)'); gr.addColorStop(1, 'rgba(255,220,120,0)');
  g.fillStyle = gr;
  g.beginPath();
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 6 : 32; g.lineTo(32 + r * Math.cos(a), 32 + r * Math.sin(a)); }
  g.closePath(); g.fill();
  sparkMaterial = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(c), size: 0.13, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  return sparkMaterial;
}
// 반짝이 n개를 (cx, cy, cz) 둘레 반지름 r 안에 흩뿌린다
function sparkles(n, cx, cy, cz, r, seed = 1) {
  const pos = new Float32Array(n * 3); let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280) * 2 - 1;
  for (let i = 0; i < n; i++) { pos[i * 3] = rnd() * r; pos[i * 3 + 1] = rnd() * r * 0.8; pos[i * 3 + 2] = rnd() * r; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(geo, sparkMat()); p.position.set(cx, cy, cz); p.frustumCulled = false;
  return p;
}

const BUILDERS = {
  // 후광: 머리 위에 떠 있는 금빛 고리
  halo(b, ticks) {
    const g = new THREE.Group(), r = b.headR * 0.62;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 8, 28), GOLD);
    const glow = new THREE.Mesh(new THREE.TorusGeometry(r, 0.075, 8, 28), GLOW);
    ring.rotation.x = glow.rotation.x = Math.PI / 2;
    const sp = sparkles(5, 0, 0, 0, r * 1.2, 3);
    g.add(ring, glow, sp);
    ticks.push((t) => { g.position.set(0, b.headTop + 0.17 + 0.025 * Math.sin(t * 2), 0); g.rotation.z = 0.06 * Math.sin(t * 1.3); sp.rotation.y = t * 0.9; });
    return g;
  },
  // 왕관: 머리 위 금빛 띠와 뾰족한 다섯 장식
  crown(b) {
    const g = new THREE.Group(), r = b.headR * 0.5;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.07, 14, 1, true), GOLD_DARK); band.material.side = THREE.DoubleSide; band.position.y = 0.035;
    g.add(band);
    for (let i = 0; i < 5; i++) {
      const a = i * 2 * Math.PI / 5, spike = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.11, 4), GOLD);
      spike.position.set(r * Math.sin(a), 0.12, r * Math.cos(a)); g.add(spike);
    }
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), GEM); gem.position.set(0, 0.04, -r - 0.005); g.add(gem);
    g.add(sparkles(4, 0, 0.12, 0, r * 1.1, 7));
    g.position.set(0, b.headTop - 0.005, 0);
    return g;
  },
  // 날개: 등 뒤 양쪽의 하얀 날개 (천천히 펄럭임)
  wings(b, ticks) {
    const g = new THREE.Group();
    const shape = new THREE.Shape();           // 날개 한쪽 (어깨 = 원점, 바깥쪽 = +x)
    shape.moveTo(0, 0); shape.bezierCurveTo(0.1, 0.3, 0.42, 0.42, 0.5, 0.3);
    shape.bezierCurveTo(0.44, 0.2, 0.46, 0.12, 0.4, 0.06); shape.bezierCurveTo(0.38, -0.02, 0.32, -0.06, 0.28, -0.12);
    shape.bezierCurveTo(0.22, -0.2, 0.14, -0.22, 0.08, -0.26); shape.bezierCurveTo(0.03, -0.2, 0, -0.1, 0, 0);
    const sides = [];
    for (const dir of [1, -1]) {
      const wing = new THREE.Mesh(new THREE.ShapeGeometry(shape, 6), WHITE);
      wing.scale.x = dir; wing.position.set(dir * 0.04, b.shoulderY - 0.04, b.back + 0.03);
      g.add(wing); sides.push([wing, dir]);
    }
    g.add(sparkles(6, 0, b.shoulderY, b.back + 0.1, 0.42, 11));
    ticks.push((t) => { const f = 0.35 + 0.22 * Math.sin(t * 2.6); for (const [w, dir] of sides) w.rotation.y = dir * f; });
    return g;
  },
  // 훈장: 가슴의 리본과 금빛 메달
  medal(b, ticks) {
    const g = new THREE.Group();
    const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.012), RED); ribbon.position.y = 0.055;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.014, 16), GOLD); disc.rotation.x = Math.PI / 2;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.018, 5), GOLD_DARK); core.rotation.x = Math.PI / 2;
    const sp = sparkles(3, 0, 0, -0.03, 0.07, 5);
    g.add(ribbon, disc, core, sp);
    g.position.set(-b.torsoW * 0.22, b.chestY, b.chestFront - 0.012);
    ticks.push((t) => { sp.rotation.z = t * 1.6; });
    return g;
  },
  // 망토: 어깨에서 등 뒤로 늘어지는 붉은 천 (걸을 때처럼 살짝 흔들림)
  cape(b, ticks) {
    const w = b.torsoW * 1.25, h = Math.max(0.3, b.shoulderY - 0.16);
    const geo = new THREE.PlaneGeometry(w, h, 1, 4); geo.translate(0, -h / 2, 0);        // 위쪽 가장자리가 회전축
    const cloth = new THREE.Mesh(geo, RED);
    cloth.position.set(0, b.shoulderY + 0.02, b.back + 0.025);
    ticks.push((t) => { cloth.rotation.x = 0.16 + 0.07 * Math.sin(t * 2.1); });
    return cloth;
  },
  // 별가루: 몸 둘레를 도는 반짝이
  star(b, ticks) {
    const g = new THREE.Group(), a = sparkles(9, 0, 0, 0, 0.5, 21), c = sparkles(7, 0, 0, 0, 0.42, 33);
    g.add(a, c); g.position.y = b.headY * 0.72;
    ticks.push((t) => { a.rotation.y = t * 0.8; c.rotation.y = -t * 1.1; c.position.y = 0.12 * Math.sin(t * 1.4); });
    return g;
  },
};

// 선생님이 만든 훈장: 가슴에 나란히 단다 (모양 · 메달 색 · 리본 색은 훈장마다 다름)
const flatMaterials = new Map();          // 색 → 재질 (같은 색은 함께 씀)
const flat = (hex) => { if (!flatMaterials.has(hex)) flatMaterials.set(hex, new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide })); return flatMaterials.get(hex); };
function buildMedals(medals, b, ticks) {
  const g = new THREE.Group(), list = medals.slice(0, MAX_MEDALS_ON_CHEST).map(cleanMedal), R = 0.05, gap = Math.min(0.115, b.torsoW * 0.8 / Math.max(1, list.length));
  list.forEach((m, i) => {
    const one = new THREE.Group(), shape = new THREE.Shape(medalPoints(m.shape).map(([x, y]) => new THREE.Vector2(x * R, y * R)));
    const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(R * 0.9, R * 1.3), flat(m.ribbon)); ribbon.position.set(0, R * 1.25, 0.002);
    const disc = new THREE.Mesh(new THREE.ShapeGeometry(shape), flat(m.metal));
    const core = new THREE.Mesh(new THREE.CircleGeometry(R * 0.32, 12), flat(darker(m.metal, 0.8))); core.position.z = -0.002;
    one.add(ribbon, disc, core);
    one.position.set((i - (list.length - 1) / 2) * gap, 0, 0);
    g.add(one);
  });
  const sp = sparkles(2 + list.length, 0, 0, -0.03, 0.05 + gap * list.length / 2, 5);
  g.add(sp);
  g.position.set(0, b.chestY, b.chestFront - 0.012);
  ticks.push((t) => { sp.rotation.z = t * 1.6; });
  return g;
}

/* ── 선생님이 만든 꾸미기 아이템 (종류 + 색 + 효과) ──
   GEAR[종류](몸, 움직임 목록, 주 색, 둘째 색) → { node, at: [x, y, z] 효과가 붙는 자리, r: 효과 반지름 } */
const softMaterials = new Map();          // 색 → 빛을 받는 재질 (스스로도 조금 빛나서 어두운 전시실에서도 잘 보임)
const soft = (hex) => {
  if (!softMaterials.has(hex)) { const c = new THREE.Color(hex); softMaterials.set(hex, new THREE.MeshLambertMaterial({ color: c, emissive: c.clone().multiplyScalar(0.35), side: THREE.DoubleSide })); }
  return softMaterials.get(hex);
};
const glowMaterials = new Map();
const glow = (hex) => { if (!glowMaterials.has(hex)) glowMaterials.set(hex, new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); return glowMaterials.get(hex); };

const GEAR = {
  halo(b, ticks, c1) {
    const g = new THREE.Group(), r = b.headR * 0.62;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 8, 28), flat(c1)), aura = new THREE.Mesh(new THREE.TorusGeometry(r, 0.075, 8, 28), glow(c1));
    ring.rotation.x = aura.rotation.x = Math.PI / 2; g.add(ring, aura);
    ticks.push((t) => { g.position.set(0, b.headTop + 0.17 + 0.025 * Math.sin(t * 2), 0); g.rotation.z = 0.06 * Math.sin(t * 1.3); });
    return { node: g, at: [0, b.headTop + 0.17, 0], r: r * 1.2 };
  },
  wings(b, ticks, c1, c2) {
    const g = new THREE.Group(), shape = new THREE.Shape(), tip = new THREE.Shape();
    shape.moveTo(0, 0); shape.bezierCurveTo(0.1, 0.3, 0.42, 0.42, 0.5, 0.3);
    shape.bezierCurveTo(0.44, 0.2, 0.46, 0.12, 0.4, 0.06); shape.bezierCurveTo(0.38, -0.02, 0.32, -0.06, 0.28, -0.12);
    shape.bezierCurveTo(0.22, -0.2, 0.14, -0.22, 0.08, -0.26); shape.bezierCurveTo(0.03, -0.2, 0, -0.1, 0, 0);
    tip.moveTo(0.3, 0.3); tip.bezierCurveTo(0.4, 0.38, 0.47, 0.36, 0.5, 0.3); tip.bezierCurveTo(0.44, 0.2, 0.46, 0.12, 0.4, 0.06); tip.bezierCurveTo(0.36, 0.14, 0.34, 0.22, 0.3, 0.3);
    const sides = [];
    for (const dir of [1, -1]) {
      const wing = new THREE.Group(), feather = new THREE.Mesh(new THREE.ShapeGeometry(shape, 6), soft(c1)), edge = new THREE.Mesh(new THREE.ShapeGeometry(tip, 4), soft(c2));
      edge.position.z = 0.004; wing.add(feather, edge);
      wing.scale.x = dir; wing.position.set(dir * 0.04, b.shoulderY - 0.04, b.back + 0.03);
      g.add(wing); sides.push([wing, dir]);
    }
    ticks.push((t) => { const f = 0.35 + 0.22 * Math.sin(t * 2.6); for (const [w, dir] of sides) w.rotation.y = dir * f; });
    return { node: g, at: [0, b.shoulderY, b.back + 0.1], r: 0.42 };
  },
  crown(b, ticks, c1, c2) {
    const g = new THREE.Group(), r = b.headR * 0.5;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.07, 14, 1, true), flat(darker(c1, 0.85))); band.position.y = 0.035; g.add(band);
    for (let i = 0; i < 5; i++) { const a = i * 2 * Math.PI / 5, spike = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.11, 4), flat(c1)); spike.position.set(r * Math.sin(a), 0.12, r * Math.cos(a)); g.add(spike); }
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), flat(c2)); gem.position.set(0, 0.04, -r - 0.005); g.add(gem);
    g.position.set(0, b.headTop - 0.005, 0);
    return { node: g, at: [0, b.headTop + 0.12, 0], r: r * 1.1 };
  },
  cape(b, ticks, c1) {
    const w = b.torsoW * 1.25, h = Math.max(0.3, b.shoulderY - 0.16), geo = new THREE.PlaneGeometry(w, h, 1, 4); geo.translate(0, -h / 2, 0);
    const cloth = new THREE.Mesh(geo, soft(c1)); cloth.position.set(0, b.shoulderY + 0.02, b.back + 0.025);
    ticks.push((t) => { cloth.rotation.x = 0.16 + 0.07 * Math.sin(t * 2.1); });
    return { node: cloth, at: [0, b.shoulderY - h / 2, b.back + 0.12], r: w * 0.6 };
  },
  star(b, ticks) {
    const g = new THREE.Group(), a = sparkles(9, 0, 0, 0, 0.5, 21), c = sparkles(7, 0, 0, 0, 0.42, 33);
    g.add(a, c); g.position.y = b.headY * 0.72;
    ticks.push((t) => { a.rotation.y = t * 0.8; c.rotation.y = -t * 1.1; c.position.y = 0.12 * Math.sin(t * 1.4); });
    return { node: g, at: [0, b.headY * 0.72, 0], r: 0 };          // 스스로 반짝이므로 효과를 더 붙이지 않음
  },
  // 동물 귀: 머리 위 양쪽에 쫑긋 (가끔 까딱거림)
  ears(b, ticks, c1, c2) {
    const g = new THREE.Group(), x = b.headR * 0.56, pair = [];
    for (const dir of [1, -1]) {
      const ear = new THREE.Group(), outer = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 4), soft(c1)), inner = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.13, 3), flat(c2));
      outer.position.y = 0.1; outer.rotation.y = Math.PI / 4; outer.scale.z = 0.55;
      inner.position.set(0, 0.085, -0.036); inner.rotation.y = Math.PI; inner.scale.z = 0.3;
      ear.add(outer, inner); ear.position.set(dir * x, b.headTop - 0.03, 0); ear.rotation.z = -dir * 0.22;
      g.add(ear); pair.push([ear, dir]);
    }
    ticks.push((t) => { const k = Math.max(0, Math.sin(t * 0.9)) ** 8; for (const [e, dir] of pair) e.rotation.z = -dir * (0.22 + 0.3 * k); });
    return { node: g, at: [0, b.headTop + 0.12, 0], r: b.headR * 0.9 };
  },
  // 머리 리본: 머리 위 옆쪽의 큰 리본
  bow(b, ticks, c1, c2) {
    const g = new THREE.Group(), tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.17, 0.1), new THREE.Vector2(0.17, -0.1)]);
    for (const dir of [1, -1]) { const loop = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 0.05, bevelEnabled: false }), soft(c1)); loop.scale.x = dir; loop.position.z = -0.025; g.add(loop); }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), flat(c2)); g.add(knot);
    g.position.set(b.headR * 0.5, b.headTop + 0.055, -b.headR * 0.15); g.rotation.z = -0.28;
    ticks.push((t) => { g.scale.setScalar(1 + 0.04 * Math.sin(t * 3)); });
    return { node: g, at: [b.headR * 0.5, b.headTop + 0.07, -b.headR * 0.15], r: 0.2 };
  },
  // 목도리: 목을 두르고 앞으로 한 가닥 늘어뜨림 (줄무늬)
  scarf(b, ticks, c1, c2) {
    const g = new THREE.Group(), r = b.torsoW * 0.5;
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(r, 0.055, 8, 20), soft(c1)); wrap.rotation.x = Math.PI / 2; wrap.scale.set(1, (b.back - b.chestFront) / (2 * r) * 1.15, 1);
    wrap.position.set(0, b.shoulderY + 0.015, (b.back + b.chestFront) / 2);
    const tail = new THREE.Group(), cloth = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.028), soft(c1)); cloth.position.y = -0.1;
    tail.add(cloth);
    for (const y of [-0.1, -0.16]) { const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.094, 0.022, 0.032), flat(c2)); stripe.position.y = y; tail.add(stripe); }
    tail.position.set(b.torsoW * 0.2, b.shoulderY + 0.02, b.chestFront - 0.03);
    g.add(wrap, tail);
    ticks.push((t) => { tail.rotation.x = -0.08 + 0.07 * Math.sin(t * 2.3); });
    return { node: g, at: [0, b.shoulderY, b.chestFront - 0.06], r: r * 1.3 };
  },
  // 풍선: 손에 묶인 줄 끝에서 머리 위로 둥실
  balloon(b, ticks, c1) {
    const g = new THREE.Group(), x = b.torsoW * 0.5 + 0.2, top = b.headTop + 0.5, hand = b.chestY - 0.12;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), soft(c1)); ball.scale.y = 1.15;
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), flat('#ffffff')); shine.position.set(-0.07, 0.08, -0.13);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.05, 6), flat(darker(c1))); knot.position.y = -0.21;
    const len = top - 0.2 - hand, string = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, len, 4), flat('#8a8272')); string.position.y = -0.22 - len / 2;
    g.add(ball, shine, knot, string);
    ticks.push((t) => { g.position.set(x + 0.03 * Math.sin(t * 1.1), top + 0.035 * Math.sin(t * 1.7), 0.02 * Math.cos(t * 0.9)); g.rotation.z = 0.07 * Math.sin(t * 1.1); });
    return { node: g, at: [x, top, 0], r: 0.26 };
  },
  // 꼬마 친구: 어깨 옆에서 날갯짓하며 따라다니는 작은 친구
  pet(b, ticks, c1, c2) {
    const g = new THREE.Group(), body = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), soft(c1));
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.05, 4), flat(darker(c2, 0.9))); beak.rotation.x = -Math.PI / 2; beak.position.set(0, -0.005, -0.095);
    g.add(body, beak);
    for (const dir of [1, -1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), flat('#2b2b2b')); eye.position.set(dir * 0.034, 0.025, -0.074); g.add(eye); }
    const flaps = [];
    for (const dir of [1, -1]) { const wing = new THREE.Mesh(new THREE.CircleGeometry(0.06, 10), soft(c2)); wing.scale.y = 0.6; wing.position.set(dir * 0.085, 0.01, 0.01); g.add(wing); flaps.push([wing, dir]); }
    const cx = -(b.torsoW * 0.5 + 0.24), cy = b.headY + 0.05;
    ticks.push((t) => {
      g.position.set(cx + 0.07 * Math.sin(t * 1.3), cy + 0.06 * Math.sin(t * 2.4), 0.05 + 0.08 * Math.cos(t * 1.3));
      g.rotation.y = 0.35 * Math.sin(t * 1.3);
      const f = Math.sin(t * 16); for (const [w, dir] of flaps) w.rotation.y = dir * (0.5 + 0.7 * f);
    });
    return { node: g, at: [cx, cy, 0.05], r: 0.2 };
  },
};

// 받은 아이템 목록 → 3D. 같은 종류는 처음 것 하나만, 모두 MAX_GEAR 개까지
function buildGear(gear, b, ticks) {
  const g = new THREE.Group(), seen = new Set();
  for (const raw of gear) {
    const it = cleanGift(raw);
    if (it.kind === 'medal' || !GEAR[it.kind] || seen.has(it.kind) || seen.size >= MAX_GEAR) continue;
    seen.add(it.kind);
    const { node, at, r } = GEAR[it.kind](b, ticks, it.metal, it.ribbon);
    node.name = 'gear:' + it.kind; g.add(node);
    if (r > 0 && it.effect !== 'none') {                // 효과: 반짝이 = 별빛이 천천히 돌며 반짝 / 깜빡이 = 별빛과 아이템이 깜빡깜빡
      const sp = sparkles(it.effect === 'blink' ? 7 : 5, at[0], at[1], at[2], r, seen.size * 7 + 3); g.add(sp);
      const phase = seen.size * 1.7;
      if (it.effect === 'blink') ticks.push((t) => { const on = Math.sin(t * 7 + phase) > -0.2; sp.visible = on; sp.rotation.y = t * 2.2; node.scale.setScalar(on ? 1.05 : 0.97); });
      else ticks.push((t) => { sp.rotation.y = t * 0.9 + phase; sp.position.y = at[1] + 0.03 * Math.sin(t * 1.5 + phase); });
    }
  }
  return g;
}

// ids: 착용한 선물 아이템 id 목록 (모르는 id 는 건너뜀),  medals: 받은 훈장 목록,  gear: 받은 꾸미기 아이템 목록
export function createItems(ids, body, medals = [], gear = []) {
  const group = new THREE.Group(), ticks = [];
  for (const id of ITEM_IDS) {                       // 목록 순서대로 (같은 아이템을 두 번 달지 않음)
    if (!ids?.includes(id) || !BUILDERS[id]) continue;
    const node = BUILDERS[id](body, ticks); node.name = 'item:' + id; group.add(node);
  }
  if (medals.length) { const node = buildMedals(medals, body, ticks); node.name = 'medals'; group.add(node); }
  if (gear.length) { const node = buildGear(gear, body, ticks); node.name = 'gear'; group.add(node); }
  group.userData.tick = (t) => {
    for (const f of ticks) f(t);
    if (sparkMaterial) sparkMaterial.size = 0.1 + 0.05 * Math.abs(Math.sin(t * 3.1));      // 다 같이 반짝반짝
  };
  group.userData.count = group.children.length;
  group.userData.tick(0);
  return group;
}
