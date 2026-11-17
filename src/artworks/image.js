// 평면 작품: 벽에 액자로 걸기 (원본 비율 유지, 액자 색 선택, 작품 위 스포트라이트)
import * as THREE from 'three';
import { DIRS } from '../room/RoomBuilder.js';
import { imageAspect, loadTexture, textTexture } from './util.js';

const HANG_Y = 1.55;                 // 액자 중심 높이 (눈높이)
const MAX_W = 1.5, MAX_H = 1.2;      // 그림이 차지할 수 있는 최대 크기(m)
const BAR = 0.05, MAT = 0.07, DEPTH = 0.06;   // 액자 테두리 폭, 여백(매트) 폭, 액자 두께

// frameColor 에 쓸 수 있는 이름. 이 밖에 "#rrggbb" 색상 코드도 가능
export const FRAME_COLORS = { black: '#222222', white: '#f5f5f2', wood: '#b07f4f', walnut: '#5b3a25', gold: '#c9a24a' };
function frameColor(v) {
  if (typeof v === 'string') {
    if (Object.hasOwn(FRAME_COLORS, v)) return FRAME_COLORS[v];
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  }
  return FRAME_COLORS.black;
}

function glowTexture() {     // 벽에 떨어지는 스포트라이트 빛
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 56, 6, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,240,205,1)'); gr.addColorStop(0.55, 'rgba(255,240,205,.45)'); gr.addColorStop(1, 'rgba(255,240,205,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export async function buildImage(art, slot, ctx) {
  if (slot.kind !== 'wall') throw new Error('평면 작품(image)은 벽 자리에만 걸 수 있습니다');
  const url = ctx.url(art.image);
  let tex;
  try { tex = await loadTexture(ctx, url); }
  catch { ctx.warn(`이미지를 불러오지 못했습니다: ${art.image}`, art); tex = textTexture(['이미지를 불러올 수 없습니다', art.title]); }
  if (!tex) return null;             // 불러오는 사이에 전시실에서 나감

  // 원본 비율을 유지하면서 최대 크기 안에 맞춤
  const aspect = imageAspect(tex, 4 / 3);
  let w = MAX_W, h = w / aspect;
  if (h > MAX_H) { h = MAX_H; w = h * aspect; }
  const outW = w + 2 * (MAT + BAR), outH = h + 2 * (MAT + BAR);

  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: frameColor(art.frameColor), roughness: 0.55 });
  const bar = (bw, bh, x, y) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, DEPTH), frameMat);
    m.position.set(x, y, DEPTH / 2); group.add(m);
  };
  bar(outW, BAR, 0, (outH - BAR) / 2); bar(outW, BAR, 0, -(outH - BAR) / 2);
  bar(BAR, outH - 2 * BAR, (outW - BAR) / 2, 0); bar(BAR, outH - 2 * BAR, -(outW - BAR) / 2, 0);
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(w + 2 * MAT, h + 2 * MAT), new THREE.MeshBasicMaterial({ color: 0xfbfaf6 }));
  mat.position.z = 0.02; group.add(mat);
  const picture = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  picture.position.z = 0.024; group.add(picture);

  // 스포트라이트: 천장 조명 기구 + 벽에 번지는 빛 (실제 광원이 아니라 작품이 많아도 가벼움)
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(outW + 1.0, outH + 1.5),
    new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.position.set(0, 0.2, 0.003); group.add(glow);
  const lamp = new THREE.Group();
  lamp.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.18, 12), new THREE.MeshStandardMaterial({ color: 0x2c2c2c, roughness: 0.6 })));
  const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.055, 12), new THREE.MeshBasicMaterial({ color: 0xfff3d6 }));
  bulb.rotation.x = Math.PI / 2; bulb.position.y = -0.092; lamp.add(bulb);
  lamp.position.set(0, ctx.wallH - HANG_Y - 0.12, 1.0); lamp.rotation.x = 0.5;     // 벽에서 1m 떨어져 작품을 향함
  group.add(lamp);

  const [nx, nz] = DIRS[slot.dir];
  group.position.set(slot.x + nx * 0.004, HANG_Y, slot.z + nz * 0.004);
  group.rotation.y = Math.atan2(nx, nz);
  ctx.root.add(group);
  return { pick: [picture], near: 0, nx, nz, imageUrl: url };
}
