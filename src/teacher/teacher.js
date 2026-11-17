// 교사용 관리 화면: 로그인 → [내 전시실] [학급 · 학생] [관리자] 탭
import { createApi, parseRoster } from './api.js';
import { $, el, show, message, run, confirmBox, dialog, button, field, input } from './dom.js';
import { createRoomsUi } from './rooms-ui.js';
import { createArtworksUi } from './artworks-ui.js';
import { createAdminUi } from './admin-ui.js';

const siteUrl = location.origin + location.pathname.replace(/teacher\.html$/, '');
const api = await createApi();
let current = null;        // 지금 보고 있는 학급
show('demoBanner', api.mode === 'demo');

/* ── 탭 ── */
const TABS = ['rooms', 'classes', 'admin'];
let roomsUi = null, artUi = null, adminUi = null;
function openTab(name) {
  for (const t of TABS) { show(t + 'Tab', t === name); $('tab-' + t).classList.toggle('sel', t === name); }
  message('');
  if (name === 'rooms') showRoomList();
  if (name === 'classes') run(null, loadClasses);
  if (name === 'admin') run(null, () => adminUi.refresh());
}
for (const t of TABS) $('tab-' + t).addEventListener('click', () => openTab(t));
function showRoomList() { show('roomsView'); show('artView', false); run(null, () => roomsUi.refresh()); }
function manageRoom(room) { show('roomsView', false); show('artView'); run(null, () => artUi.open(room)); window.scrollTo(0, 0); }

/* ── 로그인 ── */
async function start() {
  const s = await api.session();
  show('loginView', !s); show('appView', !!s);
  if (!s) return;
  $('who').textContent = `${s.profile?.name || s.email} 선생님` + (s.profile?.role === 'admin' ? ' (관리자)' : '');
  const approved = !!s.profile?.approved, admin = s.profile?.role === 'admin';
  show('pending', !approved); show('tabs', approved); show('tab-admin', admin);
  if (!approved) { for (const t of TABS) show(t + 'Tab', false); return; }
  roomsUi ??= createRoomsUi({ api, onManage: manageRoom });
  artUi ??= createArtworksUi({ api, onBack: showRoomList });
  adminUi ??= createAdminUi({ api });
  openTab('rooms');
}
$('loginForm').addEventListener('submit', (e) => { e.preventDefault(); run($('loginBtn'), async () => { await api.signIn($('email').value.trim(), $('password').value); $('password').value = ''; await start(); }); });
$('signupBtn').addEventListener('click', () => run($('signupBtn'), async () => {
  const name = $('tName').value.trim(), school = $('tSchool').value.trim();
  if (!name || !$('email').value.trim() || $('password').value.length < 8) throw new Error('이름, 이메일, 8자 이상의 비밀번호를 적어 주세요');
  await api.signUp($('email').value.trim(), $('password').value, name, school);
  message('가입 신청이 접수되었습니다. 관리자가 승인하면 전시실을 만들 수 있습니다. (이메일 확인이 켜져 있으면 받은 메일의 링크를 먼저 눌러 주세요)');
  await start();
}));
for (const id of ['logout', 'logout2']) $(id).addEventListener('click', () => run(null, async () => { await api.signOut(); current = null; await start(); }));

/* ── 학급 ── */
async function loadClasses() {
  const list = await api.listClasses(), box = $('classList');
  box.replaceChildren();
  if (!list.length) box.append(el('p', 'muted', '아직 학급이 없습니다. 아래에서 만들어 주세요.'));
  for (const c of list) {
    const b = el('button', 'classCard' + (current?.id === c.id ? ' sel' : '')); b.type = 'button';
    b.append(el('b', null, `${c.school} ${c.name}`), el('span', 'code', c.code), el('span', 'muted', `학생 ${c.count}명`));
    b.addEventListener('click', () => run(null, () => openClass(c)));
    box.append(b);
  }
}
$('classForm').addEventListener('submit', (e) => { e.preventDefault(); run($('classBtn'), async () => {
  const school = $('cSchool').value.trim(), grade = +$('cGrade').value, no = +$('cNo').value;
  if (!school || !(grade >= 1 && grade <= 12) || !(no >= 1 && no <= 40)) throw new Error('학교 이름, 학년(1~12), 반(1~40)을 적어 주세요');
  const c = await api.createClass(school, grade, no);
  message(`학급을 만들었습니다. 학급 코드: ${c.code}`);
  await openClass({ ...c, count: 0 });
}); });

async function openClass(c) {
  current = c; show('classDetail'); show('cards', false);
  $('classTitle').textContent = `${c.school} ${c.name}`; $('classCode').textContent = c.code;
  await loadClasses(); await loadStudents();
}
async function loadStudents() {
  const list = await api.listStudents(current.id), body = $('studentRows');
  body.replaceChildren();
  $('studentCount').textContent = `${list.length}명`;
  show('noStudents', !list.length);
  for (const s of list) {
    const tr = el('tr');
    const locked = s.lockedUntil && new Date(s.lockedUntil) > new Date();
    const reissue = el('button', 'small', '비밀번호 초기화'), remove = el('button', 'small danger', '삭제');
    reissue.type = remove.type = 'button';
    reissue.addEventListener('click', async () => {
      // 새 비밀번호를 선생님이 정한다 (학생이 쓰던 비밀번호는 선생님도 볼 수 없다)
      const pw = await dialog((panel, close) => {
        const box = input('text', '1234', { maxLength: 20, autocomplete: 'off' }), row = el('div', 'row end');
        row.append(button('취소', 'light', () => close(null)), button('초기화', '', () => close(box.value.trim() || '1234')));
        panel.append(el('h2', null, '비밀번호 초기화'), el('p', 'pre', `${s.no}번 ${s.name} 학생의 비밀번호를 아래 값으로 바꿉니다.\n쓰던 비밀번호는 더 이상 쓸 수 없고, 잠겨 있었다면 함께 풀립니다.\n학생이 로그인하면 스스로 다시 바꾸도록 안내가 나옵니다.`), field('새 비밀번호 (빈칸 없이 4~20자)', box), row);
        box.select();
      });
      if (!pw) return;
      await run(reissue, async () => {
        const card = await api.reissuePin(s.id, pw);
        renderCards([card], `${s.no}번 ${s.name} 의 비밀번호를 초기화했습니다.`); await loadStudents();
      });
    });
    remove.addEventListener('click', async () => {
      if (!await confirmBox(`${s.no}번 ${s.name} 학생을 삭제할까요?\n계정과 캐릭터가 함께 지워지고 되돌릴 수 없습니다.`, '삭제')) return;
      await run(remove, async () => { await api.removeStudent(s.id); await loadStudents(); await loadClasses(); });
    });
    const act = el('td'); act.append(reissue, remove);
    tr.append(el('td', null, s.no), el('td', null, s.name), el('td', 'muted', s.nickname || '(아직 없음)'), el('td', locked ? 'warn' : 'muted', locked ? '잠김 (여러 번 틀림)' : s.mustChange ? '처음 비밀번호 사용 중' : '비밀번호 바꿈'), act);
    body.append(tr);
  }
}

/* ── 명단 등록 ── */
$('rosterFile').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { $('roster').value = await f.text(); preview(); } });
$('roster').addEventListener('input', preview);
function preview() {
  const { rows, errors } = parseRoster($('roster').value);
  $('rosterInfo').textContent = rows.length ? `${rows.length}명을 등록합니다: ${rows.slice(0, 6).map((r) => `${r.no}번 ${r.name}`).join(', ')}${rows.length > 6 ? ' …' : ''}` : '';
  $('rosterErrors').textContent = errors.join('\n');
  return { rows, errors };
}
$('rosterBtn').addEventListener('click', () => run($('rosterBtn'), async () => {
  const { rows, errors } = preview();
  if (errors.length) throw new Error('명단에 고칠 곳이 있습니다. 아래 빨간 글을 확인해 주세요');
  if (!rows.length) throw new Error('등록할 학생이 없습니다');
  const res = await api.addStudents(current.id, rows, $('rosterPw').value.trim() || '1234');
  $('roster').value = ''; preview();
  renderCards(res.cards, `${res.cards.length}명을 등록했습니다.` + (res.failed?.length ? ` 등록하지 못한 번호: ${res.failed.join(', ')}` : ''));
  await loadStudents(); await loadClasses();
}));

/* ── 로그인 카드 ── */
function renderCards(cards, note) {
  const box = $('cardGrid'); box.replaceChildren();
  for (const c of cards) {
    const card = el('div', 'card');
    card.append(el('div', 'cTop', `${current.school} ${current.name} (학급 코드 ${current.code})`), el('div', 'cName', `${c.no}번  ${c.name}`));
    const rows = el('dl');
    // 학번 = 학년 + 반(두 자리) + 번호(두 자리). 학생은 학번과 PIN 만 적고 들어온다
    const studentCode = c.code ?? `${current.grade}${String(current.class_no).padStart(2, '0')}${String(c.no).padStart(2, '0')}`;
    for (const [k, v] of [['학번', studentCode], ['처음 비밀번호', c.pin]]) rows.append(el('dt', null, k), el('dd', k === '학번' ? null : 'pin', v));
    card.append(rows, el('div', 'cUrl', siteUrl), el('div', 'cTip', '로그인하면 비밀번호를 나만 아는 것으로 바꿔요 · 별명은 직접 정해요'));
    box.append(card);
  }
  $('cardNote').textContent = note + ' 학생이 로그인하면 비밀번호를 스스로 바꾸도록 안내가 나옵니다. 잊어버리면 학생 표의 "비밀번호 초기화"를 누르세요.';
  show('cards'); $('cards').scrollIntoView({ block: 'start' });
}
$('printBtn').addEventListener('click', () => window.print());
$('closeCards').addEventListener('click', () => show('cards', false));

/* ── 학년말 일괄 삭제 ── */
$('deleteClassBtn').addEventListener('click', () => {
  $('deleteCode').value = ''; $('deleteHint').textContent = `확인을 위해 학급 코드 ${current.code} 를 그대로 입력해 주세요.`;
  show('deleteBox');
});
$('deleteCancel').addEventListener('click', () => show('deleteBox', false));
$('deleteConfirm').addEventListener('click', () => run($('deleteConfirm'), async () => {
  const res = await api.deleteClass(current.id, $('deleteCode').value.trim());
  show('deleteBox', false); show('classDetail', false); show('cards', false);
  message(`학급과 학생 ${res.deleted}명의 계정 · 캐릭터를 모두 삭제했습니다.`);
  current = null; await loadClasses();
}));

run(null, start);
window.__teacher = { api };        // 점검용
