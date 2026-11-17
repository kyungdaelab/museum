// 받침대 (GLB · 스플랫 공용)
// JSON 의 sizeCm(실제 크기, cm)으로 어림해 먼저 만들고, 파일을 불러온 뒤 fit() 으로 실제 크기에 다시 맞춘다.
import * as THREE from 'three';
import { PEDESTAL_MAX_SIDE } from '../room/templates.js';
import { FONT, num } from './util.js';

const DEFAULT_H = 0.5;       // sizeCm 이 없을 때의 작품 높이(m)
const VIEW_Y = 1.25;         // 작품 중심이 오도록 맞추는 높이 → 받침대 높이가 여기서 정해짐

// 받침대 위에 뜨는 로딩 표시 (진행률 원 + 글자)
function makeProgressSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 192;
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sprite.scale.set(0.42, 0.42, 1); sprite.renderOrder = 10;
  sprite.userData.draw = (ratio, text) => {
    const g = c.getContext('2d');
    g.clearRect(0, 0, 192, 192);
    g.fillStyle = 'rgba(30,30,30,.78)'; g.beginPath(); g.arc(96, 96, 90, 0, Math.PI * 2); g.fill();
    g.lineWidth = 12; g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.arc(96, 96, 72, 0, Math.PI * 2); g.stroke();
    if (ratio > 0) { g.strokeStyle = '#6fb1ff'; g.beginPath(); g.arc(96, 96, 72, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, ratio)); g.stroke(); }
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${text.length > 4 ? 30 : 44}px ${FONT}`;
    g.fillText(text, 96, 99, 130);
    tex.needsUpdate = true;
  };
  return sprite;
}

export function makePedestal(art, slot, ctx) {
  const cm = art.sizeCm && typeof art.sizeCm === 'object' ? art.sizeCm : {};
  const want = { w: num(cm.width), h: num(cm.height), d: num(cm.depth) };      // 하나만 적어도 됨
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }));
  ctx.root.add(pedestal); ctx.camBlockers.push(pedestal);
  const circle = ctx.addCircle({ x: slot.x, z: slot.z, r: 0.5 });              // 작품 주변 원형 충돌 영역
  const label = makeProgressSprite(); ctx.root.add(label); label.visible = false;
  const state = { pedH: 0, status: 'idle' };
  const entry = { pick: [pedestal], near: 0.5, nx: 0, nz: 0, loaded: false, center: new THREE.Vector3(), radius: 0.3, sizeM: null };
  Object.defineProperty(entry, 'status', { get: () => state.status });

  const p = {
    entry, state, pedestal,
    // 작품 크기(m)에 맞춰 받침대 · 충돌 영역 · 감상 중심을 다시 계산
    fit(w, h, d) {
      // 작품보다 사방 12cm 넓게. 받침대끼리 2.5m 이상 떨어지도록 한 변은 최대 1.3m
      const side = THREE.MathUtils.clamp(Math.max(w, d) + 0.24, 0.4, PEDESTAL_MAX_SIDE);
      state.pedH = THREE.MathUtils.clamp(VIEW_Y - h / 2, 0.25, 1.1);           // 작은 작품은 높게, 큰 작품은 낮게
      pedestal.scale.set(side, state.pedH, side);
      pedestal.position.set(slot.x, state.pedH / 2, slot.z);
      circle.r = side * Math.SQRT1_2 + 0.02;                                   // 받침대 모서리까지 감싸는 원
      entry.near = circle.r;
      entry.center.set(slot.x, state.pedH + h / 2, slot.z);
      entry.radius = Math.hypot(w, h, d) / 2;
      entry.sizeM = { w, h, d };
    },
    // 축척: JSON 의 실제 크기(cm)에 맞춤. 높이 → 가로 → 깊이 순으로 먼저 적힌 값 하나를 기준으로 삼음
    scaleFor(size) {
      return want.h && size.y > 0 ? want.h / 100 / size.y
        : want.w && size.x > 0 ? want.w / 100 / size.x
        : want.d && size.z > 0 ? want.d / 100 / size.z
        : DEFAULT_H / Math.max(size.x, size.y, size.z);
    },
    showLabel(ratio, text) { label.visible = true; label.position.set(slot.x, state.pedH + (entry.sizeM?.h ?? 0.4) / 2, slot.z); label.userData.draw(ratio, text); },
    hideLabel() { label.visible = false; },
    onProgress: (ev) => p.showLabel(ev.total ? ev.loaded / ev.total : 0, ev.total ? Math.round(ev.loaded / ev.total * 100) + '%' : '불러오는 중'),
  };
  const h = (want.h ?? Math.max(want.w ?? 0, want.d ?? 0)) / 100 || DEFAULT_H;
  p.fit((want.w ?? want.d ?? 30) / 100, h, (want.d ?? want.w ?? 30) / 100);
  return p;
}
