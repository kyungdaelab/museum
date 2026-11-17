// 학생 로그인 창과 비밀번호 바꾸기 창 (전시실 목록 화면의 '학생 로그인' 버튼)
import { backendEnabled } from '../data/backend.js';
import { loginStudent, logoutStudent, currentStudent, changeStudentPassword, rememberStudent } from '../data/student-auth.js';

const $ = (id) => document.getElementById(id);

// 로그인을 요구하는 창은 어디에서도 띄우지 않는다. 이 버튼을 직접 눌렀을 때만 창이 열린다.
// onChange(student | null, resumed) : 로그인 · 로그아웃했을 때. resumed = 이미 로그인된 채로 접속한 경우
export function createStudentLogin({ onChange }) {
  const btn = $('lobbyLogin'), pwBtn = $('lobbyPw'), box = $('loginBox'), msg = $('loginMsg'), pwBox = $('pwBox'), pwMsg = $('pwMsg');
  let student = null;
  // 서버에 연결되어 있을 때만 버튼을 보인다 (주소에 ?login 을 붙이면 연결 전에도 창 모양을 볼 수 있음)
  if (!backendEnabled() && !new URLSearchParams(location.search).has('login')) return { get student() { return null; }, setNickname() {} };
  btn.classList.remove('hidden');

  // 화면에는 학번이나 이름이 아니라 별명만 보인다 (아직 별명이 없으면 '학생')
  const render = () => {
    btn.textContent = student ? `${student.nickname || '학생'} · 로그아웃` : '학생 로그인';
    pwBtn.classList.toggle('hidden', !student);
  };
  const close = () => { box.classList.add('hidden'); $('loginPin').value = ''; msg.textContent = ''; };
  btn.addEventListener('click', async () => {
    if (!student) { box.classList.remove('hidden'); $('loginCode').focus(); return; }
    await logoutStudent(); student = null; render(); onChange(null);
  });
  $('loginCancel').addEventListener('click', close);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('loginCode').value.replace(/\s/g, ''), pin = $('loginPin').value.trim(), classCode = $('loginClass').value.trim();
    if (!/^\d{4,6}$/.test(code) || pin.length < 4) { msg.textContent = '학번(숫자)과 비밀번호를 적어 주세요'; return; }
    $('loginSubmit').disabled = true; msg.textContent = '확인하는 중…';
    const res = await loginStudent(code, pin, classCode);
    $('loginSubmit').disabled = false;
    if (res.needClass) { $('loginClassRow').classList.remove('hidden'); $('loginClass').focus(); }      // 같은 학번이 다른 학급에도 있을 때만 학급 코드를 묻는다
    if (res.error) { msg.textContent = res.error; if (!res.needClass) $('loginPin').value = ''; return; }
    student = res.student; close(); render(); onChange(student, false);       // false = 방금 로그인함
    // 선생님이 정해 준 비밀번호를 아직 쓰고 있으면 바꾸라고 알려 준다 ('나중에'를 누르면 그냥 넘어감)
    if (student.must_change) openPw('선생님이 정해 준 비밀번호예요. 나만 아는 비밀번호로 바꿔 주세요. (빈칸 없이 4~20자)', pin);
  });

  /* ── 비밀번호 바꾸기 ── */
  const closePw = () => { pwBox.classList.add('hidden'); for (const id of ['pwCurrent', 'pwNext', 'pwAgain']) $(id).value = ''; pwMsg.textContent = ''; };
  function openPw(hint, current = '') {
    $('pwHint').textContent = hint; pwBox.classList.remove('hidden');
    $('pwCurrent').value = current; (current ? $('pwNext') : $('pwCurrent')).focus();
  }
  pwBtn.addEventListener('click', () => openPw('나만 아는 비밀번호로 바꿔요. (빈칸 없이 4~20자)'));
  $('pwCancel').addEventListener('click', closePw);
  pwBox.addEventListener('click', (e) => { if (e.target === pwBox) closePw(); });
  $('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const current = $('pwCurrent').value, next = $('pwNext').value, again = $('pwAgain').value;
    if (!/^\S{4,20}$/.test(next)) { pwMsg.textContent = '새 비밀번호는 빈칸 없이 4~20자로 정해 주세요'; return; }
    if (next !== again) { pwMsg.textContent = '새 비밀번호 두 칸이 서로 달라요'; return; }
    if (next === current) { pwMsg.textContent = '지금 비밀번호와 다른 것으로 정해 주세요'; return; }
    $('pwSubmit').disabled = true; pwMsg.textContent = '바꾸는 중…';
    const res = await changeStudentPassword(current, next);
    $('pwSubmit').disabled = false;
    if (res.error) { pwMsg.textContent = res.error; return; }
    if (student) student.must_change = false;
    closePw(); pwBtn.textContent = '비밀번호를 바꿨어요 ✓'; setTimeout(() => { pwBtn.textContent = '비밀번호 바꾸기'; }, 2500);
  });

  // 이미 로그인된 채로 접속한 경우 (true = 이어서 접속)
  currentStudent().then((s) => { student = s; render(); if (s) onChange(s, true); }).catch(() => {});
  render();
  return {
    get student() { return student; },
    // 캐릭터 꾸미기에서 별명을 바꾸면 버튼의 별명도 바로 바꾼다
    setNickname(name) { if (student && name) { student.nickname = name; rememberStudent(student); render(); } },
  };
}
