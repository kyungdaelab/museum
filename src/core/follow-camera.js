// 3인칭 카메라: 캐릭터를 부드럽게 따라가고, 벽·받침대에 가리면 앞으로 당겨진다.
import * as THREE from 'three';

const DIST_MIN = 1.5, DIST_MAX = 9;

export function createFollowCamera(camera) {
  const cam = { yaw: 0, pitch: 0.28, dist: 4.5, curDist: 4.5 };
  const focus = new THREE.Vector3(0, 1.4, 0), dir = new THREE.Vector3(), ray = new THREE.Raycaster();

  return {
    cam,
    look(dx, dy, isTouch) {
      const k = isTouch ? 0.006 : 0.005;
      cam.yaw -= dx * k;
      cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy * k, -0.25, 1.25);
    },
    zoom(f) { cam.dist = THREE.MathUtils.clamp(cam.dist * f, DIST_MIN, DIST_MAX); },
    // 순간 이동(전시실 입장 등): 따라가는 지점과 방향을 즉시 맞춤
    snap(pos, yaw) { focus.set(pos.x, 1.4, pos.z); cam.yaw = yaw; cam.pitch = 0.28; cam.curDist = Math.min(cam.dist, 2); },
    // 반환값: 캐릭터 불투명도(0~1). 카메라가 너무 가까우면 캐릭터를 투명하게 하기 위함
    update(dt, pos, blockers) {
      const k = 1 - Math.exp(-10 * dt);
      focus.x += (pos.x - focus.x) * k;
      focus.z += (pos.z - focus.z) * k;
      const cp = Math.cos(cam.pitch);
      dir.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);

      // 캐릭터→카메라 방향으로 광선을 쏴서 벽·받침대·천장에 가리면 그 앞까지 당김
      ray.set(focus, dir); ray.far = cam.dist + 0.3;
      const hit = ray.intersectObjects(blockers, false)[0];
      const allowed = hit ? Math.max(0.3, Math.min(cam.dist, hit.distance - 0.3)) : cam.dist;
      if (allowed < cam.curDist) cam.curDist = allowed;                       // 당길 때는 즉시
      else cam.curDist += (allowed - cam.curDist) * (1 - Math.exp(-5 * dt));  // 멀어질 때는 천천히

      camera.position.copy(focus).addScaledVector(dir, cam.curDist);
      camera.lookAt(focus);
      return THREE.MathUtils.clamp((cam.curDist - 0.6) / 0.8, 0, 1);
    },
  };
}
