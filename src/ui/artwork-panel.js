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
      $('detailImg').style.display = a.imageUrl ? '' : 'none';
      fillInfo('detail', a);
      detailEl.classList.remove('hidden'); $('detailCard').scrollTop = 0;
      api.update(null);
    },
    closeDetail() { detailOpen = false; detailEl.classList.add('hidden'); $('detailImg').removeAttribute('src'); },
    reset() { api.closeDetail(); api.update(null); },       // 전시실에서 나갈 때
  };
  plateEl.addEventListener('click', () => nearArt && onOpen(nearArt));
  $('detailClose').addEventListener('click', api.closeDetail);
  detailEl.addEventListener('click', (e) => { if (e.target === detailEl) api.closeDetail(); });
  return api;
}
