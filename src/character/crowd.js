// 성능 테스트용 가짜 관람객: 전시실 안을 돌아다니는 복셀 캐릭터 여러 명
// (실제 다른 접속자 표시는 이후 단계. 여기서는 30명을 그렸을 때의 부담만 확인한다)
import * as THREE from 'three';
import { VoxelAvatar } from './voxel/VoxelAvatar.js';
import { resolveCollisions } from '../core/player.js';

// room = buildRoom() 결과, count = 인원, config = 캐릭터 설정 (모두 같은 모습)
export function createCrowd(scene, room, count, config) {
  const group = new THREE.Group(); scene.add(group);
  const { width, depth } = room.layout, rnd = (a, b) => a + Math.random() * (b - a);
  const spot = () => ({ x: rnd(1, width - 1), z: rnd(-depth + 1, -1) });
  const people = Array.from({ length: count }, () => {
    const avatar = new VoxelAvatar(config);            // 캐릭터마다 메시를 따로 만든다 (실제로는 각자 모습이 다르므로)
    const p = spot();
    avatar.group.position.set(p.x, 0, p.z);
    resolveCollisions(avatar.group.position, room);
    group.add(avatar.group);
    return { avatar, target: spot(), speed: rnd(1.2, 3.2), wait: rnd(0, 3), cur: 0, stuck: 0 };
  });

  return {
    people,
    // 매 프레임: 목적지까지 걷고, 도착하면 잠깐 쉬었다가 새 목적지로. 카메라에서 멀면 단순화 모형으로 전환
    update(dt, cameraPosition) {
      let near = 0;
      for (const h of people) {
        const pos = h.avatar.group.position, dx = h.target.x - pos.x, dz = h.target.z - pos.z, d = Math.hypot(dx, dz);
        let want = 0;
        if (h.wait > 0) h.wait -= dt;
        else if (d < 0.3 || (h.stuck += dt) > 6) { h.target = spot(); h.wait = rnd(0.5, 4); h.speed = Math.random() < 0.15 ? 5.5 : rnd(1.2, 3.2); h.stuck = 0; }
        else want = h.speed;
        h.cur += (want - h.cur) * (1 - Math.exp(-8 * dt));
        if (h.cur > 0.05 && d > 1e-3) {
          pos.x += dx / d * h.cur * dt; pos.z += dz / d * h.cur * dt;
          resolveCollisions(pos, room);
          let turn = Math.atan2(-dx, -dz) - h.avatar.group.rotation.y;
          turn = Math.atan2(Math.sin(turn), Math.cos(turn));
          h.avatar.group.rotation.y += turn * (1 - Math.exp(-10 * dt));
        }
        h.avatar.updateLod(cameraPosition);
        h.avatar.update(dt, h.cur);
        if (!h.avatar.far) near++;
      }
      return { near, far: people.length - near };
    },
    dispose() { for (const h of people) h.avatar.dispose(); people.length = 0; group.removeFromParent(); },
  };
}
