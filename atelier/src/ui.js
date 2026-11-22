// 학생 · 교사 화면이 함께 쓰는 작은 도우미
export const $ = (id) => document.getElementById(id);

// 요소 만들기: h('button', { class: 'btn', onclick: fn }, '글', 다른요소…)
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...kids.flat().filter((x) => x != null && x !== false));
  return e;
}
export const show = (el, on = true) => (typeof el === 'string' ? $(el) : el).classList.toggle('hidden', !on);

export function fmtSize(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1048576) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)}MB`;
}
const pad = (n) => String(n).padStart(2, '0');
export function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// 마감까지 남은 시간을 쉬운 말로.  { text, tone: 'late' | 'soon' | '' }
export function dueInfo(iso) {
  if (!iso) return { text: '마감 없음', tone: '' };
  const left = new Date(iso) - Date.now(), day = 86400000;
  if (left < 0) return { text: `마감 지남 (${fmtDate(iso)})`, tone: 'late' };
  if (left < day) return { text: `오늘 마감 · ${fmtDate(iso)}`, tone: 'soon' };
  return { text: `${Math.ceil(left / day)}일 남음 · ${fmtDate(iso)}`, tone: left < 3 * day ? 'soon' : '' };
}
// <input type="datetime-local"> 값 ↔ ISO
export const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

// 화면 아래 잠깐 뜨는 알림
export function toast(text, kind = 'info') {
  let box = $('toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + kind }, text);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3000);
}
// 버튼을 누르면: 중복 클릭을 막고, 오류는 알림으로 보여 준다
export async function run(btn, work) {
  if (btn) { if (btn.disabled) return; btn.disabled = true; btn.classList.add('busy'); }
  try { return await work(); }
  catch (e) { toast(e?.message || String(e), 'error'); }
  finally { if (btn) { btn.disabled = false; btn.classList.remove('busy'); } }
}

// 화면 안의 창 (ESC · 바깥 누르기로 닫힘).  build(panel, close) → close(값) 에 넘긴 값
export function dialog(build) {
  return new Promise((resolve) => {
    const panel = h('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true' });
    const overlay = h('div', { class: 'overlay', onpointerdown: (e) => { if (e.target === overlay) close(null); } }, panel);
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    function close(value = null) { document.removeEventListener('keydown', onKey); overlay.remove(); resolve(value); }
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    build(panel, close);
    panel.querySelector('input, textarea, button')?.focus();
  });
}
export const confirmBox = (text, yes = '확인', danger = false) => dialog((panel, close) => {
  panel.append(h('p', { class: 'pre' }, text),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => close(false) }, '취소'), h('button', { class: 'btn' + (danger ? ' danger' : ''), type: 'button', onclick: () => close(true) }, yes)));
}).then((v) => v === true);

// 내려받은 파일 보여 주기: 그림 · PDF · 영상 · 소리 · 글은 창 안에서 바로 보고, 나머지는 저장한다
export function openBlob(name, blob) {
  const url = URL.createObjectURL(blob), type = blob.type || '';
  const save = () => { const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); };
  let view = null;
  if (type.startsWith('image/')) view = h('img', { src: url, alt: name });
  else if (type.startsWith('video/')) view = h('video', { src: url, controls: true });
  else if (type.startsWith('audio/')) view = h('audio', { src: url, controls: true });
  else if (type === 'application/pdf') view = h('iframe', { src: url, title: name });
  if (!view) { save(); setTimeout(() => URL.revokeObjectURL(url), 60000); toast(`"${name}" 을 내려받았습니다`); return; }
  dialog((panel, close) => {
    panel.classList.add('viewer');
    panel.append(h('div', { class: 'row between' }, h('b', { class: 'ellipsis' }, name),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost small', type: 'button', onclick: save }, '저장'), h('button', { class: 'btn small', type: 'button', onclick: () => close() }, '닫기'))), view);
  }).then(() => URL.revokeObjectURL(url));
}

// 파일 한 줄: 이름 · 크기 · [열기] (+ 지우기).  api.download / api.removeFile 을 쓴다
export function fileRow(api, f, { onRemove = null } = {}) {
  const bar = h('span', { class: 'muted' }, `${fmtSize(f.size)} · ${fmtDate(f.created_at)}`);
  const open = h('button', { class: 'btn ghost small', type: 'button', onclick: () => run(open, async () => {
    const { name, blob } = await api.download(f.id, (p) => { bar.textContent = `가져오는 중 ${Math.round(p * 100)}%`; });
    bar.textContent = `${fmtSize(f.size)} · ${fmtDate(f.created_at)}`;
    openBlob(name, blob);
  }) }, '열기');
  const del = onRemove && h('button', { class: 'btn ghost small danger', type: 'button', onclick: async () => {
    if (!await confirmBox(`"${f.name}" 을 지울까요?`, '지우기', true)) return;
    await run(del, async () => { await api.removeFile(f.id); await onRemove(f); });
  } }, '지우기');
  return h('li', { class: 'file' }, h('div', { class: 'fileName' }, h('b', { class: 'ellipsis' }, f.name), bar), h('div', { class: 'row' }, open, del));
}

// 파일 고르기 칸 (끌어다 놓기도 됨).  onFiles(File[])
export function dropZone(label, onFiles, { multiple = true } = {}) {
  const input = h('input', { type: 'file', multiple, hidden: true, onchange: () => { const list = [...input.files]; input.value = ''; if (list.length) onFiles(list); } });
  const zone = h('label', { class: 'drop', tabIndex: 0 }, input, h('b', null, label), h('span', { class: 'muted' }, '눌러서 고르거나 파일을 여기로 끌어다 놓으세요'));
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  for (const ev of ['dragenter', 'dragover']) zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); });
  zone.addEventListener('drop', (e) => { const list = [...(e.dataTransfer?.files ?? [])]; if (list.length) onFiles(multiple ? list : list.slice(0, 1)); });
  return zone;
}
// 여러 파일을 차례로 올리며 진행 막대를 보여 준다.  box = 진행 막대를 넣을 곳
export async function uploadAll(api, assignmentId, kind, list, box) {
  let ok = 0;
  for (const file of list) {
    const fill = h('i'), line = h('div', { class: 'progress' }, h('span', { class: 'ellipsis' }, `${file.name} (${fmtSize(file.size)})`), h('div', { class: 'bar' }, fill));
    box.append(line);
    try { await api.upload(assignmentId, kind, file, (p) => { fill.style.width = `${Math.round(p * 100)}%`; }); ok++; line.remove(); }
    catch (e) { line.classList.add('failed'); line.append(h('span', { class: 'warn' }, e?.message || '올리지 못했습니다')); setTimeout(() => line.remove(), 8000); }
  }
  return ok;
}
