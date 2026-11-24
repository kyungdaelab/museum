// 작품 이름표(가까이 가면 하단에 표시)와 평면 작품 상세 패널
const $ = (id) => document.getElementById(id);
export const artistName = (d) => (typeof d.artist === 'string' && d.artist.trim()) || '익명';

// 제목 · 작가 · 정보표 · 설명 채우기 (상세 패널 'detail', 감상 모드 'view' 가 같이 사용)
export function fillInfo(prefix, a) {
  const d = a.data;
  $(prefix + 'Title').textContent = d.title || '제목 없음';
  $(prefix + 'Artist').textContent = artistName(d);
  const meta = $(prefix + 'Meta'); meta.replaceChildren();
  for (const [label, v] of [['학년/반', d.grade], ['재료', d.material], ['크기', d.size], ['전시 위치', `${d.slot}번 자리`]]) {
    if (!v) continue;
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label; dd.textContent = v; meta.append(dt, dd);
  }
  $(prefix + 'Desc').textContent = d.description || '';
}

const hint = (a) => (a.kind === 'image' ? '눌러서 자세히 보기' : a.loaded ? '눌러서 360° 감상하기'
  : a.status === 'error' ? '작품 파일을 불러오지 못했습니다' : '불러오는 중…');

// 돋보기: 그림을 화면 가득 띄워 확대(휠 · 두 손가락 · + −)하고 끌어서 옮겨 본다. ESC · × · 바깥 누르기로 닫힌다
function createZoom() {
  const box = $('zoom'), img = $('zoomImg'), MAX = 8;
  let s = 1, x = 0, y = 0, isOpen = false, moved = false;
  const pts = new Map();                     // 화면에 닿아 있는 손가락(또는 마우스)
  const draw = () => {
    // 그림이 화면 밖으로 완전히 나가지 않게 붙잡는다
    const mx = Math.max(0, (img.offsetWidth * s - innerWidth * 0.5) / 2 + innerWidth * 0.25), my = Math.max(0, (img.offsetHeight * s - innerHeight * 0.5) / 2 + innerHeight * 0.25);
    x = Math.min(mx, Math.max(-mx, x)); y = Math.min(my, Math.max(-my, y));
    if (s === 1) { x = 0; y = 0; }
    img.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${s})`;
    $('zoomPct').textContent = `${Math.round(s * 100)}%`;
  };
  // (px, py) 화면 위치를 중심으로 배율을 바꾼다
  const zoomAt = (next, px = innerWidth / 2, py = innerHeight / 2) => {
    next = Math.min(MAX, Math.max(1, next));
    const k = next / s, cx = px - innerWidth / 2 - x, cy = py - innerHeight / 2 - y;
    x -= cx * (k - 1); y -= cy * (k - 1); s = next; draw();
  };
  const api = {
    open(src, alt = '') { img.src = src; img.alt = alt; s = 1; x = 0; y = 0; isOpen = true; box.classList.remove('hidden'); draw(); },
    close() { if (!isOpen) return; isOpen = false; pts.clear(); box.classList.add('hidden'); box.classList.remove('drag'); img.removeAttribute('src'); },
  };
  box.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); zoomAt(s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); }, { passive: false });
  box.addEventListener('dblclick', (e) => { if (e.target.closest('button')) return; zoomAt(s > 1.05 ? 1 : 2.5, e.clientX, e.clientY); });
  box.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false;
    box.setPointerCapture(e.pointerId); box.classList.add('drag');
  });
  box.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    if (pts.size === 2) {                    // 두 손가락: 벌린 만큼 확대
      const [a, b] = [...pts.values()], before = Math.hypot(a.x - b.x, a.y - b.y);
      p.x = e.clientX; p.y = e.clientY;
      const [c, d] = [...pts.values()], after = Math.hypot(c.x - d.x, c.y - d.y);
      if (before > 0) zoomAt(s * after / before, (c.x + d.x) / 2, (c.y + d.y) / 2);
      moved = true; return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    p.x = e.clientX; p.y = e.clientY; x += dx; y += dy; draw();
  });
  const up = (e) => {
    if (!pts.delete(e.pointerId)) return;
    if (!pts.size) box.classList.remove('drag');
    if (!moved && e.type === 'pointerup' && e.target === box) api.close();        // 그림 바깥의 어두운 곳을 누르면 닫힌다
  };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  $('zoomIn').addEventListener('click', () => zoomAt(s * 1.5));
  $('zoomOut').addEventListener('click', () => zoomAt(s / 1.5));
  $('zoomFit').addEventListener('click', () => zoomAt(1));
  $('zoomClose').addEventListener('click', api.close);
  // 돋보기가 열려 있을 때의 ESC 는 돋보기만 닫는다 (뒤의 상세 패널은 그대로)
  window.addEventListener('keydown', (e) => { if (isOpen && e.code === 'Escape') { e.stopImmediatePropagation(); api.close(); } }, true);
  window.addEventListener('resize', () => isOpen && draw());
  return api;
}

// onOpen(작품) : 이름표를 눌렀을 때 (어떤 화면을 열지는 main 이 결정)
export function createArtworkPanel({ onOpen }) {
  const plateEl = $('plate'), detailEl = $('detail');
  let nearArt = null, plateKey = '', detailOpen = false;

  const api = {
    get nearArt() { return nearArt; },
    get detailOpen() { return detailOpen; },
    // 매 프레임: 지금 가까이 있는 작품(없으면 null)을 받아 이름표 갱신
    update(a) {
      const key = a ? a.data.id + hint(a) : '';
      if (a === nearArt && key === plateKey) return;
      nearArt = a; plateKey = key;
      plateEl.classList.toggle('hidden', !a);
      if (a) {
        $('plateTitle').textContent = a.data.title || '제목 없음';
        $('plateArtist').textContent = [artistName(a.data), a.data.grade].filter(Boolean).join(' · ');
        $('plateHint').textContent = hint(a);
      }
    },
    openDetail(a) {
      detailOpen = true;
      $('detailImg').src = a.imageUrl || ''; $('detailImg').alt = a.data.title || '';
      $('detailFig').style.display = a.imageUrl ? '' : 'none';
      fillInfo('detail', a);
      detailEl.classList.remove('hidden'); $('detailCard').scrollTop = 0;
      api.update(null);
    },
    closeDetail() { zoom.close(); detailOpen = false; detailEl.classList.add('hidden'); $('detailImg').removeAttribute('src'); },
    reset() { api.closeDetail(); api.update(null); },       // 전시실에서 나갈 때
  };
  const zoom = createZoom();
  const openZoom = () => { const img = $('detailImg'); if (img.getAttribute('src')) zoom.open(img.src, img.alt); };
  $('detailZoom').addEventListener('click', openZoom);
  $('detailImg').addEventListener('click', openZoom);
  plateEl.addEventListener('click', () => nearArt && onOpen(nearArt));
  $('detailClose').addEventListener('click', api.closeDetail);
  detailEl.addEventListener('click', (e) => { if (e.target === detailEl) api.closeDetail(); });
  return api;
}
