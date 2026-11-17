// 전체 흐름: 캐릭터 꾸미기 → 로비(전시실 목록) → 전시실 입장 → 나가기
// 전시실에 들어갈 때 그 전시실의 공간과 작품만 만들고, 나갈 때 전부 해제한다.
import * as THREE from 'three';
import { createEngine } from './core/engine.js';
import { createInput } from './core/input.js';
import { createPlayer } from './core/player.js';
import { createFollowCamera } from './core/follow-camera.js';
import { loadConfig, normalizeConfig, hasEdits } from './character/config.js';
import { saveMyAvatar, loadMyAvatar } from './data/avatars.js';
import { joinRoom } from './net/room-sync.js';
import { createEditor } from './character/editor.js';
import { createCrowd } from './character/crowd.js';
import { VoxelAvatar } from './character/voxel/VoxelAvatar.js';
import { createBaseModel, getBaseModel, setBaseModel } from './character/voxel/model.js';
import { parseVox, exportVox } from './character/voxel/vox.js';
import { makeTestRoom } from './data/test-rooms.js';
import { buildRoom } from './room/RoomBuilder.js';
import { loadArtworks } from './artworks/ArtworkManager.js';
import { getArtworks, getRoom, checkRoomCode } from './data/rooms.js';
import { ensureSession, currentAccount } from './data/student-auth.js';
import { ask, askCode, showShare } from './ui/dialogs.js';
import { fileUrl } from './data/storage.js';
import { createArtworkPanel } from './ui/artwork-panel.js';
import { createViewer } from './ui/viewer.js';
import { createLobby } from './ui/lobby.js';
import { createStudentLogin } from './ui/student-login.js';

const $ = (id) => document.getElementById(id);
const NEAR_DIST = 2;                  // 이 거리(m) 안으로 다가가면 작품 이름표 표시
const params = new URLSearchParams(location.search);

const engine = createEngine($('view'));
const { scene, renderer, camera, canvas } = engine;

// 관람객 캐릭터 (전시실이 바뀌어도 유지)
let config = loadConfig();
const avatar = new VoxelAvatar(config, { ownMaterial: true });
const player = createPlayer(scene, avatar);
player.setName(config.nickname);
const follow = createFollowCamera(camera);

let state = 'customize';              // 'customize' | 'lobby' | 'room'
let current = null;                   // 지금 들어와 있는 전시실 { config, room, artworks }
let enterToken = 0;                   // 입장 도중 나가거나 다른 전시실을 고르면 앞선 입장을 취소하기 위한 번호
const setState = (s) => { state = s; document.body.dataset.state = s; };
const uiBlocked = () => state !== 'room' || !current || panel.detailOpen || viewer.mode !== 'off';

/* ── 화면 요소 ── */
const panel = createArtworkPanel({ onOpen: openArtwork });
const viewer = createViewer({
  camera, canvas, scene,
  getLights: () => current?.room.lights ?? [],
  onOpen: () => { input.clear(); player.stop(); player.group.visible = false; },      // 캐릭터가 작품을 가리지 않게 숨김
  onClose: () => { player.group.visible = !!current; },
});
function openArtwork(a) {             // 평면 작품 → 상세 패널, 입체 작품 → 감상 모드
  if (!a || uiBlocked()) return;
  if (a.kind === 'image') { input.clear(); panel.openDetail(a); }
  else if (viewer.open(a)) panel.update(null);
}

// 안내 문구 · 터치 화면
const helpEl = $('help');
let touchUI = false, helpTimer = 0;
const setHelp = () => {
  helpEl.innerHTML = touchUI
    ? '<b>조이스틱</b> 이동 (끝까지 밀면 달리기)<br><b>화면 드래그</b> 시점 회전<br><b>두 손가락</b> 줌'
    : '<b>WASD / 방향키</b> 이동 · <b>Shift</b> 달리기<br><b>마우스 드래그</b> 시점 회전 · <b>휠</b> 줌';
};
const enableTouchUI = () => { if (touchUI) return; touchUI = true; $('stick').classList.add('on'); setHelp(); };
setHelp();
if (matchMedia('(pointer: coarse)').matches || params.has('touch')) enableTouchUI();

const input = createInput({
  canvas, stickEl: $('stick'), knobEl: $('knob'),
  isBlocked: uiBlocked,
  isOrbiting: () => viewer.mode !== 'off',
  onLook: (dx, dy, touch) => { if (!uiBlocked()) follow.look(dx, dy, touch); },
  onZoom: (f) => { if (!uiBlocked()) follow.zoom(f); },
  onTouch: enableTouchUI,
  onActivity: () => { if (!helpTimer) helpTimer = setTimeout(() => helpEl.classList.add('hidden'), 4000); },
  onTap: (x, y) => {                  // 화면에서 작품을 직접 클릭/탭 (8m 이내)
    if (uiBlocked()) return;
    const ndc = new THREE.Vector2(x / window.innerWidth * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    openArtwork(current.artworks.pick(ndc, camera, 8 + follow.cam.curDist));
  },
});
window.addEventListener('keydown', (e) => {
  if (state !== 'room') return;
  if (e.code === 'Escape') { if (panel.detailOpen) panel.closeDetail(); else viewer.close(); }
  else if ((e.code === 'KeyE' || e.code === 'Enter') && panel.nearArt && !e.target.closest?.('button, input, select')) { e.preventDefault(); openArtwork(panel.nearArt); }
});

const noticeEl = $('notice');
const showNotice = (list) => {
  noticeEl.style.display = list.length ? 'block' : 'none';
  if (list.length) noticeEl.textContent = `작품 전시 중 문제 ${list.length}건: ${list[0]}` + (list.length > 1 ? ' 외 (자세한 내용은 F12 콘솔)' : '');
};
const showLoading = (text) => { $('loading').classList.toggle('hidden', !text); if (text) $('loadingText').textContent = text; };
const memory = () => ({ ...renderer.info.memory });      // GPU 에 올라가 있는 형태(geometries) · 텍스처(textures) 개수

/* ── 전시실 입장 · 퇴장 ── */
// roomConfig = 전시실 설정, testArtworks = 테스트 화면에서 넘겨주는 임시 작품 목록(없으면 저장소에서 읽음)
// opts.crowd = 성능 테스트용 가짜 관람객 수
async function enterRoom(roomConfig, testArtworks = null, opts = {}) {
  const my = ++enterToken;
  leaveRoom();
  lobby.close(); showLoading(`'${roomConfig.title || '전시실'}' 을(를) 준비하는 중…`);
  const before = memory();
  let room = null, artworks = null;
  try {
    room = buildRoom(engine, roomConfig, { showSlots: !!testArtworks || params.has('slots') });
    let list = testArtworks;
    if (!list) {
      try { list = await getArtworks(roomConfig.id, opts.code ?? null); }
      catch (e) { list = []; showNotice([e.message]); }
    }
    if (my === enterToken)
      artworks = await loadArtworks(room, list, {
        scene, renderer,
        resolveUrl: (path) => fileUrl(roomConfig.id, path),        // 이 전시실 폴더의 파일만 가리킴
        onWarn: (m, all) => { if (my === enterToken) showNotice(all); },
      });
    if (my !== enterToken) { artworks?.dispose(); room.dispose(); return; }     // 준비하는 사이에 취소됨 → 만든 것 해제
  } catch (e) {
    artworks?.dispose(); room?.dispose();
    if (my !== enterToken) return;
    console.error(e); showLoading(''); lobby.open(); setState('lobby');
    showNotice([`전시실을 열지 못했습니다: ${e.message}`]);
    return;
  }
  current = { config: roomConfig, room, artworks, before, crowd: opts.crowd ? createCrowd(scene, room, opts.crowd, config) : null };
  showFps = !!opts.crowd || params.has('fps');
  $('shareBtn').classList.toggle('hidden', !!testArtworks);       // 테스트 전시실은 공유할 주소가 없음
  // 같은 전시실의 다른 관람객과 연결 (전시실마다 통로가 따로). 연결되는 사이에 나갔으면 바로 끊는다
  const entered = current;
  joinRoom({ roomId: roomConfig.id, scene, me: { nickname: config.nickname, config } })
    .then((net) => { if (current === entered) entered.net = net; else net.dispose(); })
    .catch((e) => console.warn('다른 관람객과 연결하지 못했습니다:', e.message));
  if (artworks.warnings.length) showNotice(artworks.warnings);
  const sp = room.spawn;
  player.teleport(sp.x, sp.z, sp.yaw); player.group.visible = true;
  follow.snap(player.position, sp.yaw);
  $('zone').textContent = roomConfig.title || '전시실';
  showLoading(''); setState('room');
}

// 전시실에서 나가기: 감상 모드·패널을 닫고, 이 전시실의 3D 모델·텍스처·스플랫을 모두 해제
function leaveRoom() {
  if (!current) return;
  const { room, artworks, before, config: cfg, crowd, net } = current;
  viewer.forceClose(); panel.reset(); input.clear(); player.stop();
  current = null;
  net?.dispose();
  crowd?.dispose();
  artworks.dispose();
  room.dispose();
  player.group.visible = false;
  showNotice([]);
  const after = memory();
  console.info(`[전시실 해제] ${cfg.title}: 형태 ${before.geometries}→${after.geometries}개, 텍스처 ${before.textures}→${after.textures}개 (입장 전→퇴장 후)`);
}
function exitToLobby() { enterToken++; leaveRoom(); showLoading(''); lobby.open(); setState('lobby'); }

/* ── 기본 모형 바꾸기 (.vox) ── */
const BASE_VOX_URL = '';              // 기본 모형을 완전히 바꾸려면 .vox 파일 경로를 적는다. 예: 'assets/character/base.vox'
function applyBaseModel(model) {      // 이후에 만드는 캐릭터와 내 캐릭터에 새 기본 모형 적용
  setBaseModel(model);
  avatar.setConfig(config);
  const [sx, sy, sz] = model.size;
  return `폭 ${sx} × 깊이 ${sz} × 높이 ${sy}칸, 복셀 ${model.count()}개 · 삼각형 ${avatar.triangles.near}개 (멀리 ${avatar.triangles.far}개)`;
}
if (BASE_VOX_URL)
  fetch(BASE_VOX_URL).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then((buf) => applyBaseModel(parseVox(buf)))
    .catch((e) => console.warn(`기본 모형(${BASE_VOX_URL})을 불러오지 못해 내장 모형을 씁니다: ${e.message}`));

/* ── 입장: 목록에서 고르거나, 링크 · QR 주소(?room=전시실id)로 바로 ──
   어느 쪽이든 로그인은 요구하지 않는다. 꾸미기를 마치면 곧바로 들어간다. */
let noticeTimer = 0;
const notify = (text) => {            // 관람자에게 한 줄 안내 (8초 뒤 사라짐)
  noticeEl.textContent = text; noticeEl.style.display = 'block';
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { noticeEl.style.display = 'none'; }, 8000);
};
let pendingRoom = params.get('room');                  // 링크 · QR 로 들어온 경우의 전시실 id
if (pendingRoom) $('enter').textContent = '입장하기';

// 전시실 하나에 들어가기. 입장 코드가 걸려 있으면 코드부터 묻는다
async function openRoom(room) {
  let code = null;
  if (room.hasEntryCode || room.entryCode) {
    lobby.open(); setState('lobby');
    code = await askCode(room.title || '전시실', (c) => checkRoomCode(room, c));
    if (code === null) return;                         // 취소 → 목록에 머무름
  }
  enterRoom(room, null, { code });
}
// 꾸미기를 마친 뒤: 링크로 왔으면 그 전시실로, 아니면 목록으로
async function afterCustomize() {
  const id = pendingRoom; pendingRoom = null; $('enter').textContent = '완료';
  if (!id) { lobby.open(); setState('lobby'); return; }
  setState('lobby'); showLoading('전시실을 찾는 중…');
  const res = await getRoom(id).catch(() => ({ denied: '전시실을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.' }));
  showLoading('');
  if (res.denied) { lobby.open(); notify(res.denied); return; }
  openRoom(res.room);
}
$('shareBtn').addEventListener('click', () => {
  if (!current || uiBlocked()) return;
  input.clear(); player.stop();
  showShare(current.config.title || '전시실', `${location.origin}${location.pathname}?room=${encodeURIComponent(current.config.id)}`);
});

const lobby = createLobby({
  onEnter: (room, testArtworks) => (testArtworks ? enterRoom(room, testArtworks) : openRoom(room)),
  onCustomize: () => { lobby.close(); customizer.open(); setState('customize'); },
  // 성능 테스트: 평면 15점 전시실에 같은 캐릭터 30명
  onCrowdTest: (theme) => { const t = makeTestRoom('flat', 15, { theme }); t.config.title = '캐릭터 30명 성능 테스트'; enterRoom(t.config, t.artworks, { crowd: 30 }); },
  onVoxImport: async (file) => applyBaseModel(parseVox(await file.arrayBuffer())),
  onVoxReset: () => applyBaseModel(createBaseModel()),
  onVoxExport: () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportVox(getBaseModel())], { type: 'application/octet-stream' }));
    a.download = 'base-character.vox'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  baseInfo: () => applyBaseModel(getBaseModel()),
});
const customizer = createEditor({       // 캐릭터 꾸미기 = 복셀 편집기
  initial: config,
  onDone: (cfg) => {                  // 꾸미기를 마치면: 전시실 안에서 열었으면 전시실로, 아니면 로비로
    config = cfg; avatar.setConfig(cfg); player.setName(cfg.nickname);
    current?.net?.setMe({ nickname: cfg.nickname, config: cfg });       // 전시실 안에서 바꿨으면 다른 관람객에게도 알림
    studentLogin.setNickname(cfg.nickname);                              // 학생이면 로비 버튼의 별명도 바로 바꿈
    // 저장: 브라우저에는 항상, 로그인한 학생이면 서버에도 (서버가 검사해서 거절하면 이유를 보여 줌)
    saveMyAvatar(cfg).then((r) => { if (r.error) showNotice([`캐릭터를 서버에 저장하지 못했습니다. ${r.error}`]); });
    if (current) setState('room'); else afterCustomize();
  },
});
// 학생이 로그인하면(또는 이미 로그인된 채로 접속하면): 서버에 저장된 캐릭터와 닉네임을 브라우저 것 대신 사용
const studentLogin = createStudentLogin({
  onChange: async (student, resumed) => {
    if (!student) return;                               // 로그아웃 → 게스트로 계속 (브라우저의 캐릭터 그대로)
    // 게스트로 꾸미던 캐릭터가 있으면, 방금 로그인했을 때 계정으로 옮길지 묻는다
    if (!resumed && hasEdits(config)
        && await ask('지금 캐릭터를 내 계정에 저장할까요?', '저장하기', '계정 캐릭터 쓰기', '저장하면 계정에 있던 캐릭터 대신 지금 꾸민 캐릭터를 쓰게 돼요.')) {
      const r = await saveMyAvatar(config);
      notify(r.error ? `캐릭터를 계정에 저장하지 못했어요. ${r.error}` : '지금 캐릭터를 내 계정에 저장했어요');
      return;
    }
    syncFromServer(student);
  },
});
// 게스트에게는 눈에 보이지 않는 임시 ID 를 준다. 교사로 로그인돼 있으면 서버에 저장된 교사 캐릭터를 쓴다
ensureSession().then(() => currentAccount()).then((a) => { if (a.kind === 'teacher') syncFromServer({ nickname: '' }); }).catch(() => {});

const syncFromServer = (account) => loadMyAvatar().then((res) => {
  const nickname = account.nickname || config.nickname;
  config = normalizeConfig(res ? { ...res.config, nickname } : { ...config, nickname });
  avatar.setConfig(config); customizer.setConfig(config); player.setName(config.nickname);
  if (!res) { saveMyAvatar(config); return; }           // 계정에 아직 캐릭터가 없으면 지금 것을 계정에 저장
  let seen = ''; try { seen = localStorage.getItem('vmuseum.resetSeen') ?? ''; } catch { /* 무시 */ }
  if (res.reset && res.reset.at !== seen) {         // 교사가 초기화했으면 사유를 한 번 알림
    showNotice([`선생님이 캐릭터에 붙인 픽셀과 칠한 색을 초기화했습니다. 사유: ${res.reset.reason}`]);
    try { localStorage.setItem('vmuseum.resetSeen', res.reset.at); } catch { /* 무시 */ }
  }
}).catch(() => {});
$('exitBtn').addEventListener('click', exitToLobby);
$('editBtn').addEventListener('click', () => { if (uiBlocked()) return; input.clear(); player.stop(); customizer.open(); setState('customize'); });

/* ── 매 프레임 ── */
function followCamera(dt) {
  const o = follow.update(dt, player.position, current.room.camBlockers);
  avatar.setOpacity(Math.round(o * 20) / 20);                                   // 카메라가 너무 가까우면 캐릭터를 투명하게
  player.nameTag.visible = o > 0.5 && !panel.nearArt && !panel.detailOpen;      // 작품 감상 중에는 닉네임이 그림을 가리지 않게
}
const STILL = { x: 0, y: 0, run: false };
let zoneText = '';
function step(dt) {
  const { room, artworks, config: cfg } = current;
  artworks.update(player.position, viewer.art);       // 가까운 입체 작품 지연 로딩 · 스플랫 켜고 끄기
  if (viewer.mode === 'off') {
    player.update(dt, uiBlocked() ? STILL : input.axis(), follow.cam.yaw, room);
    avatar.update(dt, player.speed);
    followCamera(dt);
  } else viewer.update(dt, (d) => { avatar.update(d, 0); followCamera(d); });
  if (current.crowd) crowdInfo = current.crowd.update(dt, camera.position);
  const net = current.net;
  net?.update(dt, camera.position, { x: player.position.x, z: player.position.z, ry: player.group.rotation.y, speed: player.speed });
  const z = [cfg.title || '전시실', room.zoneName(player.position), net && net.count > 1 ? `${net.count}명 관람 중` : ''].filter(Boolean).join(' · ');
  if (z !== zoneText) $('zone').textContent = zoneText = z;
  panel.update(panel.detailOpen || viewer.mode !== 'off' ? null : artworks.nearest(player.position, NEAR_DIST));
  renderer.render(scene, camera);
}
// 성능 표시: 초당 화면 수(fps) · 그리기 호출 수 · 삼각형 수. 성능 테스트 중이거나 주소에 ?fps 가 있을 때만
let showFps = false, crowdInfo = null, fpsFrames = 0, fpsSince = performance.now();
const fpsEl = $('fps');
function updateFps() {
  fpsFrames++;
  const now = performance.now();
  if (now - fpsSince < 500) return;
  const fps = fpsFrames * 1000 / (now - fpsSince); fpsFrames = 0; fpsSince = now;
  const on = showFps && state === 'room';
  fpsEl.classList.toggle('hidden', !on);
  if (!on) return;
  const r = renderer.info.render;
  fpsEl.textContent = `${fps.toFixed(0)} fps · 그리기 ${r.calls}회 · 삼각형 ${r.triangles.toLocaleString()}개`
    + (crowdInfo && current?.crowd ? ` · 캐릭터 ${crowdInfo.near + crowdInfo.far}명 (가까이 ${crowdInfo.near} / 멀리 ${crowdInfo.far})` : '');
  fpsEl.style.color = fps >= 50 ? '#9be7a8' : fps >= 30 ? '#ffe08a' : '#ff9a9a';
}
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state === 'customize') customizer.render(dt);
  else if (state === 'room' && current) step(dt);
  updateFps();
}
renderer.setAnimationLoop(frame);

customizer.open(); setState('customize');

// 점검용: 브라우저 콘솔에서 __museum 으로 상태 확인
window.__museum = {
  engine, player, avatar, follow, viewer, panel, customizer, memory, enterRoom, exitToLobby,
  get current() { return current; }, get state() { return state; },
  step: (dt = 1 / 60) => { if (state === 'customize') customizer.render(dt); else if (state === 'room' && current) step(dt); },
};
