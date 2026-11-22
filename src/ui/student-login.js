// 미술관 안에서의 계정 표시. 로그인 자체는 '수업 공간'(포털)에서 구글로 한다.
//   게스트            : 아무것도 보이지 않는다 (별명만 정하고 관람). 나가는 길은 '처음 화면'(미술관 정문)뿐
//   학생 · 교사(로그인): 로비에 [← 수업 공간] 과 [별명 · 로그아웃] 이 보이고, 정문에도 수업 공간으로 가는 버튼이 생긴다
import { backendEnabled } from '../data/backend.js';
import { logoutStudent, currentAccount, rememberStudent } from '../data/student-auth.js';
import { PORTAL_URL } from '../data/portal.js';

const $ = (id) => document.getElementById(id);

// onChange(student | null, resumed) : 학생으로 로그인된 채 접속했을 때(resumed = true), 로그아웃했을 때(null)
export function createStudentLogin({ onChange }) {
  const btn = $('lobbyLogin');
  let student = null;
  if (!backendEnabled()) return { get student() { return null; }, setNickname() {} };

  // 화면에는 학번이나 이름이 아니라 별명만 보인다 (아직 별명이 없으면 '학생')
  const render = (label = null) => {
    const text = student ? `${student.nickname || '학생'} · 로그아웃` : label;
    btn.classList.toggle('hidden', !text);
    if (text) btn.textContent = text;
  };
  const showPortalLinks = (who) => {
    for (const id of ['lobbyPortal', 'gateTeacher']) { const a = $(id); if (a) { a.href = PORTAL_URL; a.classList.remove('hidden'); } }
    const title = $('gateEnterTitle'), hint = $('gateEnterHint');
    if (title) { title.textContent = `${who}(으)로 들어가기`; hint.textContent = '내 캐릭터로 전시실에 들어가요'; }
  };
  const hidePortalLinks = () => {
    for (const id of ['lobbyPortal', 'gateTeacher']) $(id)?.classList.add('hidden');
    const title = $('gateEnterTitle'), hint = $('gateEnterHint');
    if (title) { title.textContent = '관람객으로 들어가기'; hint.textContent = '별명을 정하고 전시실을 둘러봐요'; }
  };

  btn.addEventListener('click', async () => {
    await logoutStudent();
    const wasStudent = !!student; student = null; render(); hidePortalLinks();
    if (wasStudent) onChange(null);
  });

  // 이미 로그인된 채로 접속한 경우
  currentAccount().then((a) => {
    if (a.kind === 'student') { student = { id: a.id, nickname: a.nickname }; render(); showPortalLinks(a.nickname || '학생'); onChange(student, true); }
    else if (a.kind === 'teacher') { render('선생님 · 로그아웃'); showPortalLinks(`${a.name || ''} 선생님`.trim()); }
  }).catch(() => {});

  return {
    get student() { return student; },
    // 캐릭터 꾸미기에서 별명을 바꾸면 버튼의 별명도 바로 바꾼다
    setNickname(name) { if (student && name) { student.nickname = name; rememberStudent(); render(); } },
  };
}
