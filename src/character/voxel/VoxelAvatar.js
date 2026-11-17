// 복셀 캐릭터: 부위별 메시 6개(가까이) + 단순화 메시 1개(멀리, LOD) + 걷기·대기 애니메이션
//
// 설정(config): { nickname, colors: { skin, hair, eye, top, bottom, shoes } }
//   colors 는 기본 모형의 영역별 색. (학생 추가 픽셀 · 교사 선물 아이템은 이후 단계에서 이 구조 위에 얹는다)
import * as THREE from 'three';
import { buildWorkModel, REGIONS, PARTS } from './model.js';
import { buildGeometry, downsample } from './mesher.js';
import { createItems } from '../items.js';

export const AVATAR_HEIGHT = 1.5;                 // 캐릭터 키(m). 격자 높이가 달라도 이 키에 맞춘다
export const LOD_DISTANCE = 10;                   // 카메라에서 이보다 멀면 단순화 모형으로 표시(m)

// 모든 캐릭터가 함께 쓰는 재질 (꼭짓점 색 + 가벼운 조명 계산)
const sharedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

export class VoxelAvatar {
  // opts.ownMaterial: 투명도를 따로 조절해야 하는 캐릭터(내 캐릭터)만 true
  constructor(config, { ownMaterial = false } = {}) {
    this.group = new THREE.Group();               // 원점 = 발바닥 중앙, 앞 = -z
    this.material = ownMaterial ? sharedMaterial.clone() : sharedMaterial;
    this.ownMaterial = ownMaterial;
    this.time = Math.random() * 10; this.phase = 0; this.move = 0; this.run = 0;
    this.walkSpeed = 3.2; this.runSpeed = 6.0;
    this.far = false; this.triangles = { near: 0, far: 0 };
    this.setConfig(config);
  }

  // 설정이나 기본 모형이 바뀌면 메시를 다시 만든다
  setConfig(config) {
    this._clear();
    // 기본 모형 + 영역 색 + 칸별 색칠 + 추가 픽셀이 적용된 작업 모형
    const model = buildWorkModel(config ?? {}), s = AVATAR_HEIGHT / model.baseSize[1];
    const colors = model.palette.map((p) => p && new THREE.Color(p.color));
    const center = [model.origin[0] + model.baseSize[0] / 2, 0, model.origin[2] + model.baseSize[2] / 2];

    // 가까이: 부위별 메시. 각 부위는 관절 위치를 원점으로 만들어 그 자리에서 회전한다
    const rig = this.rig = new THREE.Group(); this.group.add(rig);
    const bounds = model.partBounds();
    this.parts = {};
    for (const [i, name] of PARTS.entries()) {
      const b = bounds[name]; if (!b) continue;
      const cx = (b.min[0] + b.max[0] + 1) / 2, cz = (b.min[2] + b.max[2] + 1) / 2;
      const pivot = name === 'torso' ? center                                  // 몸통: 발바닥 중앙 기준
        : name === 'head' ? [cx, b.min[1], cz]                                 // 머리: 목(아래쪽 가운데)
        : [cx, b.max[1] + 1, cz];                                              // 팔·다리: 어깨·엉덩이(위쪽 가운데)
      const mesh = new THREE.Mesh(buildGeometry(model, { part: i + 1, origin: pivot, scale: s, colors }), this.material);
      mesh.position.set((pivot[0] - center[0]) * s, pivot[1] * s, (pivot[2] - center[2]) * s);
      rig.add(mesh); this.parts[name] = mesh;
      this.triangles.near += mesh.geometry.index.count / 3;
    }
    // 선물 아이템(후광 · 날개 · 훈장 …): 몸 크기에 맞춰 얹는다. 가까이 있을 때만 보인다
    this.items = null;
    this.config = config;
    const ids = config?.items ?? [], medals = this.medals ?? [];
    if ((ids.length || medals.length) && bounds.head && bounds.torso) {
      const h = bounds.head, tr = bounds.torso;
      const X = (v) => (v - center[0]) * s, Z = (v) => (v - center[2]) * s;
      this.items = createItems(ids, {
        headTop: (h.max[1] + 1) * s, headY: (h.min[1] + h.max[1] + 1) / 2 * s, headR: (h.max[0] + 1 - h.min[0]) / 2 * s, headBack: Z(h.max[2] + 1),
        shoulderY: (tr.max[1] + 1) * s, chestY: (tr.min[1] + (tr.max[1] + 1 - tr.min[1]) * 0.68) * s,
        chestFront: Z(tr.min[2]), back: Z(tr.max[2] + 1), torsoW: X(tr.max[0] + 1) - X(tr.min[0]),
      }, medals);
      rig.add(this.items);
    }

    // 멀리: 절반 해상도로 줄인 메시 하나 (팔다리는 움직이지 않음)
    const low = downsample(model);
    this.lod = new THREE.Mesh(buildGeometry(low, { origin: [center[0] / 2, 0, center[2] / 2], scale: s * 2, colors }), this.material);
    this.group.add(this.lod);
    this.triangles.far = this.lod.geometry.index.count / 3;

    this.setFar(this.far);
    this.update(0, 0);
  }

  // 받은 훈장 목록을 바꾼다 (가슴에 다는 훈장을 다시 만든다)
  setMedals(medals) { this.medals = medals ?? []; this.setConfig(this.config); }

  // 카메라와의 거리에 따라 가까이/멀리 모형 전환
  setFar(far) {
    this.far = far;
    if (this.rig) { this.rig.visible = !far; this.lod.visible = far; }
  }
  updateLod(cameraPosition, distance = LOD_DISTANCE) {
    const far = this.group.getWorldPosition(_v).distanceToSquared(cameraPosition) > distance * distance;
    if (far !== this.far) this.setFar(far);
  }

  // speed(m/s)에 따라 대기 ↔ 걷기 ↔ 뛰기를 자연스럽게 섞음
  update(dt, speed) {
    const k = 1 - Math.exp(-10 * dt);
    this.move += (Math.min(1, speed / this.walkSpeed) - this.move) * k;
    this.run += (THREE.MathUtils.clamp((speed - this.walkSpeed) / (this.runSpeed - this.walkSpeed), 0, 1) - this.run) * k;
    const mv = this.move, rn = this.run, idle = 1 - mv;
    this.time += dt;
    this.phase += dt * (8 + 4 * rn) * (mv > 0.02 ? 1 : 0);
    const t = this.time, sw = Math.sin(this.phase), breathe = Math.sin(t * 2.2);
    // 대기: 살짝 위아래로. 걷기·뛰기: 발을 디딜 때마다 통통
    const bob = mv * (0.02 + 0.035 * rn) * Math.abs(Math.cos(this.phase)) + idle * 0.014 * (breathe + 1);
    if (this.far) { this.lod.position.y = bob; return; }

    const p = this.parts, legAmp = mv * (0.65 + 0.4 * rn), armAmp = mv * (0.6 + 0.6 * rn);
    if (p.legL) p.legL.rotation.x = sw * legAmp;
    if (p.legR) p.legR.rotation.x = -sw * legAmp;
    if (p.armL) { p.armL.rotation.x = -sw * armAmp; p.armL.rotation.z = -(0.04 * breathe * idle + 0.1 * rn); }
    if (p.armR) { p.armR.rotation.x = sw * armAmp; p.armR.rotation.z = 0.04 * breathe * idle + 0.1 * rn; }
    this.rig.position.y = bob;
    this.rig.rotation.x = -(0.04 * mv + 0.16 * rn);                // 달릴수록 앞으로 숙임
    if (p.head) { p.head.rotation.x = 0.12 * rn; p.head.rotation.z = idle * 0.03 * Math.sin(t * 0.9) + mv * 0.03 * sw; }
    // 점프 중(air: 0 = 땅, 1 = 공중): 두 팔을 번쩍 들고 다리를 살짝 모은다
    const air = this.air ?? 0;
    if (air > 0.01) {
      if (p.armL) { p.armL.rotation.x += (-2.5 - p.armL.rotation.x) * air; p.armL.rotation.z = -0.25 * air; }
      if (p.armR) { p.armR.rotation.x += (-2.5 - p.armR.rotation.x) * air; p.armR.rotation.z = 0.25 * air; }
      if (p.legL) p.legL.rotation.x += (0.5 - p.legL.rotation.x) * air;
      if (p.legR) p.legR.rotation.x += (-0.35 - p.legR.rotation.x) * air;
    }
    this.items?.userData.tick(t);
  }

  setOpacity(o) {                                  // 내 캐릭터 전용 (ownMaterial)
    if (!this.ownMaterial || o === this._opacity) return;
    this._opacity = o;
    this.group.visible = o > 0.02;
    if (this.items) this.items.visible = o > 0.6;            // 카메라가 바짝 붙어 몸이 비쳐 보일 때는 아이템이 시야를 가리지 않게 숨김
    if (this.material.transparent !== o < 1) { this.material.transparent = o < 1; this.material.needsUpdate = true; }
    this.material.opacity = o;
  }

  _clear() {
    this.group.traverse((n) => n.geometry?.dispose());
    this.group.clear();
    this.triangles = { near: 0, far: 0 };
  }
  dispose() {
    this._clear(); this.group.removeFromParent();
    if (this.ownMaterial) this.material.dispose();
  }
}
const _v = new THREE.Vector3();

// 영역 색 기본값 { skin: '#…', … }
export const defaultColors = () => Object.fromEntries(REGIONS.map((r) => [r.key, r.color]));
