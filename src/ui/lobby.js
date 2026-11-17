// 로비: 전시실 목록 화면 + 공간 확인용 테스트 화면
import { listRooms } from '../data/rooms.js';
import { makeTestRoom } from '../data/test-rooms.js';
import { makeLayout, ROOM_TYPES } from '../room/templates.js';
import { periodText } from '../room/RoomBuilder.js';
import { WALLS, FLOORS, BRIGHTNESS, DEFAULT_THEME } from '../room/themes.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// 평면도 그리기: 벽(검정) · 입구(초록) · 안내판(회색) · 벽 자리(파랑) · 바닥 자리(주황, 받침대 최대 크기)
export function drawPlan(canvas, layout) {
  const pad = 14, W = canvas.width, H = canvas.height, g = canvas.getContext('2d');
  const s = Math.min((W - 2 * pad) / layout.width, (H - 2 * pad) / layout.depth);
  const ox = (W - layout.width * s) / 2, oy = (H - layout.depth * s) / 2;
  const X = (x) => ox + x * s, Y = (z) => oy + (z + layout.depth) * s;       // 위쪽이 북쪽(-z)
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#f3ede0'; g.fillRect(X(0), Y(-layout.depth), layout.width * s, layout.depth * s);
  g.strokeStyle = '#3a3a3a'; g.lineWidth = Math.max(2, 0.3 * s); g.lineCap = 'square';
  for (const [x1, z1, x2, z2, y0] of layout.walls) { if (y0) continue; g.beginPath(); g.moveTo(X(x1), Y(z1)); g.lineTo(X(x2), Y(z2)); g.stroke(); }
  g.strokeStyle = '#3aa76d'; g.lineWidth = Math.max(3, 0.4 * s);             // 입구
  g.beginPath(); g.moveTo(X(0), Y(layout.door.z - 1.5)); g.lineTo(X(0), Y(layout.door.z + 1.5)); g.stroke();
  g.fillStyle = '#8d8779'; g.fillRect(X(layout.board.x) - 2, Y(layout.board.z - 1.3), 4, 2.6 * s);   // 안내판
  g.fillStyle = '#3aa76d'; g.beginPath(); g.arc(X(layout.spawn.x), Y(layout.spawn.z), Math.max(3, 0.3 * s), 0, 7); g.fill();   // 입장 위치
  const fs = Math.max(8, Math.min(13, 1.0 * s));
  g.font = `700 ${fs}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const [no, sl] of Object.entries(layout.slots)) {
    if (sl.kind === 'wall') {
      const [nx, nz] = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[sl.dir], along = 0.85 * s;      // 액자 폭 약 1.7m
      g.fillStyle = '#3d7be0'; g.fillRect(X(sl.x) - (nx ? 2.5 : along), Y(sl.z) - (nz ? 2.5 : along), nx ? 5 : 2 * along, nz ? 5 : 2 * along);
      g.fillStyle = '#1d3f7a'; g.fillText(no, X(sl.x + nx * 0.9), Y(sl.z + nz * 0.9));
    } else {
      g.fillStyle = '#e2893d'; g.fillRect(X(sl.x - 0.65), Y(sl.z - 0.65), 1.3 * s, 1.3 * s);
      g.fillStyle = '#fff'; g.fillText(no, X(sl.x), Y(sl.z));
    }
  }
}

// onEnter(전시실 설정, 임시 작품 목록 | null), onCustomize()
// 그 밖의 hooks: onCrowdTest(theme), onVoxImport(file) → 설명 글, onVoxReset() → 설명 글, onVoxExport(), baseInfo() → 설명 글
export function createLobby(hooks) {
  const { onEnter, onCustomize } = hooks;
  const root = $('lobby'), listEl = $('roomList'), testEl = $('testPanel');
  let loaded = false;

  async function loadList() {
    listEl.replaceChildren(el('p', 'muted', '전시실 목록을 불러오는 중…'));
    try {
      const rooms = await listRooms();
      listEl.replaceChildren();
      if (!rooms.length) listEl.append(el('p', 'muted', '아직 열린 전시실이 없습니다.'));
      for (const r of rooms) {
        const card = el('button', 'roomCard'); card.type = 'button';
        card.append(
          el('span', 'tag ' + r.type, ROOM_TYPES[r.type]?.label ?? r.type),
          el('b', null, r.title || '제목 없는 전시'),
          el('span', 'who', [r.teacher, periodText(r.period)].filter(Boolean).join(' · ')),
          el('span', 'desc', r.description || ''),
          el('span', 'count', `작품 ${r.artworkCount ?? '?'}점 · 최대 ${r.maxArtworks}점`));
        card.addEventListener('click', () => onEnter(r, null));
        listEl.append(card);
      }
      loaded = true;
    } catch (e) {
      listEl.replaceChildren(el('p', 'muted', '전시실 목록을 불러오지 못했습니다. ' + e.message));
    }
  }

  // ── 테스트 화면: 유형별 5 · 15 · 30점 평면도와 '들어가 보기' ──
  const test = { arrangement: 'grid', theme: { ...DEFAULT_THEME } };
  function select(label, table, get, set) {
    const wrap = el('label', 'testOpt'); wrap.append(el('span', null, label));
    const sel = document.createElement('select');
    for (const [k, v] of Object.entries(table)) { const o = el('option', null, v.label); o.value = k; sel.append(o); }
    sel.value = get(); sel.addEventListener('change', () => { set(sel.value); renderTest(); });
    wrap.append(sel); return wrap;
  }
  function renderTest() {
    const cards = $('testCards'); cards.replaceChildren();
    for (const type of Object.keys(ROOM_TYPES)) for (const n of [5, 15, 30]) {
      const cfg = { type, maxArtworks: n, arrangement: test.arrangement }, layout = makeLayout(cfg);
      const card = el('div', 'testCard'), canvas = document.createElement('canvas');
      canvas.width = 520; canvas.height = 300; drawPlan(canvas, layout);
      const btn = el('button', 'chip', '들어가 보기'); btn.type = 'button';
      btn.addEventListener('click', () => { const t = makeTestRoom(type, n, { arrangement: test.arrangement, theme: { ...test.theme } }); onEnter(t.config, t.artworks); });
      const walls = layout.walls.filter((w) => !w[4]).length - 4;
      card.append(el('b', null, `${ROOM_TYPES[type].label} · ${n}점`), canvas,
        el('span', 'muted', `${layout.width.toFixed(1)} × ${layout.depth.toFixed(1)} m` + (type === 'flat' ? ` · 방 ${walls / 2 + 1}개` : ` · ${test.arrangement === 'circle' ? '원형' : '격자'} 배치`)), btn);
      cards.append(card);
    }
  }
  function openTest() {
    if (!$('testOpts').children.length)
      $('testOpts').append(
        select('입체 배치', { grid: { label: '격자' }, circle: { label: '원형' } }, () => test.arrangement, (v) => { test.arrangement = v; }),
        select('벽 색', WALLS, () => test.theme.wall, (v) => { test.theme.wall = v; }),
        select('바닥', FLOORS, () => test.theme.floor, (v) => { test.theme.floor = v; }),
        select('조명 밝기', BRIGHTNESS, () => test.theme.brightness, (v) => { test.theme.brightness = v; }));
    testEl.classList.remove('hidden'); $('testToggle').textContent = '테스트 화면 닫기';
    if (!$('voxMsg').textContent) voxMsg('지금 기본 모형: ' + hooks.baseInfo());
    renderTest();
  }
  $('testToggle').addEventListener('click', () => {
    if (testEl.classList.contains('hidden')) openTest();
    else { testEl.classList.add('hidden'); $('testToggle').textContent = '공간 확인용 테스트 화면'; }
  });
  $('lobbyCustomize').addEventListener('click', onCustomize);

  // ── 복셀 캐릭터 테스트: 30명 성능 테스트, 기본 모형(.vox) 불러오기 · 내보내기 ──
  const voxMsg = (text) => { $('voxMsg').textContent = text; };
  $('crowdBtn').addEventListener('click', () => hooks.onCrowdTest({ ...test.theme }));
  $('voxExport').addEventListener('click', hooks.onVoxExport);
  $('voxReset').addEventListener('click', () => voxMsg('내장 기본 모형으로 되돌렸습니다. ' + hooks.onVoxReset()));
  $('voxFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try { voxMsg(`'${file.name}' 을(를) 기본 모형으로 적용했습니다. ` + await hooks.onVoxImport(file)); }
    catch (err) { voxMsg('불러오지 못했습니다: ' + err.message); }
  });

  return {
    open() {
      root.classList.remove('hidden');
      if (!loaded) loadList();
      if (new URLSearchParams(location.search).has('test') && testEl.classList.contains('hidden')) openTest();
    },
    close() { root.classList.add('hidden'); },
  };
}
