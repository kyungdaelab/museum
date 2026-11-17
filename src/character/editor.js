// 학생용 복셀 캐릭터 편집기 (캐릭터 꾸미기 화면)
// 가운데 캐릭터를 드래그로 돌리고, 누르면(탭) 고른 도구가 적용된다. 바꿀 때마다 저장한다.
//
// ▸ 도구 추가: TOOLS 에 항목을 넣고 applyTool() 에 동작을 추가합니다.
// ▸ 기본 팔레트 색: PALETTE (32색)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VoxelAvatar, AVATAR_HEIGHT } from './voxel/VoxelAvatar.js';
import { REGIONS, MAX_EXTRA, buildWorkModel, extractEdits } from './voxel/model.js';
import { buildGeometry } from './voxel/mesher.js';
import { NICK_MAX, saveConfig, normalizeConfig, isGuestName, myGuestName } from './config.js';
import { hasBlockedWord } from '../shared/nickname.js';

const $ = (id) => document.getElementById(id);
const TOOLS = [
  { key: 'add',   icon: '➕', label: '붙이기',     hint: '면을 누르면 그 자리에 픽셀이 붙어요' },
  { key: 'erase', icon: '🧽', label: '지우기',     hint: '내가 붙인 픽셀을 누르면 지워져요' },
  { key: 'paint', icon: '🖌️', label: '칠하기',     hint: '누른 픽셀의 색을 바꿔요' },
  { key: 'pick',  icon: '💧', label: '스포이트',   hint: '누른 픽셀의 색을 가져와요' },
  { key: 'fill',  icon: '🪣', label: '영역 칠하기', hint: '같은 색으로 이어진 부분을 한 번에 칠해요' },
];
const PALETTE = [
  '#ffffff', '#d9d9d9', '#9e9e9e', '#5c5c5c', '#2b2b2b', '#000000', '#ffe3c9', '#f1c27d',
  '#c68642', '#8d5524', '#5a3825', '#e25555', '#c0392b', '#f08fb0', '#d94f9a', '#f28c38',
  '#f2b33d', '#ffe066', '#c5e1a5', '#4caf7a', '#2f7d4f', '#a8d8ea', '#4fc3f7', '#3d7be0',
  '#2a4fa3', '#1f2a44', '#8e6bd6', '#5e3fa3', '#d7bde2', '#a0622d', '#6b4a3b', '#3b4a6b',
];
const RECENT_KEY = 'vmuseum.editor.recent', RECENT_MAX = 8, UNDO_MAX = 100, LONG_PRESS = 450;
const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const MIRROR_PART = { 3: 4, 4: 3, 5: 6, 6: 5 };        // 왼팔 ↔ 오른팔, 왼다리 ↔ 오른다리

// 픽셀 경계선이 옅게 보이는 재질 (같은 색 면에서도 칸을 셀 수 있게)
function gridMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCell; varying vec3 vFaceN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCell = position; vFaceN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCell; varying vec3 vFaceN;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        vec3 d = min(fract(vCell), 1.0 - fract(vCell)), n = abs(vFaceN);
        float edge = min(mix(d.x, 1.0, n.x), min(mix(d.y, 1.0, n.y), mix(d.z, 1.0, n.z)));
        gl_FragColor.rgb *= mix(0.8, 1.0, smoothstep(0.0, 0.07, edge));`);
  };
  return mat;
}

// initial = 저장돼 있던 설정, onDone(config) = '완료' 버튼을 눌렀을 때
export function createEditor({ initial, onDone }) {
  let config = normalizeConfig(initial), active = false;
  let model = null, tool = 'add', color = '#e25555', symmetry = false, extraCount = 0;
  let undo = [], redo = [], recent = [];
  try { recent = JSON.parse(localStorage.getItem(RECENT_KEY)).filter((c) => /^#[0-9a-f]{6}$/.test(c)).slice(0, RECENT_MAX); } catch { recent = []; }

  const root = $('custom'), canvas = $('preview'), nickEl = $('nick');

  /* ── 장면 ── */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cbb5, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-2, 4, -3); scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.15, 0.08, 40), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  floor.position.y = -0.04; scene.add(floor);
  // 아래쪽 도구 막대에 가리지 않도록 캐릭터보다 조금 아래를 바라봄 → 캐릭터가 화면 위쪽에 놓임
  camera.position.set(1.9, 1.5, -5.4);
  const orbit = new OrbitControls(camera, canvas);
  orbit.enablePan = false; orbit.enableDamping = true; orbit.dampingFactor = 0.1;
  orbit.target.set(0, 0.5, 0); orbit.minDistance = 1.3; orbit.maxDistance = 10; orbit.maxPolarAngle = Math.PI * 0.62;

  // 편집용 모형: 격자 한 칸 = 1 로 만든 메시를 캐릭터 크기로 줄여서 놓는다 → 광선이 맞은 자리를 바로 격자 좌표로 읽을 수 있음
  const holder = new THREE.Group(); scene.add(holder);
  const mat = gridMaterial();
  let mesh = null, bounds = null;
  const ghost = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1.04, 1.04)), new THREE.LineBasicMaterial({ color: 0x111111 }));
  ghost.visible = false;

  function remesh() {
    const colors = model.palette.map((p) => p && new THREE.Color(p.color));
    const geo = buildGeometry(model, { colors });
    if (mesh) { mesh.geometry.dispose(); mesh.geometry = geo; return; }
    const s = AVATAR_HEIGHT / model.baseSize[1], [sx, sy, sz] = model.size;
    mesh = new THREE.Mesh(geo, mat);
    // 허용 범위를 보여 주는 옅은 상자
    bounds = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, sy, sz)), new THREE.LineBasicMaterial({ color: 0x8a8272, transparent: true, opacity: 0.35 }));
    bounds.position.set(sx / 2, sy / 2, sz / 2);
    const g = new THREE.Group(); g.add(mesh, bounds, ghost);
    g.scale.setScalar(s); g.position.set(-(model.origin[0] + model.baseSize[0] / 2) * s, 0, -(model.origin[2] + model.baseSize[2] / 2) * s);
    holder.add(g);
  }
  function loadModel() {            // 설정 → 작업 모형 (화면을 열 때, 기본 모형이 바뀌었을 때)
    if (mesh) { holder.clear(); mesh.geometry.dispose(); bounds.geometry.dispose(); mesh = null; }
    model = buildWorkModel(config);
    undo = []; redo = [];
    remesh(); refresh();
  }

  /* ── 편집 ── */
  const colorAt = (i) => model.palette[model.ci[i]].color;
  const mirrorX = (x) => 2 * model.origin[0] + model.baseSize[0] - 1 - x;
  // 겉에 드러난 칸인가: 이웃이 비었거나 다른 부위(팔다리가 움직이면 보이는 면)일 때
  const exposed = (x, y, z) => { const p = model.part[model.index(x, y, z)]; return NEIGHBORS.some(([a, b, c]) => !model.get(x + a, y + b, z + c) || model.part[model.index(x + a, y + b, z + c)] !== p); };
  let step = null;                   // 지금 하고 있는 한 번의 동작(되돌리기 단위): [칸 번호, 이전 색·부위·잠금, 이후 색·부위·잠금]
  function setCell(i, ci, part, locked) {
    if (model.ci[i] === ci && model.part[i] === part && model.locked[i] === locked) return;
    step.push([i, model.ci[i], model.part[i], model.locked[i], ci, part, locked]);
    model.ci[i] = ci; model.part[i] = part; model.locked[i] = locked;
  }
  function commit() {
    const done = step; step = null;
    if (!done.length) return false;
    undo.push(done); if (undo.length > UNDO_MAX) undo.shift();
    redo = [];
    remesh(); refresh(); save();
    return true;
  }
  function replay(list, from, to) {  // 되돌리기 · 다시하기
    const s = list.pop(); if (!s) return;
    for (const c of from === undo ? [...s].reverse() : s) { const o = from === undo ? 1 : 4; model.ci[c[0]] = c[o]; model.part[c[0]] = c[o + 1]; model.locked[c[0]] = c[o + 2]; }
    to.push(s); remesh(); refresh(); save();
  }

  const ops = {
    // 붙이기: 맞은 면 바깥 칸에 새 픽셀. 부위는 붙은 픽셀의 부위를 따라감
    add(hit, c) {
      const [x, y, z] = hit.outside;
      if (!model.inside(x, y, z)) return toast('여기까지만 만들 수 있어요');
      if (model.get(x, y, z)) return;
      if (extraCount + step.filter((s) => !s[1] && s[4]).length >= MAX_EXTRA) return toast(`픽셀을 모두 썼어요 (최대 ${MAX_EXTRA}개)`);
      setCell(model.index(x, y, z), model.colorIndex(c), hit.part, 0);
    },
    // 지우기: 내가 붙인 픽셀만
    erase(hit) {
      const i = model.index(...hit.cell);
      if (model.locked[i]) { shake(); return toast('기본 몸은 지울 수 없어요'); }
      setCell(i, 0, 0, 0);
    },
    paint(hit, c) { const i = model.index(...hit.cell); setCell(i, model.colorIndex(c), model.part[i], model.locked[i]); },
    // 영역 칠하기: 겉으로 드러난 픽셀 중 같은 색으로 이어진 부분
    fill(hit, c) {
      const from = model.ci[model.index(...hit.cell)], to = model.colorIndex(c);
      if (from === to) return;
      const queue = [hit.cell], seen = new Set([model.index(...hit.cell)]);
      // 같은 색 픽셀을 속까지 따라가며 찾되, 색은 겉에 드러난 픽셀만 바꾼다 (속은 보이지 않으므로 저장할 양을 줄임)
      while (queue.length) {
        const [x, y, z] = queue.pop(), i = model.index(x, y, z);
        if (exposed(x, y, z)) setCell(i, to, model.part[i], model.locked[i]);
        for (const [a, b, d] of NEIGHBORS) {
          const X = x + a, Y = y + b, Z = z + d;
          if (!model.inside(X, Y, Z)) continue;
          const j = model.index(X, Y, Z);
          if (seen.has(j) || model.ci[j] !== from) continue;
          seen.add(j); queue.push([X, Y, Z]);
        }
      }
    },
  };
  // 좌우 대칭일 때 반대쪽에서 같은 동작을 하기 위한 '거울 속 맞은 자리'
  function mirrored(hit) {
    const m = ([x, y, z]) => [mirrorX(x), y, z], cell = m(hit.cell);
    if (cell[0] === hit.cell[0]) return null;                      // 가운데 줄은 한 번만 (폭이 홀수일 때)
    const filled = model.get(...cell);
    return { cell, outside: m(hit.outside), part: filled ? model.part[model.index(...cell)] : MIRROR_PART[hit.part] ?? hit.part, filled };
  }
  function applyTool(name, hit) {
    if (name === 'pick') { setColor(colorAt(model.index(...hit.cell)), false); setTool('paint'); return; }
    step = [];
    try {
      ops[name](hit, color);
      if (symmetry) {            // 반대쪽에도 같은 동작 (지우기는 반대쪽이 내가 붙인 픽셀일 때만)
        const m = mirrored(hit);
        if (m && (name === 'add' || (m.filled && !(name === 'erase' && model.locked[model.index(...m.cell)])))) ops[name](m, color);
      }
    } catch { toast('색을 너무 많이 썼어요. 이미 쓴 색을 골라 주세요'); }   // 색 종류 255가지 초과
    if (commit() && name !== 'erase') remember(color);
  }

  /* ── 누른 자리 찾기 ── */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), local = new THREE.Vector3();
  function hitAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set((clientX - r.left) / r.width * 2 - 1, -(clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObject(mesh, false)[0];
    if (!h) return null;
    const n = h.face.normal, p = mesh.worldToLocal(local.copy(h.point));
    const cell = [Math.floor(p.x - n.x * 0.5), Math.floor(p.y - n.y * 0.5), Math.floor(p.z - n.z * 0.5)];
    if (!model.get(...cell)) return null;
    return { cell, outside: [cell[0] + Math.round(n.x), cell[1] + Math.round(n.y), cell[2] + Math.round(n.z)], part: model.part[model.index(...cell)] };
  }
  // 드래그 = 회전(OrbitControls), 움직이지 않고 떼면 = 도구 적용, 터치로 길게 누르면 = 지우기
  let press = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (previewing) return;
    clearTimeout(press?.timer);
    press = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, done: false };
    if (e.pointerType === 'touch')
      press.timer = setTimeout(() => {
        if (!press || press.moved) return;
        press.done = true; navigator.vibrate?.(15);
        const hit = hitAt(press.x, press.y); if (hit) applyTool('erase', hit);
      }, LONG_PRESS);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { press.moved = true; clearTimeout(press.timer); }
    if (e.pointerType === 'mouse' && !e.buttons && !previewing) hover(e.clientX, e.clientY);      // PC: 적용될 칸 미리 표시
  });
  canvas.addEventListener('pointerup', (e) => {
    const p = press; press = null;
    if (!p || e.pointerId !== p.id) return;
    clearTimeout(p.timer);
    if (p.moved || p.done || previewing) return;
    const hit = hitAt(e.clientX, e.clientY);
    if (hit) applyTool(tool, hit);
    ghost.visible = false;
  });
  canvas.addEventListener('pointercancel', () => { clearTimeout(press?.timer); press = null; });
  canvas.addEventListener('pointerleave', () => { ghost.visible = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  function hover(x, y) {
    const hit = mesh && hitAt(x, y);
    ghost.visible = !!hit;
    if (hit) { const c = tool === 'add' ? hit.outside : hit.cell; ghost.position.set(c[0] + 0.5, c[1] + 0.5, c[2] + 0.5); }
  }

  /* ── 화면 요소 ── */
  let toastTimer = 0, shakeT = 0;
  function toast(text) { const t = $('edToast'); t.textContent = text; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 1800); }
  function shake() { shakeT = 0.35; }
  function setTool(key) {
    tool = key; ghost.visible = false;
    for (const b of document.querySelectorAll('#edTools button')) b.classList.toggle('sel', b.dataset.tool === key);
    $('edHint').textContent = TOOLS.find((t) => t.key === key).hint + ' · 드래그: 돌리기';
  }
  function setColor(c, switchTool = true) {
    color = c.toLowerCase();
    $('edColorDot').style.background = color; $('edPicker').value = color;
    for (const b of document.querySelectorAll('#edPalette button, #edRecent button')) b.classList.toggle('sel', b.dataset.color === color);
    if (switchTool && (tool === 'erase' || tool === 'pick')) setTool('paint');     // 색을 골랐으면 칠할 준비
  }
  function swatch(c) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'swatch'; b.dataset.color = c; b.style.background = c;
    b.setAttribute('aria-label', '색 ' + c); b.addEventListener('click', () => { setColor(c); closeSheet(); });
    return b;
  }
  function remember(c) {             // 최근 사용 색
    recent = [c, ...recent.filter((x) => x !== c)].slice(0, RECENT_MAX);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch { /* 저장 안 돼도 계속 */ }
    $('edRecent').replaceChildren(...recent.map(swatch)); setColor(color, false);
  }
  function refresh() {               // 남은 개수 · 되돌리기 버튼 상태
    extraCount = 0; for (let i = 0; i < model.ci.length; i++) if (model.ci[i] && !model.locked[i]) extraCount++;
    $('edCount').textContent = `남은 픽셀 ${MAX_EXTRA - extraCount}개`;
    $('edCount').classList.toggle('low', MAX_EXTRA - extraCount <= 20);
    $('edUndo').disabled = !undo.length; $('edRedo').disabled = !redo.length;
  }
  function save() { config = normalizeConfig({ ...config, ...extractEdits(model) }); saveConfig(config); }
  const closeSheet = () => $('edSide').classList.remove('open');

  for (const t of TOOLS) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.tool = t.key; b.title = t.hint;
    b.innerHTML = `<i>${t.icon}</i><span>${t.label}</span>`;
    b.addEventListener('click', () => setTool(t.key)); $('edTools').append(b);
  }
  $('edPalette').append(...PALETTE.map(swatch));
  $('edRecent').append(...recent.map(swatch));
  $('edPicker').addEventListener('input', (e) => setColor(e.target.value));
  $('edColorBtn').addEventListener('click', () => $('edSide').classList.toggle('open'));
  $('edSideClose').addEventListener('click', closeSheet);
  $('edSym').addEventListener('click', () => { symmetry = !symmetry; $('edSym').classList.toggle('sel', symmetry); toast(symmetry ? '좌우 대칭 켜짐: 반대쪽에도 똑같이 적용돼요' : '좌우 대칭 꺼짐'); });
  $('edUndo').addEventListener('click', () => replay(undo, undo, redo));
  $('edRedo').addEventListener('click', () => replay(redo, redo, undo));
  // 초기화: 화면 안의 확인 상자에서 한 번 더 물어본다 (브라우저 기본 확인 창은 앱 안에서 막히는 경우가 있어 쓰지 않음)
  const askReset = (show) => $('edConfirm').classList.toggle('hidden', !show);
  $('edReset').addEventListener('click', () => askReset(true));
  $('edConfirmNo').addEventListener('click', () => askReset(false));
  $('edConfirmYes').addEventListener('click', () => {
    askReset(false);
    step = [];
    for (let i = 0; i < model.ci.length; i++) {
      if (model.ci[i] && !model.locked[i]) setCell(i, 0, 0, 0);
      else if (model.locked[i] && model.ci[i] !== model.pristine[i]) setCell(i, model.pristine[i], model.part[i], 1);
    }
    if (!commit()) toast('이미 처음 모습이에요');
  });
  window.addEventListener('keydown', (e) => {
    if (!active || previewing || e.target.matches?.('input')) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? replay(redo, redo, undo) : replay(undo, undo, redo); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); replay(redo, redo, undo); }
  });

  // 기본 몸 색 한 번에 바꾸기 (영역별). 따로 칠한 칸은 그대로 둔다
  for (const r of REGIONS) {
    const lab = document.createElement('label'); lab.className = 'regionColor';
    const inp = document.createElement('input'); inp.type = 'color'; inp.dataset.region = r.key;
    inp.addEventListener('input', () => {
      config.colors[r.key] = inp.value;
      const p = model.palette.find((q) => q?.region === r.key); if (p) p.color = inp.value;
      remesh(); save();
    });
    lab.append(inp, r.label); $('fields').append(lab);
  }
  nickEl.maxLength = NICK_MAX;
  nickEl.addEventListener('input', () => {
    if (hasBlockedWord(nickEl.value)) toast('쓸 수 없는 낱말이 들어 있어요. 다른 별명을 지어 주세요');     // 저장할 때는 '관람객 + 숫자'로 바뀜
    config.nickname = nickEl.value; save();
  });

  /* ── 전시장에서 미리보기: 걷는 모습 확인 ── */
  let previewing = false, walker = null, walkSpeed = 3.2, walkAngle = 0;
  function setPreview(on) {
    previewing = on; ghost.visible = false; closeSheet();
    root.classList.toggle('previewing', on);
    $('edPreview').textContent = on ? '편집으로 돌아가기' : '전시장에서 미리보기';
    holder.visible = !on;
    floor.scale.setScalar(on ? 2.4 : 1); floor.material.color.set(on ? 0xe8d2ad : 0xffffff);
    walker?.dispose(); walker = null;
    if (on) { walker = new VoxelAvatar(config); scene.add(walker.group); }
  }
  $('edPreview').addEventListener('click', () => setPreview(!previewing));
  for (const b of document.querySelectorAll('#anim button'))
    b.addEventListener('click', () => { walkSpeed = +b.dataset.speed; document.querySelectorAll('#anim button').forEach((x) => x.classList.toggle('sel', x === b)); });

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.fov = w < h ? 42 : 32;        // 세로 화면에서는 넓게
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);

  const done = () => { nickEl.blur(); save(); api.close(); onDone(config); };
  $('enter').addEventListener('click', done);
  nickEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) nickEl.blur(); });

  const api = {
    get active() { return active; },
    get config() { return config; },
    // 점검용
    debug: { get model() { return model; }, hitAt, applyTool, setTool, setColor, camera, orbit, get symmetry() { return symmetry; }, get undo() { return undo; }, get walker() { return walker; } },
    open() {
      active = true; root.classList.remove('hidden');
      nickEl.value = isGuestName(config.nickname) ? '' : config.nickname;     // '관람객 + 숫자'는 빈칸으로 보여 줌
      nickEl.placeholder = `별명을 적어 주세요 (비우면 ${myGuestName()})`;
      setPreview(false); loadModel();        // 기본 모형이 바뀌었으면(.vox) 여기서 새 모형으로 다시 만들어짐
      for (const i of document.querySelectorAll('#fields input')) i.value = config.colors[i.dataset.region];
      setTool(tool); setColor(color, false); resize();
    },
    close() { active = false; setPreview(false); root.classList.add('hidden'); },
    // 밖에서 설정을 바꿨을 때 (예: 서버에 저장된 캐릭터를 불러온 경우)
    setConfig(next) { config = normalizeConfig(next); saveConfig(config); if (active) loadModel(); },
    render(dt) {
      orbit.update();
      if (shakeT > 0) { shakeT -= dt; holder.position.x = shakeT > 0 ? Math.sin(shakeT * 70) * 0.03 * (shakeT / 0.35) : 0; }
      if (walker) {                           // 미리보기: 원을 그리며 걷기 (대기는 제자리)
        const r = 1.5;
        if (walkSpeed > 0) walkAngle += walkSpeed / r * dt;
        walker.group.position.set(Math.cos(walkAngle) * r, 0, Math.sin(walkAngle) * r);
        walker.group.rotation.y = -walkAngle + Math.PI;
        walker.update(dt, walkSpeed);
      }
      renderer.render(scene, camera);
    },
  };
  return api;
}
