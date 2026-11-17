// 교사용 화면 공용 도우미: 요소 만들기, 안내 문구, 버튼 실행, 화면 안의 창
export const $ = (id) => document.getElementById(id);
export const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
export const show = (target, on = true) => (typeof target === 'string' ? $(target) : target).classList.toggle('hidden', !on);
export const button = (text, cls, onClick) => { const b = el('button', cls, text); b.type = 'button'; if (onClick) b.addEventListener('click', () => onClick(b)); return b; };
export const field = (label, input, cls = 'f') => { const l = el('label', cls); l.append(label, input); return l; };
export const input = (type, value = '', attrs = {}) => { const i = el(type === 'textarea' ? 'textarea' : 'input'); if (type !== 'textarea') i.type = type; i.value = value ?? ''; Object.assign(i, attrs); return i; };

// 화면 위쪽 안내 문구. kind: 'info' | 'error'
export function message(text, kind = 'info') {
  const m = $('msg'); m.textContent = text; m.className = text ? kind : 'hidden';
  if (text) m.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
// 버튼을 누르면: 중복 클릭을 막고, 오류는 화면에 쉬운 문장으로 표시
export async function run(btn, work) {
  if (btn) btn.disabled = true;
  message('');
  try { return await work(); }
  catch (e) { message(e?.message || String(e), 'error'); }
  finally { if (btn) btn.disabled = false; }
}

// 화면 안의 창. build(panel, close) 에서 내용을 채운다. 반환: close(값) 에 넘긴 값 (바깥을 누르면 null)
export function dialog(build, { wide = false } = {}) {
  return new Promise((resolve) => {
    const overlay = el('div', 'overlay'), panel = el('div', 'panel' + (wide ? ' wide' : ''));
    const close = (value = null) => { overlay.remove(); resolve(value); };
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(null); });
    overlay.append(panel); document.body.append(overlay);
    build(panel, close);
  });
}
// 예/아니오 (브라우저 기본 확인 창은 막히는 환경이 있어 쓰지 않음)
export function confirmBox(text, yesLabel = '확인', danger = true) {
  return dialog((panel, close) => {
    const row = el('div', 'row end');
    row.append(button('취소', 'light', () => close(false)), button(yesLabel, danger ? 'danger' : '', () => close(true)));
    panel.append(el('p', 'pre', text), row);
  }).then((v) => v === true);
}

export const mb = (n) => (Math.round(Number(n) * 10) / 10).toLocaleString();
export const VISIBILITY = { public: '공개', link: '링크 공유', class: '학급 전용', private: '비공개' };
export const TYPE_LABEL = { flat: '평면 전용', sculpture: '입체 전용', mixed: '혼합 (평면 + 입체)' };
