// 아틀리에 학생 화면: 로그인 → [공지 + 내 과제] → 과제 한 개(설명 · 참고 자료 · 제출)
import { createApi } from './api.js';
import { $, h, show, fmtDate, dueInfo, toast, run, fileRow, dropZone, uploadAll } from './ui.js';
import { PORTAL_URL } from '../../src/data/portal.js';
import { journalCard } from './journal.js';

// 훌륭한 실패(프로세스 저널)가 첫 화면 대신 다른 화면을 보여 줄 때 쓴다
const nav = {
  home: () => run(null, loadHome),
  open: (build) => run(null, async () => { const view = $('detailView'); view.replaceChildren(); show('homeView', false); show(view); window.scrollTo(0, 0); await build(view); }),
};

const api = await createApi('student');
show('demoBanner', api.mode === 'demo');
let home = null;            // { me, notices, assignments }

/* ── 로그인 ── */
async function start() {
  const account = await api.account();
  const student = account.kind === 'student';
  show('loginView', !student); show('who', student); show('detailView', false);
  if (!student) {
    show('homeView', false);
    // 구글로 로그인은 했지만 아직 가입(학번 · 이름 · 별명)을 마치지 않았으면 수업 공간에서 마무리하도록 보낸다
    if (account.unregistered) { $('loginHint').textContent = '가입이 아직 끝나지 않았어요. 수업 공간 첫 화면에서 학번 · 이름 · 별명을 적어 가입을 마쳐 주세요.'; $('loginBtn').textContent = '수업 공간으로 가기'; $('loginBtn').dataset.go = 'portal'; }
    if (account.kind === 'teacher' || account.pending) toast('선생님 계정으로 들어와 있습니다. 교사용 화면을 이용해 주세요.');
    return;
  }
  await loadHome();
}
$('portalLink').href = PORTAL_URL;
$('loginBtn').addEventListener('click', () => run($('loginBtn'), async () => {
  if ($('loginBtn').dataset.go === 'portal') { location.href = PORTAL_URL; return; }
  await api.signInGoogle();
  await start();                      // (연습 모드에서는 바로 로그인된다. 실제로는 구글 화면으로 넘어간다)
}));
$('logout').addEventListener('click', () => run($('logout'), async () => { await api.logout(); home = null; await start(); }));

/* ── 첫 화면 ── */
// 과제의 상태 칩: 냈는지가 먼저, 안 냈으면 마감이 얼마나 남았는지
function statusChip(a) {
  if (a.mine.length) return h('span', { class: 'chip ok' }, `제출 완료 · 파일 ${a.mine.length}개`);
  if (a.locked) return h('span', { class: 'chip late' }, a.closed ? '제출 마감됨' : '마감 지나 제출 불가');
  const due = dueInfo(a.due_at);
  return h('span', { class: 'chip ' + (due.tone === 'late' ? 'late' : due.tone === 'soon' ? 'soon' : '') }, due.tone === 'late' ? '아직 안 냄 · 마감 지남' : '아직 안 냄');
}
async function loadHome() {
  home = await api.studentHome();
  $('whoName').textContent = home.me.nickname || '학생';            // 화면에는 학번 · 이름이 아니라 별명만 보인다
  show('homeView'); show('detailView', false);

  // 맨 위: 훌륭한 실패 (프로세스 저널). 과제 · 공지보다 먼저 보인다
  const card = await journalCard(api, nav);
  $('journalSection').replaceChildren(...(card ? [card] : [])); show('journalSection', !!card);

  const nBox = $('notices'); nBox.replaceChildren();
  show('noticeSection', home.notices.length > 0);
  for (const n of home.notices) {
    nBox.append(h('article', { class: 'card notice' },
      h('div', { class: 'row between' }, h('h2', null, n.title), n.pinned && h('span', { class: 'chip pin' }, '중요')),
      h('p', { class: 'muted' }, `${n.teacher ? n.teacher + ' 선생님 · ' : ''}${fmtDate(n.created_at)}`),
      n.body && h('p', { class: 'pre' }, n.body)));
  }

  const aBox = $('assignments'); aBox.replaceChildren();
  if (!home.assignments.length) aBox.append(h('div', { class: 'empty' }, '아직 받은 과제가 없어요.'));
  // 아직 안 낸 과제를 위로, 그 안에서는 마감이 가까운 순서로
  const order = [...home.assignments].sort((a, b) => (a.mine.length > 0) - (b.mine.length > 0) || (a.due_at ?? '9').localeCompare(b.due_at ?? '9'));
  for (const a of order) {
    aBox.append(h('button', { class: 'card', type: 'button', onclick: () => openAssignment(a.id) },
      h('div', { class: 'row between' }, h('h2', { class: 'ellipsis' }, a.title), statusChip(a)),
      h('p', { class: 'muted' }, dueInfo(a.due_at).text + (a.refs.length ? ` · 참고 자료 ${a.refs.length}개` : ''))));
  }
}

/* ── 과제 한 개 ── */
function openAssignment(id) {
  const a = home.assignments.find((x) => x.id === id);
  if (!a) return loadHome();
  const view = $('detailView'); view.replaceChildren();
  show('homeView', false); show(view); window.scrollTo(0, 0);
  const refresh = async () => { home = await api.studentHome(); openAssignment(id); };

  view.append(h('button', { class: 'btn ghost small', type: 'button', onclick: () => loadHome() }, '← 과제 목록'),
    h('div', { style: 'margin: 18px 0 6px' }, h('h1', null, a.title)),
    h('div', { class: 'row' }, statusChip(a), h('span', { class: 'muted' }, dueInfo(a.due_at).text)));

  if (a.body || a.link) view.append(h('h3', null, '과제 설명'), h('div', { class: 'card stack' },
    a.body && h('p', { class: 'pre' }, a.body),
    a.link && h('p', null, h('a', { href: a.link, target: '_blank', rel: 'noopener noreferrer' }, '참고 링크 열기 ↗'))));

  if (a.refs.length) view.append(h('h3', null, '선생님이 올린 참고 자료'), h('ul', { class: 'card' }, a.refs.map((f) => fileRow(api, f))));

  // 제출
  const progress = h('div'), mine = h('ul', { class: 'card' + (a.mine.length ? '' : ' hidden') }, a.mine.map((f) => fileRow(api, f, { onRemove: a.locked ? null : refresh })));
  view.append(h('h3', null, '내가 낸 파일'), mine);
  if (!a.mine.length) view.append(h('p', { class: 'muted', style: 'margin-bottom: 12px' }, '아직 낸 파일이 없어요.'));
  if (a.locked) view.append(h('div', { class: 'empty' }, a.closed ? '선생님이 제출을 마감했어요.' : '마감 시간이 지나 더 낼 수 없어요. 꼭 내야 하면 선생님께 말씀드려 주세요.'));
  else view.append(a.lock_after_due && a.due_at ? h('p', { class: 'warn', style: 'margin-bottom:12px;font-size:14px' }, `${fmtDate(a.due_at)} 이 지나면 낼 수 없어요.`) : null, dropZone(a.mine.length ? '파일 더 내기' : '과제 제출하기', async (list) => {
    const ok = await uploadAll(api, a.id, 'sub', list, progress);
    if (ok) { toast(`파일 ${ok}개를 제출했어요`); await refresh(); }
  }), progress);
}

run(null, start);
