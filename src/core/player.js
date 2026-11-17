// 관람객(내 캐릭터): 이동 · 충돌 · 머리 위 닉네임. 전시실이 바뀌어도 그대로 유지된다.
import * as THREE from 'three';

export const PLAYER_R = 0.35;      // 충돌 반지름
export const WALK = 3.2, RUN = 6.0;
import { createNameTag } from './nametag.js';

// world = { colliders: [{minX,maxX,minZ,maxZ}], circles: [{x,z,r}] }
export function resolveCollisions(pos, world) {
  for (let pass = 0; pass < 3; pass++) {
    for (const b of world.colliders) {
      const nx = THREE.MathUtils.clamp(pos.x, b.minX, b.maxX), nz = THREE.MathUtils.clamp(pos.z, b.minZ, b.maxZ);
      const dx = pos.x - nx, dz = pos.z - nz, d2 = dx * dx + dz * dz;
      if (d2 >= PLAYER_R * PLAYER_R) continue;
      if (d2 > 1e-10) {                       // 모서리/면에 걸침 → 바깥으로 밀어냄
        const d = Math.sqrt(d2), push = (PLAYER_R - d) / d;
        pos.x += dx * push; pos.z += dz * push;
      } else {                                 // 상자 안쪽 → 가장 가까운 면으로
        const l = pos.x - b.minX, r = b.maxX - pos.x, t = pos.z - b.minZ, bt = b.maxZ - pos.z, m = Math.min(l, r, t, bt);
        if (m === l) pos.x = b.minX - PLAYER_R; else if (m === r) pos.x = b.maxX + PLAYER_R;
        else if (m === t) pos.z = b.minZ - PLAYER_R; else pos.z = b.maxZ + PLAYER_R;
      }
    }
    for (const c of world.circles) {           // 입체 작품 주변 원형 영역
      const dx = pos.x - c.x, dz = pos.z - c.z, min = c.r + PLAYER_R, d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      if (d2 > 1e-10) { const d = Math.sqrt(d2); pos.x = c.x + dx / d * min; pos.z = c.z + dz / d * min; }
      else pos.x = c.x + min;
    }
  }
}

export function createPlayer(scene, avatar) {
  const group = new THREE.Group();
  avatar.walkSpeed = WALK; avatar.runSpeed = RUN;
  group.add(avatar.group);

  // 머리 위 닉네임
  const tag = createNameTag(), nameTag = tag.sprite;
  group.add(nameTag);

  { // 바닥 그림자
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    s.rotation.x = -Math.PI / 2; s.position.y = 0.012; group.add(s);
  }
  group.visible = false;
  scene.add(group);
  const vel = new THREE.Vector2();          // (x, z) 속도
  // 점프: 캐릭터와 이름표만 위로 올린다 (그림자 · 충돌 · 카메라 기준은 바닥에 그대로)
  const JUMP_SPEED = 5.4, GRAVITY = 15, TAG_Y = nameTag.position.y;      // 약 0.97m 높이, 0.72초
  let jumpY = 0, jumpV = 0, jumps = 0;
  const applyJump = () => { avatar.group.position.y = jumpY; nameTag.position.y = TAG_Y + jumpY; avatar.air = Math.min(1, jumpY / 0.25); };

  return {
    group, nameTag, vel,
    get height() { return jumpY; },           // 지금 발이 떠 있는 높이(m)
    get jumps() { return jumps; },            // 지금까지 뛴 횟수 (게임 · 멀티플레이에서 사용)
    jump() { if (jumpY > 0 || jumpV > 0) return false; jumpV = JUMP_SPEED; jumps++; return true; },
    get position() { return group.position; },
    get speed() { return vel.length(); },
    setName: (name) => tag.set(name),
    setMedals: (medals) => tag.set(undefined, medals),      // 별명 옆에 훈장 표식
    teleport(x, z, yaw = 0) { group.position.set(x, 0, z); group.rotation.y = yaw; vel.set(0, 0); jumpY = jumpV = 0; applyJump(); },
    stop() { vel.set(0, 0); },
    // axis = 입력(x, y, run), yaw = 카메라가 보는 방향, world = 충돌 대상
    update(dt, axis, yaw, world) {
      if (jumpY > 0 || jumpV > 0) {             // 공중: 중력으로 내려옴
        jumpY += jumpV * dt; jumpV -= GRAVITY * dt;
        if (jumpY <= 0) jumpY = jumpV = 0;
        applyJump();
      }
      let ix = axis.x, iy = axis.y, mag = Math.hypot(ix, iy);
      if (mag > 1) { ix /= mag; iy /= mag; mag = 1; }
      if (mag < 0.12) { ix = iy = mag = 0; }
      const speed = axis.run ? RUN : WALK;
      const s = Math.sin(yaw), c = Math.cos(yaw);                 // 카메라가 보는 방향 기준으로 이동
      const tx = (c * ix - s * iy) * speed, tz = (-s * ix - c * iy) * speed;
      const a = 1 - Math.exp(-(mag ? 12 : 16) * dt);
      vel.x += (tx - vel.x) * a; vel.y += (tz - vel.y) * a;

      // 벽 뚫림 방지를 위해 작은 단계로 나눠 이동
      const steps = Math.max(1, Math.ceil(vel.length() * dt / (PLAYER_R * 0.5)));
      for (let i = 0; i < steps; i++) {
        group.position.x += vel.x * dt / steps;
        group.position.z += vel.y * dt / steps;
        resolveCollisions(group.position, world);
      }
      if (mag > 0) {   // 진행 방향으로 부드럽게 회전
        let d = Math.atan2(-tx, -tz) - group.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        group.rotation.y += d * (1 - Math.exp(-12 * dt));
      }
    },
  };
}
