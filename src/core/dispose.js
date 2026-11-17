// 자원 해제 도구: 전시실에서 나갈 때 GPU 메모리(형태·재질·텍스처·스플랫)를 완전히 돌려준다.
export function disposeTexture(tex) {
  tex.dispose();
  const data = tex.source?.data;
  if (data && typeof data.close === 'function') data.close();      // GLB 텍스처(ImageBitmap)는 따로 닫아야 메모리가 풀림
}

export function disposeMaterial(mat) {
  for (const v of Object.values(mat)) if (v?.isTexture) disposeTexture(v);
  mat.dispose();
}

// root 아래의 모든 물체를 장면에서 떼어 내고 해제한다.
// userData.dispose 가 있는 물체(예: 스플랫)는 그 함수에 맡기고 안쪽은 건드리지 않는다.
export function disposeTree(root) {
  const mats = new Set();
  const walk = (o) => {
    if (typeof o.userData.dispose === 'function') { o.userData.dispose(); return; }
    o.geometry?.dispose?.();
    if (o.material) for (const m of [].concat(o.material)) mats.add(m);
    if (o.isLight || o.isInstancedMesh) o.dispose?.();
    for (const c of [...o.children]) walk(c);
  };
  walk(root);
  mats.forEach(disposeMaterial);
  root.clear();
  root.removeFromParent();
}
