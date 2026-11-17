// 입체 작품: GLB 를 받침대 위에 전시 (가까이 왔을 때만 불러오기, 크기·방향·바닥 자동 보정)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { disposeTree } from '../core/dispose.js';
import { makePedestal } from './pedestal.js';
import { rotationOf } from './util.js';

const ADDONS = 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/';
const LOAD_DIST = 12;                // 이 거리(m) 안으로 다가오면 파일을 불러오기 시작

let loader = null;
function getLoader(renderer) {       // Draco · Meshopt · KTX2 압축 GLB 도 읽을 수 있게 설정 (처음 쓸 때 한 번만)
  if (loader) return loader;
  loader = new GLTFLoader()
    .setDRACOLoader(new DRACOLoader().setDecoderPath(ADDONS + 'libs/draco/gltf/'))
    .setMeshoptDecoder(MeshoptDecoder);
  try { loader.setKTX2Loader(new KTX2Loader().setTranscoderPath(ADDONS + 'libs/basis/').detectSupport(renderer)); } catch { /* KTX2 미지원 기기 */ }
  return loader;
}

export function buildModel(art, slot, ctx) {
  if (slot.kind !== 'floor') throw new Error('입체 작품(model)은 바닥 자리에만 놓을 수 있습니다');
  if (typeof art.model !== 'string' || !art.model) throw new Error('model 항목에 GLB 파일 경로가 없습니다');
  const p = makePedestal(art, slot, ctx), { entry, state } = p;

  const place = (gltf) => {
    // 1) 방향 보정: JSON 의 rotation [x, y, z] (도 단위). 예) 누워 있는 스캔 → [-90, 0, 0]
    const pivot = new THREE.Group(); pivot.add(gltf.scene);
    pivot.rotation.copy(rotationOf(art));
    // 2) 보정된 방향 기준으로 바운딩박스 측정
    pivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(pivot, true), size = box.getSize(new THREE.Vector3());
    if (box.isEmpty() || !(size.x > 0 || size.y > 0 || size.z > 0)) throw new Error('모델에 보이는 형태가 없습니다');
    // 3) 축척을 실제 크기(cm)에 맞추고 받침대를 작품 크기에 맞춤
    const scale = p.scaleFor(size);
    p.fit(size.x * scale, size.y * scale, size.z * scale);
    // 4) 위치: 가운데를 받침대 중심에, 가장 낮은 점을 받침대 윗면에 맞춤
    const c = box.getCenter(new THREE.Vector3());
    pivot.scale.setScalar(scale);
    pivot.position.set(-c.x * scale, -box.min.y * scale, -c.z * scale);
    const holder = new THREE.Group(); holder.add(pivot);
    holder.position.set(slot.x, state.pedH, slot.z);
    ctx.root.add(holder);
    entry.pick = [p.pedestal, holder];
    holder.userData.artwork = entry;
    entry.loaded = true;
  };

  entry.update = (pos) => {
    if (state.status !== 'idle' || Math.hypot(pos.x - slot.x, pos.z - slot.z) > LOAD_DIST) return;
    state.status = 'loading';
    p.showLabel(0, '0%');
    getLoader(ctx.renderer).load(ctx.url(art.model),
      (gltf) => {
        if (!ctx.alive()) return disposeTree(gltf.scene);          // 불러오는 사이에 전시실에서 나감 → 바로 버림
        try { place(gltf); state.status = 'done'; p.hideLabel(); }
        catch (e) { disposeTree(gltf.scene); state.status = 'error'; p.showLabel(0, '표시 실패'); ctx.warn(`${art.model}: ${e.message}`, art); }
      },
      (ev) => { if (ctx.alive() && state.status === 'loading') p.onProgress(ev); },
      () => { if (!ctx.alive()) return; state.status = 'error'; p.showLabel(0, '불러오기 실패'); ctx.warn(`모델을 불러오지 못했습니다: ${art.model}`, art); });
  };
  return entry;
}
