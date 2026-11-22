// 아틀리에 교사 화면: 로그인 → [과제] [공지] [드라이브 연결]
import { createApi, currentTerm } from './api.js';
import { PORTAL_URL } from '../../src/data/portal.js';
import { renderJournalTeacher } from './journal.js';
import { $, h, show, fmtDate, dueInfo, toLocalInput, fromLocalInput, toast, run, dialog, confirmBox, fileRow, dropZone, uploadAll } from './ui.js';

const api = await createApi('teacher');
show('demoBanner', api.mode === 'demo');
let home = null;            // { drive, classes, assignments, notices }
let tab = 'assignments';

/* ── 로그인 ── */
async function start() {
  const account = await api.account();
  const teacher = account.kind === 'teacher';
  show('loginView', !teacher); show('appView', teacher); show('who', teacher);
  if (!teacher) {
    // 구글로 로그인은 했지만 아직 신청 전이거나 승인 대기 중이면: 수업 공간의 선생님 창에서 이어서 한다
    const waiting = account.unregistered || account.pending;
    show('googleBtn', !waiting); show('applyLink', !!waiting); show('who', !!account.signedIn || account.kind === 'student');
    $('whoName').textContent = '';
    if (waiting) $('loginHint').textContent = account.pending ? '가입 신청이 접수되어 관리자의 승인을 기다리고 있습니다.' : '구글 계정으로 로그인했습니다. 교사 가입 신청을 해 주세요.';
    if (account.kind === 'student') toast('학생 계정으로 들어와 있습니다. 로그아웃한 뒤 교사 계정으로 로그인해 주세요.');
    return;
  }
  $('whoName').textContent = `${account.name || ''} 선생님`;
  await finishGoogleReturn();
  await reload();
}
// 구글 로그인 화면에서 돌아왔으면(주소에 ?code=…&state=… 가 붙어 있음) 드라이브 연결을 마무리한다
async function finishGoogleReturn() {
  const q = new URLSearchParams(location.search), code = q.get('code'), state = q.get('state'), denied = q.get('error');
  if (!code && !denied) return;
  history.replaceState(null, '', location.pathname + (q.has('demo') ? '?demo' : ''));        // 새로 고쳐도 같은 요청이 다시 가지 않게 주소를 정리
  tab = 'drive';
  if (denied) { toast('구글 연결을 취소했습니다', 'error'); return; }
  try { const out = await api.finishConnect(code, state); toast(`구글 드라이브를 연결했습니다 (${out.email})`); }
  catch (e) { toast(e?.message || '구글 드라이브를 연결하지 못했습니다', 'error'); }
}
$('portalLink').href = PORTAL_URL + 'teacher.html'; $('applyLink').href = PORTAL_URL + 'teacher.html';        // 교사는 수업 공간의 선생님 화면(학급 · 학생 관리)으로 돌아간다
$('googleBtn').addEventListener('click', () => run($('googleBtn'), async () => { await api.signInGoogle(); await start(); }));
$('loginForm').addEventListener('submit', (e) => { e.preventDefault(); run($('loginBtn'), async () => {
  await api.signInTeacher($('email').value.trim(), $('password').value);
  $('password').value = '';
  if ((await api.account()).kind !== 'teacher') throw new Error('아직 승인되지 않은 계정입니다. 관리자의 승인을 기다려 주세요.');
  await start();
}); });
$('logout').addEventListener('click', () => run($('logout'), async () => { await api.logout(); home = null; await start(); }));
for (const b of $('tabs').children) b.addEventListener('click', () => { tab = b.dataset.tab; render(); });

async function reload() { home = await api.teacherHome(); render(); }
function render() {
  for (const b of $('tabs').children) b.classList.toggle('sel', b.dataset.tab === tab);
  show('driveBanner', !home.drive && tab !== 'drive');
  const view = $('view'); view.replaceChildren();
  ({ assignments: renderAssignments, notices: renderNotices, drive: renderDrive, journal: (v) => run(null, () => renderJournalTeacher(api, v)) })[tab](view);
}
const classNames = (ids) => home.classes.filter((c) => ids.includes(c.id)).map((c) => c.name).join(', ') || '(반 없음)';

// 반 고르기: 체크 상자들 + 전체 선택.  반환 { el, value() }
function classPicker(selected = []) {
  const boxes = home.classes.map((c) => h('input', { type: 'checkbox', value: c.id, checked: selected.includes(c.id) }));
  const all = h('button', { class: 'btn ghost small', type: 'button', onclick: () => { const on = boxes.some((b) => !b.checked); for (const b of boxes) b.checked = on; } }, '전체 선택');
  const el = h('div', { class: 'stack' }, h('div', { class: 'row between' }, h('span', { class: 'muted', style: 'font-weight:600' }, '어느 반에 낼까요?'), home.classes.length > 1 && all),
    home.classes.length ? h('div', { class: 'row' }, home.classes.map((c, i) => h('label', { class: 'check' }, boxes[i], `${c.name} (${c.count}명)`)))
      : h('p', { class: 'warn' }, '아직 학급이 없습니다. 수업 공간의 선생님 화면("학급 · 학생")에서 학급을 먼저 만들어 주세요.'));
  return { el, value: () => boxes.filter((b) => b.checked).map((b) => b.value) };
}

/* ── 과제 ── */
function renderAssignments(view) {
  view.append(h('div', { class: 'row between', style: 'margin-bottom:16px' }, h('h1', null, '과제'), h('button', { class: 'btn', type: 'button', onclick: () => editAssignment(null) }, '+ 새 과제')));
  if (!home.assignments.length) view.append(h('div', { class: 'empty' }, '아직 낸 과제가 없습니다. "새 과제"를 눌러 과제를 만들고 반을 골라 주세요.'));
  const list = h('div', { class: 'stack' });
  for (const a of home.assignments) {
    const due = dueInfo(a.due_at);
    const del = h('button', { class: 'btn ghost small danger', type: 'button', onclick: async () => {
      if (!await confirmBox(`"${a.title}" 과제를 지울까요?\n학생 화면에서 과제와 제출 기록이 사라집니다.\n드라이브에 올라온 파일은 선생님 드라이브에 그대로 남습니다.`, '지우기', true)) return;
      await run(del, async () => { await api.deleteAssignment(a.id); toast('과제를 지웠습니다'); await reload(); });
    } }, '지우기');
    list.append(h('article', { class: 'card stack' },
      h('div', { class: 'row between' }, h('h2', { class: 'ellipsis' }, a.title),
        a.closed ? h('span', { class: 'chip late' }, '마감함') : a.locked ? h('span', { class: 'chip late' }, '마감 지남 · 제출 막힘') : h('span', { class: 'chip ' + due.tone }, due.text)),
      h('p', { class: 'muted' }, `${a.school_year}년도 ${a.semester}학기 · ${classNames(a.class_ids)} · 제출 ${a.submitted} / ${a.total}명` + (a.refs.length ? ` · 참고 자료 ${a.refs.length}개` : '')
        + (a.due_at && !a.locked ? (a.lock_after_due ? ' · 마감 뒤 제출 막음' : ' · 마감 뒤에도 제출 가능') : '')),
      h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => showSubmissions(a) }, '제출 현황'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => editAssignment(a) }, '고치기 · 참고 자료'), del)));
  }
  view.append(list);
}

// 과제 만들기 · 고치기 창. 참고 자료는 저장할 때 함께 올린다
function editAssignment(a) {
  dialog((panel, close) => {
    const title = h('input', { type: 'text', maxLength: 80, value: a?.title ?? '', placeholder: '예: 나의 얼굴 드로잉' });
    const body = h('textarea', { maxLength: 4000, value: a?.body ?? '', placeholder: '무엇을 어떻게 해서 내는지 적어 주세요' });
    const link = h('input', { type: 'url', maxLength: 500, value: a?.link ?? '', placeholder: 'https://… (없으면 비워 두세요)' });
    const due = h('input', { type: 'datetime-local', value: toLocalInput(a?.due_at) });
    const lock = h('input', { type: 'checkbox', checked: !!a?.lock_after_due });
    const term = a ?? currentTerm();
    const year = h('input', { type: 'number', min: 2020, max: 2100, value: term.school_year, style: 'width:120px' });
    const semester = h('select', null, h('option', { value: '1', selected: term.semester === 1 }, '1학기'), h('option', { value: '2', selected: term.semester === 2 }, '2학기'));
    const closed = h('input', { type: 'checkbox', checked: !!a?.closed });
    const picker = classPicker(a?.class_ids ?? []);
    const staged = [], stagedBox = h('ul'), progress = h('div');
    const refs = h('ul', null, (a?.refs ?? []).map((f) => fileRow(api, f, { onRemove: () => { a.refs = a.refs.filter((x) => x.id !== f.id); refs.replaceChildren(...a.refs.map((x) => fileRow(api, x))); } })));
    const drawStaged = () => stagedBox.replaceChildren(...staged.map((f, i) => h('li', { class: 'file' }, h('b', { class: 'ellipsis' }, f.name),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => { staged.splice(i, 1); drawStaged(); } }, '빼기'))));
    const save = h('button', { class: 'btn', type: 'button', onclick: () => run(save, async () => {
      if (lock.checked && !due.value) throw new Error('마감 뒤 제출을 막으려면 마감 날짜와 시간을 정해 주세요');
      const id = await api.saveAssignment({ id: a?.id, title: title.value, body: body.value, link: link.value.trim(), school_year: +year.value, semester: +semester.value,
        due_at: fromLocalInput(due.value), lock_after_due: lock.checked, closed: closed.checked, class_ids: picker.value() });
      const ok = staged.length ? await uploadAll(api, id, 'ref', staged, progress) : 0;
      if (ok < staged.length) { toast('과제는 저장했지만 올리지 못한 참고 자료가 있습니다. "고치기"에서 다시 올려 주세요', 'error'); }
      else toast(a ? '과제를 고쳤습니다' : '과제를 냈습니다. 고른 반 학생들의 화면에 바로 보입니다');
      close(); await reload();
    }) }, a ? '저장' : '과제 내기');
    panel.append(h('h2', null, a ? '과제 고치기' : '새 과제'),
      h('label', { class: 'f' }, '제목', title), h('label', { class: 'f' }, '설명', body),
      h('label', { class: 'f' }, '참고 링크', link),
      h('label', { class: 'f' }, '마감 날짜와 시간 (비워 두면 마감 없음)', due),
      h('label', { class: 'check' }, lock, '마감 시간이 지나면 제출 막기 (끄면 늦게 내는 것도 받음)'),
      h('div', { class: 'stack' }, h('div', { class: 'row', style: 'align-items:flex-end' }, h('label', { class: 'f' }, '학년도', year), h('label', { class: 'f' }, '학기', semester)),
        h('p', { class: 'muted' }, '드라이브에 "아틀리에 / 2026년도 / 2학기 / 과제 이름" 순서의 폴더로 저장됩니다. 그 안에 반 · 학생별 폴더가 생깁니다.')),
      picker.el,
      h('div', { class: 'stack' }, h('span', { class: 'muted', style: 'font-weight:600' }, '참고 자료 (학생이 볼 수 있는 파일)'),
        !home.drive && h('p', { class: 'warn' }, '파일을 올리려면 먼저 "드라이브 연결" 탭에서 구글 계정으로 연결해 주세요.'),
        refs, stagedBox, dropZone('참고 자료 넣기', (list) => { staged.push(...list); drawStaged(); }), progress),
      a && h('label', { class: 'check' }, closed, '제출 마감하기 (학생이 더 내거나 지울 수 없음)'),
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, '취소'), save));
  });
}

// 제출 현황: 반마다 누가 냈고 누가 안 냈는지
async function showSubmissions(a) {
  const view = $('view');
  await run(null, async () => {
    const groups = await api.submissions(a.id);
    view.replaceChildren(h('button', { class: 'btn ghost small', type: 'button', onclick: () => reload() }, '← 과제 목록'),
      h('div', { style: 'margin:18px 0 6px' }, h('h1', null, a.title)), h('p', { class: 'muted' }, `${dueInfo(a.due_at).text} · 파일은 선생님 드라이브의 "아틀리에" 폴더에도 반 · 학생별로 정리되어 있습니다`));
    for (const g of groups) {
      const done = g.students.filter((s) => s.files.length).length, missing = g.students.filter((s) => !s.files.length);
      const rows = g.students.map((s) => h('tr', null, h('td', null, `${s.no}`), h('td', null, s.name),
        s.files.length ? h('td', null, h('ul', null, s.files.map((f) => fileRow(api, f, { onRemove: () => showSubmissions(a) })))) : h('td', { class: 'none' }, '아직 안 냄')));
      view.append(h('h3', null, `${g.name} · 제출 ${done} / ${g.students.length}명`),
        missing.length && done ? h('p', { class: 'muted', style: 'margin-bottom:8px' }, `안 낸 학생: ${missing.map((s) => `${s.no}번 ${s.name}`).join(', ')}`) : null,
        h('div', { class: 'card' }, g.students.length ? h('table', null, h('thead', null, h('tr', null, h('th', null, '번호'), h('th', null, '이름'), h('th', null, '낸 파일'))), h('tbody', null, rows)) : h('p', { class: 'muted' }, '이 반에는 등록된 학생이 없습니다.')));
    }
    window.scrollTo(0, 0);
  });
}

/* ── 공지 ── */
function renderNotices(view) {
  view.append(h('div', { class: 'row between', style: 'margin-bottom:16px' }, h('h1', null, '공지'), h('button', { class: 'btn', type: 'button', onclick: () => editNotice(null) }, '+ 새 공지')));
  if (!home.notices.length) view.append(h('div', { class: 'empty' }, '아직 올린 공지가 없습니다. 공지는 학생이 수업 아틀리에에 들어오면 맨 위에 내용까지 바로 보입니다.'));
  const list = h('div', { class: 'stack' });
  for (const n of home.notices) {
    const del = h('button', { class: 'btn ghost small danger', type: 'button', onclick: async () => {
      if (!await confirmBox(`"${n.title}" 공지를 지울까요?`, '지우기', true)) return;
      await run(del, async () => { await api.deleteNotice(n.id); toast('공지를 지웠습니다'); await reload(); });
    } }, '지우기');
    list.append(h('article', { class: 'card notice stack' },
      h('div', { class: 'row between' }, h('h2', { class: 'ellipsis' }, n.title), n.pinned && h('span', { class: 'chip pin' }, '중요 · 맨 위 고정')),
      h('p', { class: 'muted' }, `${classNames(n.class_ids)} · ${fmtDate(n.created_at)}`), n.body && h('p', { class: 'pre' }, n.body),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost small', type: 'button', onclick: () => editNotice(n) }, '고치기'), del)));
  }
  view.append(list);
}
function editNotice(n) {
  dialog((panel, close) => {
    const title = h('input', { type: 'text', maxLength: 80, value: n?.title ?? '', placeholder: '예: 다음 주 준비물' });
    const body = h('textarea', { maxLength: 4000, value: n?.body ?? '' });
    const pinned = h('input', { type: 'checkbox', checked: !!n?.pinned });
    const picker = classPicker(n?.class_ids ?? []);
    const save = h('button', { class: 'btn', type: 'button', onclick: () => run(save, async () => {
      await api.saveNotice({ id: n?.id, title: title.value, body: body.value, pinned: pinned.checked, class_ids: picker.value() });
      toast(n ? '공지를 고쳤습니다' : '공지를 올렸습니다'); close(); await reload();
    }) }, n ? '저장' : '공지 올리기');
    panel.append(h('h2', null, n ? '공지 고치기' : '새 공지'), h('label', { class: 'f' }, '제목', title), h('label', { class: 'f' }, '내용', body), picker.el,
      h('label', { class: 'check' }, pinned, '중요 공지 (맨 위에 고정)'),
      h('div', { class: 'row end' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, '취소'), save));
  });
}

/* ── 드라이브 연결: 교사마다 자기 구글 계정으로 로그인해 자기 드라이브에 저장한다 ── */
function renderDrive(view) {
  const d = home.drive, result = h('p', { class: 'muted' });
  const connect = h('button', { class: d ? 'btn ghost' : 'btn', type: 'button', onclick: () => run(connect, async () => {
    const out = await api.connectDrive();              // 실제 서버에서는 여기서 구글 로그인 화면으로 넘어갔다가 돌아온다
    if (out?.demo) { toast('연습 모드: 구글 드라이브를 연결한 것으로 표시합니다'); await reload(); }
  }) }, d ? '다른 구글 계정으로 다시 연결' : '구글 계정으로 연결');
  const check = h('button', { class: 'btn ghost small', type: 'button', onclick: () => run(check, async () => {
    const out = await api.checkDrive();
    result.replaceChildren(`연결이 잘 되어 있습니다 (${out.email}).`);
  }) }, '연결 확인');
  const cut = h('button', { class: 'btn ghost danger', type: 'button', onclick: async () => {
    if (!await confirmBox('구글 드라이브 연결을 끊을까요?\n이미 올라온 파일은 선생님 드라이브에 그대로 남지만, 다시 연결하기 전까지 학생이 파일을 내거나 열 수 없습니다.', '연결 끊기', true)) return;
    await run(cut, async () => { await api.disconnectDrive(); toast('연결을 끊었습니다'); await reload(); });
  } }, '연결 끊기');

  view.append(h('h1', { style: 'margin-bottom:16px' }, '드라이브 연결'));
  if (d) {
    view.append(h('div', { class: 'card stack' },
      h('div', { class: 'row between' }, h('h2', null, '연결됨'), check),
      h('p', null, h('b', null, d.email || '구글 계정'), ' 의 드라이브에 저장하고 있습니다.'),
      h('p', null, h('a', { href: d.folder, target: '_blank', rel: 'noopener noreferrer' }, '드라이브의 "아틀리에" 폴더 열기 ↗')),
      h('p', { class: 'muted' }, '폴더는 "아틀리에 / 2026년도 / 2학기 / 과제 이름 / 반 / 번호 이름" 순서로 자동으로 만들어집니다. 드라이브에서 파일을 옮기거나 이름을 바꿔도 수업 아틀리에에서 열 수 있지만, 지우면 열 수 없게 됩니다.'),
      result, h('div', { class: 'row' }, connect, cut)));
  } else {
    view.append(h('div', { class: 'card stack' },
      h('h2', null, '아직 연결하지 않았습니다'),
      h('p', null, '학생이 낸 파일과 선생님이 올린 참고 자료는 선생님의 구글 드라이브에 저장됩니다. 선생님마다 자기 구글 계정으로 한 번만 연결하면 됩니다.'),
      h('ol', { class: 'steps' },
        h('li', null, '아래 버튼을 누르면 구글 로그인 화면이 열립니다. 파일을 모아 둘 구글 계정을 고릅니다.'),
        h('li', null, '"Google Drive 파일 보기 및 관리" 권한을 허용합니다. 수업 아틀리에는', h('b', null, '자기가 만든 파일만'), ' 다룰 수 있고, 선생님 드라이브의 다른 파일은 볼 수 없습니다.'),
        h('li', null, '이 화면으로 돌아오면 끝입니다. 드라이브에 "아틀리에" 폴더가 생깁니다.')),
      h('p', { class: 'muted' }, '"Google에서 확인하지 않은 앱"이라는 화면이 나오면 왼쪽 아래 "고급" → "이동"을 누르면 됩니다. 학교 계정에서 막혀 있으면 학교 관리자에게 허용을 요청하거나 개인 구글 계정으로 연결해 주세요.'),
      h('div', null, connect)));
  }

  if (d) {
    const mb = h('input', { type: 'number', min: 1, max: 2000, value: d.max_file_mb, style: 'width:110px' }), n = h('input', { type: 'number', min: 1, max: 20, value: d.max_files, style: 'width:110px' });
    const save = h('button', { class: 'btn ghost', type: 'button', onclick: () => run(save, async () => { await api.setLimits(+mb.value, +n.value); toast('한도를 저장했습니다'); await reload(); }) }, '한도 저장');
    view.append(h('h3', null, '한도 설정'), h('div', { class: 'card stack' },
      h('div', { class: 'row', style: 'align-items:flex-end' }, h('label', { class: 'f' }, '파일 하나의 크기 (MB)', mb), h('label', { class: 'f' }, '학생이 과제 하나에 낼 수 있는 파일 수', n), save),
      h('p', { class: 'muted' }, '파일은 학생 기기에서 구글 드라이브로 바로 올라가고, 큰 파일은 조각으로 나눠 보내 끊겨도 이어서 올립니다. 선생님 드라이브의 남은 용량도 함께 확인해 주세요.')));
  }
}

run(null, start);
window.__atelier = { api };        // 점검용
