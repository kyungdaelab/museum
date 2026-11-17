// 입체 작품 감상 모드: 카메라가 작품 쪽으로 다가가 작품을 중심으로 돌려 볼 수 있고, 닫으면 원래 3인칭 시점으로 돌아간다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fillInfo } from './artwork-panel.js';

const $ = (id) => document.getElementById(id);
const ease = (x) => x * x * (3 - 2 * x);

/* opts: camera, canvas, scene
         getLights()  : 지금 전시실의 조명 목록 (감상 중 어둡게 했다가 되돌림. 각 조명의 userData.base = 원래 밝기)
         onOpen(), onClose() : 캐릭터 숨기기/보이기 등 */
export function createViewer({ camera, canvas, scene, getLights, onOpen, onClose }) {
  const v = { mode: 'off', art: null, t: 0, fromPos: new THREE.Vector3(), fromQuat: new THREE.Quaternion(), toPos: new THREE.Vector3(), toQuat: new THREE.Quaternion() };
  const orbit = new OrbitControls(camera, canvas);
  orbit.enabled = false; orbit.enablePan = false; orbit.enableDamping = true; orbit.dampingFactor = 0.08;
  orbit.autoRotateSpeed = 1.6; orbit.maxPolarAngle = Math.PI * 0.5;      // 작품 중심보다 아래로는 내려가지 않음(바닥 뚫림 방지)
  // 감상용 조명: 평소에는 꺼 두고(밝기 0) 감상 모드에서만 켬. 전시실과 무관하게 하나만 둠
  const light = new THREE.DirectionalLight(0xfff4e0, 0);
  scene.add(light, light.target);
  const el = $('viewer'), azEl = $('viewAz'), elEl = $('viewEl'), autoEl = $('viewAuto');

  const setFocus = (k) => {          // k: 0 = 평소 조명, 1 = 주변을 어둡게 하고 작품에 조명 집중
    for (const l of getLights()) l.intensity = l.userData.base * (1 - 0.6 * k);
    light.intensity = 3.2 * k;
  };
  const aim = () => {
    if (!v.art) return;
    const az = THREE.MathUtils.degToRad(+azEl.value), e = THREE.MathUtils.degToRad(+elEl.value), c = v.art.center;
    light.position.set(c.x + Math.cos(e) * Math.sin(az) * 5, c.y + Math.sin(e) * 5, c.z + Math.cos(e) * Math.cos(az) * 5);
    light.target.position.copy(c);
  };
  const setAuto = (on) => { orbit.autoRotate = on; autoEl.classList.toggle('sel', on); autoEl.textContent = '자동 회전 ' + (on ? '켜짐' : '꺼짐'); };
  const hideUi = () => { el.classList.add('hidden'); document.body.classList.remove('viewing'); };

  const api = {
    orbit, light,
    get mode() { return v.mode; },
    get art() { return v.art; },
    open(a) {
      if (!a.loaded || v.mode !== 'off') return false;      // 아직 불러오는 중이면 열지 않음
      v.art = a; v.mode = 'in'; v.t = 0;
      // 지금 카메라가 있는 쪽에서 작품을 바라보는 자리로 이동
      const dist = THREE.MathUtils.clamp(a.radius * 3.2, 0.9, 2.6);
      const dir = camera.position.clone().sub(a.center); dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      dir.normalize().multiplyScalar(Math.cos(0.25)).setY(Math.sin(0.25));
      v.fromPos.copy(camera.position); v.fromQuat.copy(camera.quaternion);
      v.toPos.copy(a.center).addScaledVector(dir, dist);
      v.toQuat.setFromRotationMatrix(new THREE.Matrix4().lookAt(v.toPos, a.center, camera.up));
      orbit.target.copy(a.center);
      orbit.minDistance = Math.max(0.25, a.radius * 1.15); orbit.maxDistance = Math.max(dist * 1.5, 2.2);
      setAuto(true); aim(); fillInfo('view', a);
      el.classList.remove('hidden', 'info'); document.body.classList.add('viewing');
      el.classList.toggle('unlit', a.kind === 'splat');      // 스플랫은 촬영 당시의 빛이 담겨 있어 조명 조절이 없음
      onOpen?.();
      return true;
    },
    close() {
      if (v.mode !== 'in' && v.mode !== 'on') return;
      orbit.enabled = false; v.mode = 'out'; v.t = 0;
      v.fromPos.copy(camera.position); v.fromQuat.copy(camera.quaternion);
      hideUi(); onClose?.();
    },
    // 전시실에서 나갈 때: 돌아가는 움직임 없이 즉시 종료
    forceClose() {
      if (v.mode === 'off') return;
      orbit.enabled = false; v.mode = 'off'; v.art = null;
      setFocus(0); hideUi(); onClose?.();
    },
    // follow(dt) : 3인칭 카메라 위치를 계산해 camera 에 넣는 함수 (닫을 때 그쪽으로 부드럽게 복귀)
    update(dt, follow) {
      v.t = Math.min(1, v.t + dt / 0.7);
      const k = ease(v.t);
      if (v.mode === 'in') {
        camera.position.lerpVectors(v.fromPos, v.toPos, k);
        camera.quaternion.slerpQuaternions(v.fromQuat, v.toQuat, k);
        setFocus(k);
        if (v.t >= 1) { v.mode = 'on'; orbit.enabled = true; }
      } else if (v.mode === 'on') {
        orbit.update(dt);
      } else if (v.mode === 'out') {
        follow(dt);
        v.toPos.copy(camera.position); v.toQuat.copy(camera.quaternion);
        camera.position.lerpVectors(v.fromPos, v.toPos, k);
        camera.quaternion.slerpQuaternions(v.fromQuat, v.toQuat, k);
        setFocus(1 - k);
        if (v.t >= 1) { v.mode = 'off'; v.art = null; }
      }
    },
  };
  azEl.addEventListener('input', aim); elEl.addEventListener('input', aim);
  autoEl.addEventListener('click', () => setAuto(!orbit.autoRotate));
  $('viewClose').addEventListener('click', api.close);
  $('viewInfoBtn').addEventListener('click', () => el.classList.toggle('info'));
  return api;
}
