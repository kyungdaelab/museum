// 훌륭한 실패 (프로세스 저널) 화면.  IB 학습자상 '도전하는 사람'에 바탕을 둔다.
//   학생: 첫 화면 맨 위의 카드 → AI 와 오늘 한 일을 이야기 → "오늘 기록 정리하기" → 양식에 맞춘 정리 + 선생님 피드백
//   교사: 대화 기준 · 양식 · AI 연결을 정하고, 학생마다 날짜별 정리와 실제 대화를 보고 피드백을 단다. 전체를 문서 하나로 내보낸다
import { JOURNAL_MODELS } from './api.js';
import { h, toast, run, dialog, confirmBox, fmtDate } from './ui.js';

export const JOURNAL_NAME = '훌륭한 실패';
const dayLabel = (d) => { const [y, m, dd] = String(d).split('-'); return `${+y}년 ${+m}월 ${+dd}일`; };
const shift = (day, n) => new Date(new Date(day + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);

/* ── 함께 쓰는 조각 ── */
const bubble = (m) => h('div', { class: 'bubble' + (m.role === 'user' ? ' me' : '') }, h('small', null, m.role === 'user' ? '나' : 'AI'), m.content);
const teacherBubble = (m) => h('div', { class: 'bubble' + (m.role === 'user' ? ' me' : '') }, h('small', null, m.role === 'user' ? '학생' : 'AI'), m.content);
const summaryBox = (summary) => h('div', { class: 'sum' }, summary.map((x) => h('div', null, h('b', null, x.label), h('span', { class: 'pre' }, x.text))));
const feedbackBox = (e) => e.feedback && h('div', { class: 'feedback' }, h('b', null, `선생님 피드백${e.feedback_at ? ' · ' + fmtDate(e.feedback_at) : ''}`), h('span', { class: 'pre' }, e.feedback));

/* ═════════════ 학생 ═════════════ */
// 첫 화면 맨 위의 카드.  nav.open(build) : 과제 목록 대신 다른 화면을 보여 준다,  nav.home() : 첫 화면으로
// 쓸 수 없는 상태(선생님이 꺼 둠, 아직 설치 전)면 null 을 돌려준다
export async function journalCard(api, nav) {
  let jn;
  try { jn = await api.journalHome(); } catch { return null; }
  if (!jn.shown && !jn.entries.length) return null;
  const today = jn.entries.find((e) => e.day === jn.today), last = jn.entries.find((e) => e.feedback), write = jn.mode === 'write';
  const state = !today ? null : today.summary ? h('span', { class: 'chip ok' }, '오늘 기록 완료') : h('span', { class: 'chip soon' }, '오늘 기록 쓰는 중');
  return h('article', { class: 'card journal stack' },
    h('div', { class: 'row between' }, h('div', null, h('p', { class: 'eyebrow' }, '프로세스 저널 · 도전하는 사람'), h('h2', null, JOURNAL_NAME)), state),
    h('p', null, '오늘 수업에서 생각대로 안 된 것, 그게 바로 ', h('b', null, '훌륭한 실패'), write ? '예요. 오늘 한 일을 돌아보며 적어 보세요.' : '예요. AI 와 이야기하며 오늘 한 일을 돌아보세요.'),
    last && h('div', { class: 'feedback' }, h('b', null, `선생님 피드백 · ${dayLabel(last.day)}`), h('span', { class: 'pre' }, last.feedback)),
    !jn.on && h('p', { class: 'warn', style: 'font-size:14px' }, jn.shown ? '선생님이 아직 AI 를 연결하지 않았어요. 지금은 지난 기록만 볼 수 있어요.' : '지금은 새 기록을 쓸 수 없어요. 지난 기록은 볼 수 있어요.'),
    h('div', { class: 'row' },
      jn.on && h('button', { class: 'btn', type: 'button', onclick: () => openDay(api, nav, jn, jn.today) }, write ? (today?.summary ? '오늘 기록 고쳐 쓰기' : '오늘의 기록 쓰기') : today ? (today.summary ? '오늘 기록 이어서 쓰기' : '이어서 이야기하기') : '오늘의 기록 시작하기'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => openHistory(api, nav) }, `지금까지 쓴 내 기록 보기${jn.entries.length ? ` (${jn.entries.length})` : ''}`)));
}

// 그날 기록 쓰기: 선생님이 고른 방식에 따라 AI 와 대화하거나, 양식에 직접 쓴다
const openDay = (api, nav, jn, day) => (jn.mode === 'write' ? openWrite : openChat)(api, nav, jn, day);
const dayHead = (api, nav, jn, day) => {
  const date = h('input', { type: 'date', value: day, min: shift(jn.today, -14), max: jn.today, onchange: () => { if (date.value && date.value !== day) openDay(api, nav, jn, date.value); } });
  return [h('button', { class: 'btn ghost small', type: 'button', onclick: () => nav.home() }, '← 첫 화면'),
    h('div', { style: 'margin:18px 0 6px' }, h('p', { class: 'eyebrow' }, '프로세스 저널 · 도전하는 사람'), h('h1', null, JOURNAL_NAME)),
    h('div', { class: 'row', style: 'margin-bottom:12px' }, h('label', { class: 'muted' }, '날짜 ', date), h('span', { class: 'muted' }, '지난 수업을 쓰려면 날짜를 바꾸세요 (2주 전까지)'))];
};

// 직접 쓰기 화면: 선생님이 정한 양식의 칸에 스스로 적고 저장한다 (AI 없음)
function openWrite(api, nav, jn, day) {
  nav.open(async (view) => {
    const entry = jn.entries.find((e) => e.day === day);
    const boxes = jn.fields.map((label) => h('textarea', { maxLength: 2000, value: entry?.summary?.find((x) => x.label === label)?.text ?? '', style: 'min-height:96px' }));
    const save = h('button', { class: 'btn', type: 'button', onclick: () => run(save, async () => {
      await api.journalWrite(day, boxes.map((b) => b.value));
      toast('기록을 저장했어요. 선생님이 볼 수 있어요'); nav.home();
    }) }, entry?.summary ? '고친 내용 저장' : '저장하기');
    view.append(...dayHead(api, nav, jn, day),
      h('p', { class: 'careful', style: 'margin-bottom:12px' }, '여기에 쓴 내용은 ', h('b', null, '선생님이 볼 수 있습니다.'), ' 잘된 것만 쓰지 않아도 돼요. 생각대로 안 된 것을 솔직하게 적어 보세요. 이름 · 연락처 같은 개인 정보는 적지 마세요.'),
      h('div', { class: 'card stack' }, jn.fields.map((label, i) => h('label', { class: 'f' }, label, boxes[i])), h('div', { class: 'row end', style: 'margin-top:4px' }, save)),
      entry?.feedback ? h('div', { style: 'margin-top:12px' }, feedbackBox(entry)) : null);
  });
}

// 대화 화면
function openChat(api, nav, jn, day) {
  nav.open(async (view) => {
    let entry = jn.entries.find((e) => e.day === day), messages = [], busy = false;
    if (entry) { entry = await api.journalEntry(entry.id); messages = entry.messages; }
    const chat = h('div', { class: 'chat', 'aria-live': 'polite' }), sumBox = h('div', { class: 'stack' });
    const input = h('textarea', { maxLength: 1000, placeholder: '오늘 수업에서 무엇을 했나요? 편하게 적어 보세요', rows: 2 });
    const draw = (waiting = false) => {
      chat.replaceChildren(h('div', { class: 'bubble' }, h('small', null, 'AI'), '안녕하세요! 오늘 수업에서 무엇을 했는지 편하게 이야기해 주세요.'), ...messages.map(bubble), ...(waiting ? [h('div', { class: 'bubble wait' }, '생각하는 중…')] : []));
      chat.scrollTop = chat.scrollHeight;
    };
    const drawSummary = () => sumBox.replaceChildren(...(entry?.summary ? [h('h3', null, '오늘의 정리'), h('div', { class: 'card stack' }, summaryBox(entry.summary), feedbackBox(entry))] : []));
    const send = h('button', { class: 'btn', type: 'button', onclick: () => say() }, '보내기');
    const finish = h('button', { class: 'btn ghost', type: 'button', onclick: () => run(finish, async () => {
      if (busy) return;
      finish.textContent = '정리하는 중…';
      try { const out = await api.journalFinish(day); entry = { ...(entry ?? {}), summary: out.summary }; drawSummary(); toast('오늘 기록을 정리했어요. 선생님이 볼 수 있어요'); sumBox.scrollIntoView({ behavior: 'smooth' }); }
      finally { finish.textContent = '오늘 기록 정리하기'; }
    }) }, '오늘 기록 정리하기');
    async function say() {
      const text = input.value.trim();
      if (!text || busy) return;
      busy = true; send.disabled = true; input.value = '';
      messages.push({ role: 'user', content: text }); draw(true);
      try { const out = await api.journalChat(day, text); messages.push({ role: 'assistant', content: out.reply }); }
      catch (e) { messages.pop(); input.value = text; toast(e?.message || '보내지 못했어요. 다시 해 주세요', 'error'); }
      busy = false; send.disabled = false; draw(); input.focus();
    }
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); say(); } });
    view.append(...dayHead(api, nav, jn, day),
      h('p', { class: 'careful', style: 'margin-bottom:12px' }, '대화 상대는 ', h('b', null, '사람이 아니라 AI'), '입니다. 틀릴 수도 있어요. 여기에 쓴 내용은 ', h('b', null, '선생님이 모두 볼 수 있습니다.'), ' 이름 · 연락처 같은 개인 정보는 적지 마세요.'),
      chat, h('div', { class: 'say' }, input, send),
      h('div', { class: 'row between', style: 'margin-top:12px' }, h('span', { class: 'muted' }, '이야기를 다 나눴으면 눌러 주세요. 다시 눌러 고칠 수 있어요.'), finish),
      sumBox);
    draw(); drawSummary();
  });
}

// 지금까지 쓴 기록
function openHistory(api, nav) {
  nav.open(async (view) => {
    const jn = await api.journalHome();
    view.append(h('button', { class: 'btn ghost small', type: 'button', onclick: () => nav.home() }, '← 첫 화면'),
      h('div', { style: 'margin:18px 0 16px' }, h('p', { class: 'eyebrow' }, JOURNAL_NAME), h('h1', null, '지금까지 쓴 내 기록')));
    if (!jn.entries.length) view.append(h('div', { class: 'empty' }, '아직 쓴 기록이 없어요.'));
    const list = h('div', { class: 'stack' });
    for (const e of jn.entries) {
      const talk = e.count > 0 && h('button', { class: 'btn ghost small', type: 'button', onclick: () => run(talk, async () => {
        const full = await api.journalEntry(e.id);
        dialog((panel, close) => panel.append(h('h2', null, `${dayLabel(e.day)} 대화`), h('div', { class: 'chat' }, full.messages.map(bubble)), h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, '닫기'))));
      }) }, `대화 보기 (${e.count}마디)`);
      const again = jn.on && e.day >= shift(jn.today, -14) && h('button', { class: 'btn ghost small', type: 'button', onclick: () => openDay(api, nav, jn, e.day) }, jn.mode === 'write' ? '고쳐 쓰기' : '이어서 쓰기');
      list.append(h('article', { class: 'card stack' },
        h('div', { class: 'row between' }, h('h2', null, dayLabel(e.day)), e.summary ? h('span', { class: 'chip ok' }, '정리 완료') : h('span', { class: 'chip soon' }, '아직 정리 안 함')),
        e.summary ? summaryBox(e.summary) : h('p', { class: 'muted' }, jn.mode === 'write' ? '아직 정리하지 않은 기록이에요.' : '"이어서 쓰기"에서 "오늘 기록 정리하기"를 누르면 여기에 정리가 채워져요.'),
        feedbackBox(e), h('div', { class: 'row' }, talk, again)));
    }
    view.append(list);
  });
}

/* ═════════════ 교사 ═════════════ */
export async function renderJournalTeacher(api, view) {
  const home = await api.journalTeacherHome(), conf = home.conf;
  const redraw = () => run(null, async () => { view.replaceChildren(); await renderJournalTeacher(api, view); });
  view.append(h('div', { style: 'margin-bottom:16px' }, h('p', { class: 'eyebrow' }, '프로세스 저널 · IB 학습자상 "도전하는 사람"'), h('h1', null, JOURNAL_NAME)),
    h('p', { class: 'muted', style: 'margin-bottom:16px' }, '학생이 수업 아틀리에에 들어오면 맨 위에 보입니다. 학생이 AI 와 대화하며 쓰게 할지, 양식에 직접 쓰게 할지 아래에서 고릅니다. 구글 드라이브를 연결해 두면 학생마다 날짜별 문서로 자동 저장됩니다.'));

  /* 쓰는 방식: 버튼을 누르면 바로 바뀐다 */
  const mode = conf.mode === 'write' ? 'write' : 'ai';
  const current = () => ({ enabled: conf.enabled, guide: conf.guide, fields: conf.fields, model: conf.model, daily_limit: conf.daily_limit });
  const modeBtn = (value, label) => { const b = h('button', { type: 'button', class: value === mode ? 'sel' : '', 'aria-pressed': String(value === mode), onclick: () => value !== mode && run(b, async () => {
    await api.journalSaveSettings({ ...current(), mode: value });
    if (((await api.journalTeacherHome()).conf.mode ?? 'ai') !== value) throw new Error('방식을 바꾸지 못했습니다. Supabase 에서 0016_journal_mode.sql 을 먼저 실행해 주세요');
    toast(value === 'write' ? '학생이 직접 쓰는 방식으로 바꿨습니다' : 'AI 와 대화하는 방식으로 바꿨습니다'); redraw();
  }) }, label); return b; };
  view.append(h('div', { class: 'card stack', style: 'margin-bottom:12px' },
    h('div', { class: 'row between', style: 'flex-wrap:wrap' }, h('h2', null, '쓰는 방식'), h('nav', { class: 'tabs', style: 'margin:0' }, modeBtn('ai', 'AI 와 대화하며 쓰기'), modeBtn('write', '학생이 직접 쓰기'))),
    h('p', { class: 'muted' }, mode === 'write'
      ? '지금은 학생이 양식의 칸에 스스로 적어 저장합니다. AI 를 쓰지 않아 요금이 들지 않고, 열쇠가 없어도 됩니다. 선생님 피드백은 똑같이 달 수 있습니다.'
      : '지금은 학생이 AI 와 이야기하고, AI 가 대화를 양식에 맞춰 정리합니다. 대화 내용이 모두 남습니다. (Claude API 요금이 듭니다)'),
    mode === 'ai' && !conf.has_key && h('p', { class: 'warn', style: 'font-size:14px' }, '아직 AI 를 연결하지 않아 학생이 새 기록을 쓸 수 없습니다. 아래 설정에서 열쇠를 넣거나 "학생이 직접 쓰기"로 바꿔 주세요.')));

  /* 설정 */
  const key = h('input', { type: 'password', autocomplete: 'off', placeholder: 'sk-ant-…' });
  const saveKey = h('button', { class: 'btn', type: 'button', onclick: () => run(saveKey, async () => { await api.journalSetKey(key.value); key.value = ''; toast('AI 를 연결했습니다'); redraw(); }) }, conf.has_key ? '열쇠 바꾸기' : 'AI 연결');
  const cutKey = conf.has_key && h('button', { class: 'btn ghost danger', type: 'button', onclick: async () => {
    if (!await confirmBox('AI 연결을 끊을까요?\n저장된 열쇠를 지웁니다. 지난 기록은 남지만, 다시 연결하기 전까지 학생이 새로 대화할 수 없습니다.', '연결 끊기', true)) return;
    await run(cutKey, async () => { await api.journalClearKey(); toast('AI 연결을 끊었습니다'); redraw(); });
  } }, '연결 끊기');
  const enabled = h('input', { type: 'checkbox', checked: conf.enabled });
  const model = h('select', null, JOURNAL_MODELS.map((m) => h('option', { value: m.id, selected: m.id === conf.model }, m.name)));
  const limit = h('input', { type: 'number', min: 5, max: 200, value: conf.daily_limit, style: 'width:110px' });
  const guide = h('textarea', { maxLength: 4000, value: conf.guide, placeholder: '예: 이번 단원은 "수채화 번지기"입니다. 재료를 어떻게 썼는지, 어떤 효과를 내려고 했는지 꼭 물어봐 주세요.\n예: 초등학교 4학년이니 쉬운 말로 물어봐 주세요.' });
  const fields = h('textarea', { value: conf.fields.join('\n'), style: 'min-height:130px' });
  const save = h('button', { class: 'btn', type: 'button', onclick: () => run(save, async () => {
    await api.journalSaveSettings({ mode, enabled: enabled.checked, guide: guide.value, fields: fields.value.split('\n'), model: model.value, daily_limit: +limit.value });
    toast('설정을 저장했습니다'); redraw();
  }) }, '설정 저장');
  view.append(h('details', { class: 'card', open: !conf.has_key && mode === 'ai' },
    h('summary', null, `설정 · ${conf.has_key ? 'AI 연결됨' : mode === 'ai' ? '먼저 AI 를 연결해 주세요' : 'AI 연결 안 함'}${conf.enabled ? '' : ' · 학생 화면에서 숨김'}`),
    h('div', { class: 'stack', style: 'margin-top:14px' },
      h('h2', null, 'AI 연결 (Claude)'),
      h('p', { class: 'muted' }, conf.has_key ? '열쇠가 저장되어 있습니다. 저장된 열쇠는 다시 보여 주지 않습니다.' : 'Claude Console(platform.claude.com)에서 만든 API 열쇠를 붙여 넣습니다. 열쇠는 서버에만 저장되고 학생에게도, 이 화면에도 다시 보이지 않습니다. 쓴 만큼 선생님의 Claude 계정에서 요금이 나갑니다.'),
      h('div', { class: 'row', style: 'align-items:flex-end' }, h('label', { class: 'f', style: 'flex:1;min-width:220px' }, conf.has_key ? '새 열쇠' : 'Claude API 열쇠', key), saveKey, cutKey),
      h('div', { class: 'row', style: 'align-items:flex-end' }, h('label', { class: 'f', style: 'flex:1;min-width:240px' }, 'AI 모델', model), h('label', { class: 'f' }, '학생 한 명이 하루에 보낼 수 있는 말', limit)),
      h('p', { class: 'muted' }, '하루 한도는 요금이 너무 많이 나가지 않게 막는 장치입니다. 학생이 한도에 닿으면 "오늘 기록 정리하기"로 마무리하도록 안내합니다.'),
      h('h2', { style: 'margin-top:8px' }, '대화 기준'),
      h('label', { class: 'f' }, 'AI 가 따를 기준 (비워 두어도 됩니다)', guide),
      h('label', { class: 'f' }, '정리 양식의 칸 (한 줄에 한 칸, 8칸까지)', fields),
      h('label', { class: 'check' }, enabled, '학생 화면에 "훌륭한 실패" 보이기'),
      h('div', { class: 'row end' }, save))));

  /* 학생 기록 */
  if (!home.classes.length) view.append(h('div', { class: 'empty', style: 'margin-top:16px' }, '아직 학급이 없습니다. 수업 공간의 선생님 화면("학급 · 학생")에서 명렬표를 먼저 넣어 주세요.'));
  for (const c of home.classes) {
    const wrote = c.students.filter((s) => s.entries).length, waiting = c.students.reduce((n, s) => n + s.waiting, 0);
    const rows = c.students.map((s) => h('tr', null, h('td', null, `${s.no}`), h('td', null, s.name),
      h('td', null, s.entries ? `${s.entries}일 · 최근 ${dayLabel(s.last_day)}` : h('span', { class: 'muted' }, '아직 없음')),
      h('td', null, s.waiting ? h('span', { class: 'chip soon' }, `피드백 전 ${s.waiting}`) : s.entries ? h('span', { class: 'chip ok' }, '모두 확인') : ''),
      h('td', null, s.entries ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => openStudent(api, view, s.id) }, '보기') : '')));
    view.append(h('h3', null, `${c.name} · 쓴 학생 ${wrote} / ${c.students.length}명${waiting ? ` · 피드백 전 기록 ${waiting}개` : ''}`),
      h('div', { class: 'card' }, c.students.length ? h('table', null, h('thead', null, h('tr', null, h('th', null, '번호'), h('th', null, '이름'), h('th', null, '기록'), h('th', null, '피드백'), h('th', null, ''))), h('tbody', null, rows)) : h('p', { class: 'muted' }, '이 반에는 가입한 학생이 없습니다.')));
  }
}

// 학생 한 명: 날짜별 정리 · 실제 대화 · 피드백 달기 · 전체 내보내기
async function openStudent(api, view, studentId) {
  await run(null, async () => {
    const data = await api.journalStudent(studentId), s = data.student;
    const back = () => run(null, async () => { view.replaceChildren(); await renderJournalTeacher(api, view); });
    const result = h('p', { class: 'muted' });
    const exportBtn = h('button', { class: 'btn', type: 'button', onclick: () => run(exportBtn, async () => {
      const out = await api.journalExport(studentId);
      const url = URL.createObjectURL(new Blob(['﻿', out.html], { type: 'application/msword' }));        // 워드 · 한글에서 열리는 문서 파일
      const a = h('a', { href: url, download: `${out.name}.doc` }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      result.replaceChildren('문서 파일을 내려받았습니다. ', out.link ? h('a', { href: out.link, target: '_blank', rel: 'noopener noreferrer' }, '구글 드라이브에 저장된 문서 열기 ↗') : '(구글 드라이브를 연결하면 드라이브에도 함께 저장됩니다)');
    }) }, '전체 기록 내보내기 (문서 파일)');
    view.replaceChildren(h('button', { class: 'btn ghost small', type: 'button', onclick: back }, `← ${JOURNAL_NAME}`),
      h('div', { class: 'row between', style: 'margin:18px 0 6px;flex-wrap:wrap' }, h('h1', null, `${s.no}번 ${s.name}`), exportBtn),
      h('p', { class: 'muted', style: 'margin-bottom:16px' }, `${s.class} · 기록 ${data.entries.length}일`), result);
    if (!data.entries.length) view.append(h('div', { class: 'empty' }, '아직 쓴 기록이 없습니다.'));
    for (const e of data.entries) {
      const fb = h('textarea', { maxLength: 2000, value: e.feedback, placeholder: '이 날의 기록에 피드백을 적어 주세요. 학생 화면에 바로 보입니다.', style: 'min-height:84px' });
      const state = h('span', { class: 'chip ' + (e.feedback ? 'ok' : 'soon') }, e.feedback ? '피드백 함' : '피드백 전');
      const saveFb = h('button', { class: 'btn small', type: 'button', onclick: () => run(saveFb, async () => {
        await api.journalFeedback(e.id, fb.value); e.feedback = fb.value.trim();
        state.className = 'chip ' + (e.feedback ? 'ok' : 'soon'); state.textContent = e.feedback ? '피드백 함' : '피드백 전';
        toast(e.feedback ? '피드백을 남겼습니다. 학생 화면에 바로 보입니다' : '피드백을 지웠습니다');
      }) }, '피드백 저장');
      view.append(h('article', { class: 'card stack', style: 'margin-bottom:12px' },
        h('div', { class: 'row between' }, h('h2', null, dayLabel(e.day)), state),
        e.summary ? summaryBox(e.summary) : h('p', { class: 'muted' }, '학생이 아직 "오늘 기록 정리하기"를 누르지 않았습니다. 아래에서 대화는 볼 수 있습니다.'),
        e.count > 0 && h('details', null, h('summary', null, `실제 대화 보기 (학생이 한 말 ${e.count}번)`), h('div', { class: 'chat', style: 'margin-top:10px' }, e.messages.map(teacherBubble))),
        h('label', { class: 'f' }, '선생님 피드백', fb), h('div', { class: 'row end', style: 'margin-top:0' }, saveFb)));
    }
    window.scrollTo(0, 0);
  });
}
