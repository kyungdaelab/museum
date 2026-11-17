// 멀티플레이: 같은 전시실의 다른 관람객 보여 주기
// 캐릭터 데이터는 입장할 때 한 번만 주고받고, 그 뒤로는 위치 · 방향 · 속도만 보낸다.
//
// 주고받는 것 (전시실별 통로, src/net/transport.js)
//   hello : { nick, av, re }   입장 인사. av = 캐릭터를 얻는 방법
//             { ref, ver }  로그인한 학생 → 서버에 저장된(검사·관리되는) 캐릭터를 id 로 한 번 받아 옴
//             { data }      로그인 전 → 압축 문자열을 직접 보냄. 서버에 연결된 상태에서는 색만 보냄(아래 myAvatar 참고)
//           re = 답장 여부. 새로 온 사람의 hello 를 받으면 내 hello 를 그 사람에게만 답장한다
//   pos   : [x, z, 방향, 속도]  0.1초마다(움직일 때), 가만히 있으면 1초마다
//   who   : 모르는 사람의 pos 를 받았을 때 hello 를 다시 요청
//   bye   : 퇴장
import * as THREE from 'three';
import { openTransport } from './transport.js';
import { backendEnabled } from '../data/backend.js';
import { currentStudent as currentUser } from '../data/student-auth.js';
import { fetchAvatar, safeDecode } from '../data/avatars.js';
import { encodeAvatar } from '../character/voxel/codec.js';
import { stripEdits } from '../character/voxel/validate.js';
import { VoxelAvatar } from '../character/voxel/VoxelAvatar.js';
import { defaultConfig } from '../character/config.js';
import { createNameTag } from '../core/nametag.js';

const SEND_MS = 100, KEEPALIVE_MS = 1000, TIMEOUT_MS = 8000, MAX_REMOTE = 40;
const round = (v) => Math.round(v * 100) / 100;

// me = { nickname, config }.  반환값의 update() 를 매 프레임 불러 준다
export async function joinRoom({ roomId, scene, me }) {
  const user = await currentUser().catch(() => null);
  let guestId = '';
  try { guestId = sessionStorage.getItem('vmuseum.guest') || ''; if (!guestId) sessionStorage.setItem('vmuseum.guest', guestId = 'guest-' + crypto.randomUUID()); }
  catch { guestId = 'guest-' + Math.random().toString(36).slice(2); }
  const myId = user?.id ?? guestId;
  const transport = await openTransport(roomId, myId);
  const group = new THREE.Group(); scene.add(group);
  const remotes = new Map();
  let alive = true, lastSent = 0, lastPos = '';

  // 내 캐릭터를 남에게 알리는 방법.
  //   로그인한 학생: 서버에 저장된 캐릭터를 가리키는 id 만 보낸다 (서버가 검사했고 교사가 관리할 수 있는 데이터)
  //   로그인 전: 서버에 연결된 상태에서는 색만 보낸다 → 검사·관리되지 않은 픽셀 그림이 다른 사람에게 보이지 않게
  //             (서버 없이 탭끼리 시험할 때는 전체를 보냄)
  const myAvatar = () => (user ? { ref: user.id, ver: me.version ?? '' }
    : { data: encodeAvatar(backendEnabled() ? stripEdits(me.config) : me.config) });
  const hello = (to, re = false) => transport.send('hello', { nick: me.nickname, av: myAvatar(), re }, to);

  function remove(id) {
    const r = remotes.get(id); if (!r) return;
    r.avatar?.dispose(); r.tag.dispose(); r.group.removeFromParent(); remotes.delete(id);
  }
  async function onHello(id, p) {
    let r = remotes.get(id);
    if (!r) {
      if (remotes.size >= MAX_REMOTE) return;
      r = { group: new THREE.Group(), avatar: null, tag: createNameTag(), key: '', placed: false, tx: 0, tz: 0, try: 0, speed: 0, cur: 0, last: performance.now() };
      r.group.visible = false; r.group.add(r.tag.sprite); group.add(r.group); remotes.set(id, r);
    }
    r.last = performance.now();
    const nick = typeof p?.nick === 'string' ? Array.from(p.nick).slice(0, 12).join('') : '';
    r.tag.set(nick || '관람객');
    // 캐릭터 데이터는 달라졌을 때만 다시 받는다
    const av = p?.av ?? {}, key = typeof av.ref === 'string' ? `ref:${av.ref}@${av.ver ?? ''}` : typeof av.data === 'string' ? av.data : '';
    if (key === r.key && r.avatar) return;
    r.key = key;
    const cfg = (typeof av.ref === 'string' ? await fetchAvatar(av.ref, av.ver ?? '') : typeof av.data === 'string' && av.data.length <= 60000 ? safeDecode(av.data) : null) ?? defaultConfig();
    if (!alive || remotes.get(id) !== r || r.key !== key) return;       // 받는 사이에 나갔거나 또 바뀜
    r.avatar?.dispose();
    r.avatar = new VoxelAvatar(cfg); r.group.add(r.avatar.group);
  }
  transport.onMessage = (type, p, from) => {
    if (!alive || typeof from !== 'string') return;
    if (type === 'hello') { onHello(from, p); if (!p?.re) hello(from, true); }
    else if (type === 'who') hello(from, true);
    else if (type === 'bye') remove(from);
    else if (type === 'pos' && Array.isArray(p) && p.every(Number.isFinite)) {
      const r = remotes.get(from);
      if (!r) return transport.send('who', null, from);
      [r.tx, r.tz, r.try, r.speed] = p; r.last = performance.now();
      if (!r.placed) { r.placed = true; r.group.position.set(r.tx, 0, r.tz); r.group.rotation.y = r.try; r.group.visible = true; }
    }
  };
  hello();
  const onUnload = () => transport.send('bye', null);
  window.addEventListener('pagehide', onUnload);

  return {
    myId, kind: transport.kind,
    get count() { return remotes.size + 1; },          // 나를 포함한 인원
    remotes,
    // 내 닉네임 · 캐릭터가 바뀌었을 때 (전시실 안에서 다시 꾸민 경우)
    setMe(next) { Object.assign(me, next); hello(); },
    // 매 프레임: 내 위치 보내기 + 다른 사람 움직임 부드럽게 따라가기. local = { x, z, ry, speed }
    update(dt, cameraPosition, local) {
      const now = performance.now(), pos = [round(local.x), round(local.z), round(local.ry), round(local.speed)], key = pos.join();
      if (now - lastSent >= (key === lastPos ? KEEPALIVE_MS : SEND_MS)) { transport.send('pos', pos); lastSent = now; lastPos = key; }
      const k = 1 - Math.exp(-12 * dt);
      for (const [id, r] of remotes) {
        if (now - r.last > TIMEOUT_MS) { remove(id); continue; }       // 소식이 끊긴 사람은 정리
        if (!r.placed) continue;
        const g = r.group;
        g.position.x += (r.tx - g.position.x) * k; g.position.z += (r.tz - g.position.z) * k;
        let d = r.try - g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); g.rotation.y += d * k;
        r.cur += (r.speed - r.cur) * k;
        if (r.avatar) { r.avatar.updateLod(cameraPosition); r.avatar.update(dt, r.cur); }
      }
    },
    dispose() {
      if (!alive) return;
      alive = false;
      window.removeEventListener('pagehide', onUnload);
      transport.send('bye', null); transport.close();
      for (const id of [...remotes.keys()]) remove(id);
      group.removeFromParent();
    },
  };
}
