// 교사용 관리 화면: 로그인 → [내 전시실] [학급 · 학생] [관리자] 탭
import { createApi, parseRoster, ITEM_LIST } from './api.js';
import { MEDAL_SHAPES, SHAPE_KEYS, METALS } from '../character/medal-shapes.js';
import { GIFT_KINDS, GIFT_KEYS, EFFECTS, newGift, giftSvg } from '../character/gift-kinds.js';
import { downloadTemplate, fileToText } from './excel.js';
import { $, el, show, message, run, confirmBox, dialog, button, field, input } from './dom.js';
import { createRoomsUi } from './rooms-ui.js';
import { createArtworksUi } from './artworks-ui.js';
import { createAdminUi } from './admin-ui.js';

const siteUrl = location.origin + location.pathname.replace(/teacher\.html$/, '');
const api = await createApi();
let current = null;        // 지금 보고 있는 학급
let myMedals = [];         // 내가 만든 훈장
show('demoBanner', api.mode === 'demo');

/* ── 탭 ── */
const TABS = ['rooms', 'classes', 'admin'];
let roomsUi = null, artUi = null, adminUi = null;
function openTab(name) {
  for (const t of TABS) { show(t + 'Tab', t === name); $('tab-' + t).classList.toggle('sel', t === name); }
  message('');
  if (name === 'rooms') showRoomList();
  if (name === 'classes') run(null, async () => { await loadMedals(); await loadClasses(); if (current) await loadStudents(); });
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
  const [list, owned, medalsOf] = await Promise.all([api.listStudents(current.id), api.listItems(current.id).catch(() => ({})), api.listStudentMedals(current.id).catch(() => ({}))]), body = $('studentRows');
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
    // 선물 아이템: 가진 것을 아이콘으로 보여 주고, '선물' 버튼으로 주거나 거둔다
    const mine = owned[s.id] ?? [], gift = el('button', 'small', '🎁 선물');
    gift.type = 'button';
    const got = (medalsOf[s.id] ?? []).map((mid) => myMedals.find((m) => m.id === mid)).filter(Boolean);       // 내가 만든 훈장 중 이 학생이 받은 것
    gift.addEventListener('click', async () => { await giftDialog(s, mine, got.map((m) => m.id)); await loadStudents(); });
    const icons = el('td', 'gifts');
    for (const m of got) icons.append(svgEl(m));
    icons.append(ITEM_LIST.filter((i) => mine.includes(i.id)).map((i) => i.icon).join(' ') || (got.length ? '' : '–'));
    icons.title = [...got.map((m) => m.name), ...ITEM_LIST.filter((i) => mine.includes(i.id)).map((i) => i.name)].join(', ');
    const act = el('td'); act.append(gift, reissue, remove);
    tr.append(el('td', null, s.no), el('td', null, s.name), el('td', 'muted', s.nickname || '(아직 없음)'), icons, el('td', locked ? 'warn' : 'muted', locked ? '잠김 (여러 번 틀림)' : s.mustChange ? '처음 비밀번호 사용 중' : '비밀번호 바꿈'), act);
    body.append(tr);
  }
}

/* ── 선물 만들기: 훈장과 꾸미기 아이템 ── */
const svgEl = (gift) => { const s = el('span'); s.innerHTML = giftSvg(gift); return s.firstChild; };
async function loadMedals() {
  myMedals = await api.listMedals().catch(() => []);
  const box = $('medalList'); box.replaceChildren();
  if (!myMedals.length) box.append(el('p', 'muted', '아직 만든 선물이 없습니다. 아래 버튼으로 훈장이나 날개 같은 아이템을 만들어 보세요.'));
  for (const m of myMedals) {
    const card = el('div', 'medalCard'), name = el('b', null, m.name), kind = GIFT_KINDS[m.kind ?? 'medal'] ?? GIFT_KINDS.medal; name.style.color = m.name_color;
    card.append(svgEl(m), name, el('span', 'muted', kind.label), button('수정', 'small light', async () => { if (await medalDialog(m)) { await loadMedals(); if (current) await loadStudents(); } }),
      button('삭제', 'small danger', async (b) => {
        if (!await confirmBox(`'${m.name}'을(를) 삭제할까요?\n이 선물을 받은 학생에게서도 모두 사라집니다.`, '삭제')) return;
        await run(b, async () => { await api.deleteMedal(m.id); await loadMedals(); if (current) await loadStudents(); });
      }));
    box.append(card);
  }
}
$('medalNew').addEventListener('click', async () => { if (await medalDialog(null)) await loadMedals(); });

// 선물 하나를 만들거나 고치는 창: 종류 → 이름 · (훈장이면 모양) · 색 · 효과 · 이름 글자 색. 왼쪽에 바로 미리보기
function medalDialog(existing) {
  const d = { ...newGift('medal'), ...(existing ?? {}) };
  return dialog((panel, close) => {
    const preview = el('div', 'medalPreview'), pName = el('b'), pKind = el('span', 'pKind'), err = el('p', 'wizErr'), form = el('div');
    const redraw = () => {
      const k = GIFT_KINDS[d.kind];
      pName.textContent = d.name || '이름'; pName.style.color = d.name_color; pKind.textContent = `${k.label} · ${d.kind === 'medal' ? '가슴과 별명 옆' : k.desc}`;
      const art = svgEl(d); art.classList.toggle('fxSparkle', d.kind !== 'medal' && d.effect === 'sparkle'); art.classList.toggle('fxBlink', d.kind !== 'medal' && d.effect === 'blink');
      preview.replaceChildren(art, pName, pKind);
    };
    // 색 고르기: 자주 쓰는 색 동그라미 + 직접 고르기
    const colorRow = (key, choices) => {
      const row = el('div', 'swatchRow'), custom = input('color', d[key]);
      const mark = () => { for (const x of row.querySelectorAll('.swatchBtn')) x.classList.toggle('sel', x.dataset.color.toLowerCase() === d[key].toLowerCase()); custom.value = d[key]; };
      for (const c of choices) { const b = el('button', 'swatchBtn'); b.type = 'button'; b.dataset.color = c; b.style.background = c; b.addEventListener('click', () => { d[key] = c; mark(); redraw(); }); row.append(b); }
      custom.addEventListener('input', () => { d[key] = custom.value; mark(); redraw(); });
      row.append(custom); mark(); return row;
    };
    const PALETTE = ['#ffd35a', '#ffffff', '#e5484d', '#f06292', '#8e6bd6', '#3d7be0', '#4caf7a', '#e2893d', '#2b2b2b'];
    const name = input('text', d.name, { maxLength: 20, placeholder: '예: 색채의 마법사, 천사 날개' });
    name.addEventListener('input', () => { d.name = name.value; redraw(); });

    function drawForm() {
      const k = GIFT_KINDS[d.kind];
      // ① 종류
      const kinds = el('div', 'kindRow');
      for (const key of GIFT_KEYS) {
        const b = el('button', 'kindBtn' + (d.kind === key ? ' sel' : '')); b.type = 'button'; b.title = GIFT_KINDS[key].desc;
        b.append(el('i', null, GIFT_KINDS[key].icon), el('span', null, GIFT_KINDS[key].label));
        b.addEventListener('click', () => {          // 종류를 바꾸면 색을 그 종류의 기본 색으로
          if (d.kind === key) return;
          d.kind = key; [d.metal, d.ribbon] = GIFT_KINDS[key].colors; drawForm(); redraw();
        });
        kinds.append(b);
      }
      form.replaceChildren(el('p', 'muted', '종류'), kinds, field('이름 (20자까지)', name, 'f wide'));
      // ② 훈장이면 모양
      if (d.kind === 'medal') {
        const shapes = el('div', 'shapeRow');
        for (const key of SHAPE_KEYS) {
          const b = el('button', 'shapeBtn' + (d.shape === key ? ' sel' : '')); b.type = 'button'; b.title = MEDAL_SHAPES[key].label;
          b.append(svgEl({ kind: 'medal', shape: key, metal: '#d9c08a', ribbon: '#b9b09c' }));
          b.addEventListener('click', () => { d.shape = key; for (const x of shapes.children) x.classList.toggle('sel', x === b); redraw(); });
          shapes.append(b);
        }
        form.append(el('p', 'muted', '모양'), shapes);
      }
      // ③ 색 (종류마다 칸 이름이 다르다. 별가루는 색이 없다)
      if (k.c1) form.append(el('p', 'muted', k.c1), colorRow('metal', d.kind === 'medal' ? Object.keys(METALS) : PALETTE));
      if (k.c2) form.append(el('p', 'muted', k.c2), colorRow('ribbon', d.kind === 'medal' ? ['#c8372d', '#27406e', '#2f7a3a', '#8e6bd6', '#e2893d', '#2b2b2b'] : PALETTE));
      // ④ 효과 (아이템만. 훈장과 별가루는 늘 반짝인다)
      if (d.kind !== 'medal' && d.kind !== 'star') {
        const fx = el('div', 'kindRow');
        for (const [key, label] of Object.entries(EFFECTS)) {
          const b = el('button', 'fxBtn' + (d.effect === key ? ' sel' : ''), label); b.type = 'button';
          b.addEventListener('click', () => { d.effect = key; for (const x of fx.children) x.classList.toggle('sel', x === b); redraw(); });
          fx.append(b);
        }
        form.append(el('p', 'muted', '효과'), fx);
      }
      form.append(el('p', 'muted', '이름 글자 색 (학생 화면에서 선물 이름이 이 색으로 보입니다)'), colorRow('name_color', ['#b8860b', '#c0392b', '#2a5fc0', '#2f7a3a', '#8e44ad', '#d35400', '#2b2b2b']));
    }

    const body = el('div', 'medalEdit'); body.append(preview, form);
    const row = el('div', 'row end'), save = button(existing ? '저장' : '만들기', '', async () => {
      if (!d.name.trim()) { err.textContent = '이름을 적어 주세요'; return; }
      save.disabled = true; err.textContent = '';
      try { await api.saveMedal({ ...d, name: d.name.trim() }); close(true); message(existing ? '고쳤습니다.' : `'${d.name.trim()}'을(를) 만들었습니다. 학생 표의 🎁 선물 버튼으로 학생에게 주세요.`); }
      catch (e) { err.textContent = e.message || '저장하지 못했습니다'; save.disabled = false; }
    });
    row.append(button('취소', 'light', () => close(false)), save);
    panel.append(el('h2', null, existing ? '선물 고치기' : '새 선물 만들기'), body, err, row);
    drawForm(); redraw();
  }, { wide: true }).then((v) => v === true);
}

/* ── 선물 주기 ── */
// 누르면 바로 주거나 거둔다. 학생이 다음에 로그인하면 캐릭터에 붙어 있다
function giftDialog(s, mine, mineMedals = []) {
  const has = new Set(mine), hasMedal = new Set(mineMedals);
  return dialog((panel, close) => {
    const grid = el('div', 'giftGrid'), note = el('p', 'muted'), medalGrid = el('div', 'giftGrid');
    for (const m of myMedals) {
      const b = el('button', 'giftCard' + (hasMedal.has(m.id) ? ' sel' : '')); b.type = 'button';
      const name = el('b', null, m.name), state = el('em', null, hasMedal.has(m.id) ? '준 선물 · 누르면 거두기' : '누르면 주기'); name.style.color = m.name_color;
      b.append(svgEl(m), name, el('span', 'muted', (GIFT_KINDS[m.kind ?? 'medal'] ?? GIFT_KINDS.medal).label), state);
      b.addEventListener('click', async () => {
        const on = !hasMedal.has(m.id); b.disabled = true; note.textContent = '';
        try {
          await api.setStudentMedal(s.id, m.id, on);
          if (on) hasMedal.add(m.id); else hasMedal.delete(m.id);
          b.classList.toggle('sel', on); state.textContent = on ? '준 선물 · 누르면 거두기' : '누르면 주기';
          note.textContent = on ? `'${m.name}'을(를) 주었습니다.` : `'${m.name}'을(를) 거두었습니다.`;
        } catch (e) { note.textContent = e.message || '바꾸지 못했습니다'; }
        b.disabled = false;
      });
      medalGrid.append(b);
    }
    panel.append(el('h2', null, `${s.no}번 ${s.name} 에게 선물 주기`),
      myMedals.length ? medalGrid : el('p', 'muted', '아직 만든 선물이 없습니다. 위쪽 "선물 만들기"에서 훈장이나 아이템을 먼저 만들어 주세요.'));
    // 예전 방식으로 준 기본 아이템이 남아 있으면 거둘 수 있게 보여 준다
    for (const item of ITEM_LIST.filter((i) => has.has(i.id))) {
      const b = el('button', 'giftCard sel'); b.type = 'button';
      b.append(el('i', null, item.icon), el('b', null, item.name), el('span', 'muted', '예전 기본 아이템'), el('em', null, '누르면 거두기'));
      b.addEventListener('click', async () => { b.disabled = true; try { await api.setItem(s.id, item.id, false); b.remove(); note.textContent = `${item.name}을(를) 거두었습니다.`; } catch (e) { note.textContent = e.message || '바꾸지 못했습니다'; b.disabled = false; } });
      grid.append(b);
    }
    const row = el('div', 'row end'); row.append(button('닫기', '', () => close(true)));
    panel.append(grid, el('p', 'muted', '훈장은 가슴(3개까지)과 별명 옆(5개까지)에, 아이템은 캐릭터 몸에 붙습니다(종류마다 하나씩, 6개까지). 학생이 다음에 로그인(또는 새로고침)하면 보이고, 학생이 스스로 만들거나 뗄 수는 없습니다.'), note, row);
  }, { wide: true });
}

/* ── 명단 등록 ── */
// 명단 파일 올리기: 엑셀(.xlsx · .xls)과 CSV · TXT 모두 받는다. 읽은 내용은 아래 칸에 들어가므로 등록 전에 확인 · 수정할 수 있다
$('rosterFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) run(null, async () => {
  try { $('roster').value = await fileToText(f); } catch { throw new Error('파일을 읽지 못했습니다. 엑셀(.xlsx) 또는 CSV 파일인지 확인해 주세요'); }
  const { rows } = preview();
  if (!rows.length) message('파일에서 학생을 찾지 못했습니다. 첫 칸에 번호, 둘째 칸에 이름이 있는지 확인해 주세요', 'error');
}); });
$('rosterTemplate').addEventListener('click', () => run($('rosterTemplate'), async () => {
  await downloadTemplate('학생명단-양식.xlsx', ['번호', '이름'], [[1, '김하늘'], [2, '이도윤'], [3, '박서연']], [8, 16]);
  message('양식을 내려받았습니다. 예시 세 줄을 지우고 우리 반 명단을 적은 뒤 "엑셀 · CSV 파일 선택"으로 올려 주세요.');
}));
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
    // 학번 = 학년 + 반 + 번호(두 자리). 예: 2학년 3반 12번 → 2312. 학생은 학번과 비밀번호만 적고 들어온다
    const studentCode = `${current.grade}${current.class_no}${String(c.no).padStart(2, '0')}`;
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
