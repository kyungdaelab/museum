// 작품 모듈 공용 도우미
import * as THREE from 'three';

export const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
export const num = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);

// JSON 의 rotation [x, y, z] (도 단위) → 회전값
export const rotationOf = (art) => new THREE.Euler(...[0, 1, 2].map((i) => THREE.MathUtils.degToRad(Number(art.rotation?.[i]) || 0)));

export const imageAspect = (tex, fallback = 1) =>
  (tex.image?.naturalWidth || tex.image?.width || fallback) / (tex.image?.naturalHeight || tex.image?.height || 1);

// 이미지가 없을 때 대신 보여 줄 글자판
export function textTexture(lines, w = 640, h = 480, bg = '#d9d6cf') {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = '#77736a'; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((t, i) => { g.font = `${i ? '' : '600 '}${i ? 28 : 34}px ${FONT}`; g.fillText(t ?? '', w / 2, h / 2 + (i - (lines.length - 1) / 2) * 50, w - 60); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 텍스처 불러오기. 전시실에서 이미 나갔으면(ctx.alive() === false) 받은 즉시 버리고 null
export async function loadTexture(ctx, url) {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  if (!ctx.alive()) { tex.dispose(); return null; }
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = ctx.renderer.capabilities.getMaxAnisotropy();
  return tex;
}
