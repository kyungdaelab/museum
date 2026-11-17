// 렌더러 · 장면 · 카메라 (전시실과 무관하게 앱 전체에서 하나만 사용)
import * as THREE from 'three';

export function createEngine(canvas) {
  // 계단 현상 제거(antialias)는 스플랫을 그릴 때 부담이 커서 휴대폰·태블릿에서는 끔
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !matchMedia('(pointer: coarse)').matches });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe9e6df);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 150);

  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 72 : 60;           // 세로 화면에서는 시야를 넓게
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  return { renderer, scene, camera, canvas };
}
