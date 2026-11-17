// 캐릭터 머리 위 닉네임표 (내 캐릭터와 다른 접속자가 함께 사용)
import * as THREE from 'three';
import { drawMedal, MAX_MEDALS_ON_TAG } from '../character/medal-shapes.js';

const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

export function createNameTag(text = '') {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.2, 0.3, 1); sprite.position.y = 1.8;
  // t = 별명, medals = 받은 훈장 목록 (별명 오른쪽에 작은 표식으로 그린다. 5개까지)
  let last = { text: '', medals: [] };
  const set = (t = last.text, medals = last.medals) => {
    last = { text: t, medals: medals ?? [] };
    const g = canvas.getContext('2d'), shown = last.medals.slice(0, MAX_MEDALS_ON_TAG), M = 52, mw = shown.length ? shown.length * M + 6 : 0;
    g.clearRect(0, 0, 512, 128);
    g.font = `600 52px ${FONT}`;
    const tw = Math.min(g.measureText(t).width, 432 - mw), w = Math.min(492, tw + mw + 60), x0 = 256 - w / 2;
    g.fillStyle = 'rgba(30,30,30,.72)';
    g.beginPath(); g.roundRect(x0, 24, w, 80, 40); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(t, x0 + 30 + tw / 2, 67, tw);
    shown.forEach((m, i) => drawMedal(g, m, x0 + 30 + tw + 10 + M / 2 + i * M, 72, 21));
    tex.needsUpdate = true;
  };
  if (text) set(text);
  return { sprite, set, dispose() { tex.dispose(); sprite.material.dispose(); sprite.removeFromParent(); } };
}
