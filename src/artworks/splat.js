// 가우시안 스플랫: .spz / .ply 를 받침대 위에 전시
// 평소에는 썸네일 그림만 세워 두고, 가까이 온 작품만(ArtworkManager 가 최대 2개로 제한) 실제 스플랫으로 바꿔 보여 준다.
import * as THREE from 'three';
import { makePedestal } from './pedestal.js';
import { imageAspect, loadTexture, rotationOf, textTexture } from './util.js';

let sparkPromise = null;
function getSpark(ctx) {              // 스플랫 작품이 처음 필요해질 때만 Spark 라이브러리를 내려받음 (전시실과 무관하게 한 번)
  return (sparkPromise ??= import('@sparkjsdev/spark').then((spark) => {
    ctx.scene.add(new spark.SparkRenderer({ renderer: ctx.renderer }));     // 스플랫을 일반 물체와 같은 장면에 깊이 순서대로 섞어 그림
    return spark;
  }));
}

// 크롭 범위 (방향 보정 후의 스캔 좌표계 기준) → 점이 범위 안인지 판정하는 함수
//   원형: { "type": "cylinder", "center": [x, z], "radius": r, "yMin": 아래, "yMax": 위 }   (yMin · yMax 는 생략 가능)
//   박스: { "type": "box", "min": [x, y, z], "max": [x, y, z] }
function cropTest(crop) {
  if (!crop || typeof crop !== 'object') return () => true;
  if (crop.type === 'cylinder') {
    const [cx = 0, cz = 0] = crop.center ?? [], r2 = (Number(crop.radius) || Infinity) ** 2;
    const y0 = crop.yMin ?? -Infinity, y1 = crop.yMax ?? Infinity;
    return (p) => p.y >= y0 && p.y <= y1 && (p.x - cx) ** 2 + (p.z - cz) ** 2 <= r2;
  }
  if (crop.type === 'box' && Array.isArray(crop.min) && Array.isArray(crop.max)) {
    const [x0, y0, z0] = crop.min, [x1, y1, z1] = crop.max;
    return (p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && p.z >= z0 && p.z <= z1;
  }
  throw new Error('crop 의 type 은 "cylinder" 또는 "box" 여야 합니다');
}

export function buildSplat(art, slot, ctx) {
  if (slot.kind !== 'floor') throw new Error('스플랫 작품(splat)은 바닥 자리에만 놓을 수 있습니다');
  if (typeof art.splat !== 'string' || !art.splat) throw new Error('splat 항목에 .spz / .ply 파일 경로가 없습니다');
  const inside = cropTest(art.crop);
  const p = makePedestal(art, slot, ctx), { entry, state } = p;
  let mesh = null, token = 0, aspect = 1;

  // 썸네일: 항상 관람객 쪽을 바라보는 그림. 스플랫이 보이는 동안에는 숨김
  const thumb = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(['3D 작품', art.title], 480, 480, '#e6e2d9') }));
  ctx.root.add(thumb);
  // 클릭 판정용 투명 상자 (스플랫 자체로 판정하면 무거우므로)
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  ctx.root.add(proxy); entry.pick.push(proxy);
  const layout = () => {
    const { w, h, d } = entry.sizeM;
    thumb.scale.set(Math.min(h * aspect, h * 1.6), h, 1); thumb.position.copy(entry.center);
    proxy.scale.set(Math.max(w, 0.05), h, Math.max(d, 0.05)); proxy.position.copy(entry.center);
  };
  layout();
  if (art.thumbnail)
    loadTexture(ctx, ctx.url(art.thumbnail)).then((tex) => {
      if (!tex) return;
      aspect = imageAspect(tex);
      thumb.material.map.dispose(); thumb.material.map = tex; thumb.material.transparent = true; thumb.material.needsUpdate = true;
      layout();
    }).catch(() => { if (ctx.alive()) ctx.warn(`썸네일을 불러오지 못했습니다: ${art.thumbnail}`, art); });

  const drop = () => {                // 스플랫을 장면에서 떼고 메모리에서 해제
    if (!mesh) return;
    mesh.removeFromParent(); mesh.dispose(); mesh = null;
  };

  entry.activate = async () => {      // 스플랫 불러와서 보여 주기
    const my = ++token, live = () => my === token && ctx.alive();
    state.status = 'loading'; p.showLabel(0, '0%');
    try {
      const { SplatMesh } = await getSpark(ctx);
      if (!live()) return;
      const raw = new SplatMesh({ url: ctx.url(art.splat), raycastable: false, onProgress: (ev) => { if (live()) p.onProgress(ev); } });
      await raw.initialized;
      if (!live()) return raw.dispose();               // 불러오는 사이에 멀어지거나 전시실에서 나감 → 바로 버림

      // 1) 방향 보정(rotation) 후 2) 크롭 범위 안의 스플랫만 새 묶음으로 옮김 → 배경(바닥·주변 사물)은 메모리에서도 사라짐
      const rot = new THREE.Quaternion().setFromEuler(rotationOf(art));
      const kept = new SplatMesh({ raycastable: false });
      const box = new THREE.Box3(), full = new THREE.Box3();
      let total = 0, count = 0;
      raw.forEachSplat((i, center, scales, quaternion, opacity, color) => {
        center.applyQuaternion(rot); full.expandByPoint(center); total++;
        if (!inside(center)) return;
        kept.pushSplat(center, scales, quaternion.premultiply(rot), opacity, color);
        box.expandByPoint(center); count++;
      });
      raw.dispose();
      const f = (b) => `x ${b.min.x.toFixed(2)}~${b.max.x.toFixed(2)}, y ${b.min.y.toFixed(2)}~${b.max.y.toFixed(2)}, z ${b.min.z.toFixed(2)}~${b.max.z.toFixed(2)}`;
      console.info(`[작품 ${art.id}] 스플랫 ${count}/${total}개 사용\n  전체 범위: ${f(full)}` + (count ? `\n  크롭 후 : ${f(box)}` : ''));   // crop 값을 정할 때 참고
      if (!count) { kept.dispose(); throw new Error('크롭 범위 안에 스플랫이 하나도 없습니다. 콘솔의 "전체 범위"를 보고 crop 값을 고쳐 주세요'); }

      // 3) 실제 크기(cm)에 맞춰 축척을 정하고 4) 가운데·바닥을 받침대에 맞춤
      const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3()), scale = p.scaleFor(size);
      p.fit(size.x * scale, size.y * scale, size.z * scale); layout();
      kept.scale.setScalar(scale);
      kept.position.set(slot.x - c.x * scale, state.pedH - box.min.y * scale, slot.z - c.z * scale);
      kept.userData.dispose = drop;                    // 전시실 전체 해제(disposeTree) 때도 같은 방법으로 정리
      mesh = kept; ctx.root.add(kept);
      state.status = 'active'; entry.loaded = true;
      thumb.visible = false; p.hideLabel();
    } catch (e) {
      if (!live()) return;
      state.status = 'error'; p.showLabel(0, '표시 실패');
      ctx.warn(`${art.splat}: ${e.message}`, art);
    }
  };
  entry.release = () => {             // 멀어지면 메모리에서 해제하고 썸네일로 되돌림
    token++; drop();
    state.status = 'idle'; entry.loaded = false;
    thumb.visible = true; p.hideLabel();
  };
  return entry;
}
