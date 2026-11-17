// 캐릭터 머리 위 닉네임표 (내 캐릭터와 다른 접속자가 함께 사용)
import * as THREE from 'three';

const FONT = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

export function createNameTag(text = '') {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.2, 0.3, 1); sprite.position.y = 1.8;
  const set = (t) => {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, 512, 128);
    g.font = `600 52px ${FONT}`;
    const w = Math.min(492, g.measureText(t).width + 60);
    g.fillStyle = 'rgba(30,30,30,.72)';
    g.beginPath(); g.roundRect(256 - w / 2, 24, w, 80, 40); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(t, 256, 67, 470);
    tex.needsUpdate = true;
  };
  if (text) set(text);
  return { sprite, set, dispose() { tex.dispose(); sprite.material.dispose(); sprite.removeFromParent(); } };
}
