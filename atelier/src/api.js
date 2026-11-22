// 아틀리에 화면이 쓰는 기능 모음.
//   Supabase 설정이 있으면(가상미술관의 src/data/backend.js) → 실제 서버 (DB 함수 at_… + 선생님의 구글 드라이브)
//   없거나 주소에 ?demo 가 붙으면 → 연습 모드: 브라우저 안에서만 흉내 낸다 (저장되지 않고, 새로고침하면 처음으로 돌아감)
// 학생 · 교사 계정은 가상미술관과 같은 것을 쓴다.
import { backendEnabled, getClient } from '../../src/data/backend.js';
import { currentAccount, signInWithGoogle, signOut } from '../../src/data/student-auth.js';
import { callDrive, callFn, uploadFile, downloadFile } from './drive.js';

// 훌륭한 실패(프로세스 저널)의 기본 양식 (DB 의 jn_conf 와 같은 값)
export const JOURNAL_FIELDS = ['오늘 한 일', '시도해 본 것', '잘 안 된 것 (훌륭한 실패)', '다음에 해 볼 것'];
export const JOURNAL_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 — 가장 똑똑함 (기본)' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 — 균형 (Opus 의 절반 값)' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5 — 가장 빠르고 쌈' },
];
// 오늘 날짜 (한국 시간) 'YYYY-MM-DD'
export const todayKr = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
// 기록 묶음을 문서(HTML)로. 서버 함수 journal-ai 의 문서와 같은 모양 (연습 모드에서 쓴다)
function journalDoc(name, entries) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replaceAll('\n', '<br>');
  const body = entries.map((e) => `<h2>${esc(e.day)}</h2>${e.summary ? `<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%">${e.summary.map((x) => `<tr><th align="left" width="28%">${esc(x.label)}</th><td>${esc(x.text)}</td></tr>`).join('')}</table>` : '<p><i>아직 정리하지 않은 기록입니다.</i></p>'}${e.feedback ? `<h3>선생님 피드백</h3><p>${esc(e.feedback)}</p>` : ''}<h3>대화 전체</h3>${e.messages.map((m) => `<p><b>${m.role === 'user' ? '학생' : 'AI'}</b>: ${esc(m.content)}</p>`).join('')}`).join('<hr>');
  return `<html><head><meta charset="utf-8"><title>${esc(name)}</title></head><body style="font-family:'Malgun Gothic',sans-serif"><h1>${esc(name)}</h1>${body}</body></html>`;
}

// 오늘 날짜의 학년도 · 학기: 3~8월 = 1학기, 9~12월 = 2학기, 1~2월 = 지난해의 2학기 (DB 의 at_save_assignment 와 같은 규칙)
export function currentTerm(date = new Date()) {
  const m = date.getMonth() + 1, y = date.getFullYear();
  return { school_year: m <= 2 ? y - 1 : y, semester: m >= 3 && m <= 8 ? 1 : 2 };
}
// 구글에서 돌아올 주소 = 지금 화면 (물음표 뒤는 뺀다). 구글 클라우드의 '승인된 리디렉션 URI' 에 똑같이 등록되어 있어야 한다
const redirectUri = () => location.origin + location.pathname;

/* ───────────── 실제 서버 ───────────── */
async function serverApi() {
  const db = await getClient();
  const rpc = async (fn, args) => { const { data, error } = await db.rpc(fn, args); if (error) throw new Error(error.message || '서버에 연결하지 못했습니다'); return data; };
  return {
    mode: 'server',
    account: () => currentAccount(),                                   // { kind: 'guest' | 'student' | 'teacher', id, nickname? | name?, unregistered?, pending? }
    // 구글 로그인 화면으로 갔다가 이 화면으로 돌아온다 (가입은 수업 공간 첫 화면에서 한다)
    async signInGoogle() { const r = await signInWithGoogle(); if (r.error) throw new Error(r.error); },
    async logout() { await signOut(); },
    async signInTeacher(email, password) { const { error } = await db.auth.signInWithPassword({ email, password }); if (error) throw new Error('이메일 또는 비밀번호가 맞지 않습니다'); },

    studentHome: () => rpc('at_student_home'),
    teacherHome: () => rpc('at_teacher_home'),
    saveAssignment: (a) => rpc('at_save_assignment', { p: a }),
    deleteAssignment: (id) => rpc('at_delete_assignment', { p_id: id }),
    saveNotice: (n) => rpc('at_save_notice', { p: n }),
    deleteNotice: (id) => rpc('at_delete_notice', { p_id: id }),
    submissions: (id) => rpc('at_submissions', { p_assignment: id }),

    // 구글 드라이브 연결 (교사마다 자기 구글 계정으로 로그인한다)
    //   connectDrive : 구글 로그인 화면으로 이동한다. 로그인하면 이 화면으로 ?code=…&state=… 가 붙어 돌아온다
    //   finishConnect: 돌아온 뒤 연결을 마무리한다 → { email, folder }
    async connectDrive() { location.href = (await callDrive(db, { action: 'auth_url', redirect_uri: redirectUri() })).url; },
    finishConnect: (code, state) => callDrive(db, { action: 'connect', code, state, redirect_uri: redirectUri() }),
    checkDrive: () => callDrive(db, { action: 'check' }),
    disconnectDrive: () => callDrive(db, { action: 'disconnect' }),
    setLimits: (maxFileMb, maxFiles) => rpc('at_set_limits', { p_max_file_mb: maxFileMb, p_max_files: maxFiles }),

    // 파일: kind 'ref'(교사의 참고 자료) | 'sub'(학생 제출)
    upload: (assignmentId, kind, file, onProgress) => uploadFile(db, assignmentId, kind, file, onProgress),
    download: (fileId, onProgress) => downloadFile(db, fileId, onProgress),
    async removeFile(fileId) { await callDrive(db, { action: 'delete', file_id: fileId }); },

    // 훌륭한 실패 (프로세스 저널). 대화 · 정리 · 드라이브 저장은 서버 함수 journal-ai 가 한다
    journalHome: () => rpc('jn_student_home'),                               // { on, shown, fields, today, limit, entries }
    journalEntry: (id) => rpc('jn_entry', { p_id: id }),                     // 기록 한 개 (대화 포함)
    journalChat: (day, text) => callFn(db, 'journal-ai', { action: 'chat', day, text }),          // → { reply }
    journalFinish: (day) => callFn(db, 'journal-ai', { action: 'finish', day }),                  // → { summary }
    // 직접 쓰기 방식: 양식에 쓴 글을 저장하고, 드라이브 문서 저장은 뒤에서 따로 부탁한다 (실패해도 기록은 남는다)
    async journalWrite(day, texts) { const entryId = await rpc('jn_write', { p_day: day, p_texts: texts }); callFn(db, 'journal-ai', { action: 'sync', entry_id: entryId }).catch(() => {}); },
    journalTeacherHome: () => rpc('jn_teacher_home'),                        // { conf, classes: [{ students }] }
    journalStudent: (studentId) => rpc('jn_student_entries', { p_student: studentId }),
    journalSaveSettings: (p) => rpc('jn_save_settings', { p }),
    journalSetKey: (key) => callFn(db, 'journal-ai', { action: 'set_key', key }),
    journalClearKey: () => callFn(db, 'journal-ai', { action: 'clear_key' }),
    journalFeedback: (entryId, text) => callFn(db, 'journal-ai', { action: 'feedback', entry_id: entryId, text }),
    journalExport: (studentId) => callFn(db, 'journal-ai', { action: 'export', student_id: studentId }),      // → { name, html, link }
  };
}

/* ───────────── 연습 모드 (브라우저 안에서만) ───────────── */
function demoApi(role) {
  const id = () => crypto.randomUUID(), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
  const classes = [
    { id: 'c1', name: '2학년 3반', school: '연습초', grade: 2, class_no: 3 },
    { id: 'c2', name: '2학년 4반', school: '연습초', grade: 2, class_no: 4 },
  ];
  const students = [
    { id: 's1', classId: 'c1', no: 12, name: '김하늘' }, { id: 's2', classId: 'c1', no: 13, name: '이도윤' }, { id: 's3', classId: 'c1', no: 14, name: '박서연' },
    { id: 's4', classId: 'c2', no: 1, name: '최지우' }, { id: 's5', classId: 'c2', no: 2, name: '정민준' },
  ];
  const me = students[0];
  const assignments = [
    { id: 'a1', title: '나의 얼굴 드로잉', body: '거울을 보고 내 얼굴을 연필로 그려 봅니다.\n\n· 4절 도화지 또는 스케치북\n· 완성한 그림을 휴대폰으로 찍어 올려 주세요', link: '', ...currentTerm(), due_at: days(3), lock_after_due: true, closed: false, created_at: days(-2), class_ids: ['c1', 'c2'] },
    { id: 'a2', title: '색으로 표현한 기분', body: '오늘의 기분을 색 세 가지로 표현해 보세요.', link: 'https://www.google.com/search?q=color+wheel', ...currentTerm(), due_at: days(-1), lock_after_due: false, closed: false, created_at: days(-6), class_ids: ['c1'] },
  ];
  const locked = (a) => a.closed || (a.lock_after_due && !!a.due_at && new Date(a.due_at) < new Date());
  const notices = [
    { id: 'n1', title: '다음 주 준비물', body: '다음 주 화요일에는 수채화 물감과 붓을 꼭 가져오세요.\n물통은 미술실에 있습니다.', pinned: true, created_at: days(-1), teacher: '연습 교사', class_ids: ['c1', 'c2'] },
  ];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200" fill="#1c1d22"/><circle cx="160" cy="100" r="54" fill="none" stroke="#9aa8ff" stroke-width="4"/><path d="M138 92h4m36 0h4M140 122q20 14 40 0" stroke="#9aa8ff" stroke-width="4" fill="none" stroke-linecap="round"/></svg>';
  const files = [
    { id: 'f1', assignment_id: 'a1', kind: 'ref', student_id: null, name: '얼굴 비례 예시.svg', mime: 'image/svg+xml', blob: new Blob([svg], { type: 'image/svg+xml' }), created_at: days(-2) },
    { id: 'f2', assignment_id: 'a2', kind: 'sub', student_id: 's2', name: '기분 색.txt', mime: 'text/plain', blob: new Blob(['파랑, 노랑, 연두'], { type: 'text/plain' }), created_at: days(-2) },
  ];
  const drive = { email: '', folder: 'https://drive.google.com/', max_file_mb: 100, max_files: 5 };
  const fj = (f) => ({ id: f.id, name: f.name, size: f.blob.size, mime: f.mime, created_at: f.created_at });
  const aj = (a, studentId) => {
    const base = { ...a, locked: locked(a), refs: files.filter((f) => f.assignment_id === a.id && f.kind === 'ref').map(fj) };
    if (studentId) return { ...base, mine: files.filter((f) => f.assignment_id === a.id && f.kind === 'sub' && f.student_id === studentId).map(fj) };
    return { ...base, submitted: new Set(files.filter((f) => f.assignment_id === a.id && f.kind === 'sub').map((f) => f.student_id)).size, total: students.filter((s) => a.class_ids.includes(s.classId)).length };
  };
  const newest = (a, b) => b.created_at.localeCompare(a.created_at);
  const checkClasses = (ids) => { if (!ids?.length) throw new Error('반을 하나 이상 골라 주세요'); };
  // 훌륭한 실패 (프로세스 저널)
  const dayAgo = (n) => new Date(Date.now() + 9 * 3600000 - n * 86400000).toISOString().slice(0, 10);
  // 주소가 ?demo=write 이면 '학생이 직접 쓰기' 방식으로 시작한다 (학생 화면을 미리 볼 때)
  const jconf = { enabled: true, mode: new URLSearchParams(location.search).get('demo') === 'write' ? 'write' : 'ai', guide: '', fields: [...JOURNAL_FIELDS], model: 'claude-opus-5-5', daily_limit: 30, has_key: true };
  const journal = [
    { id: 'j1', student_id: 's1', day: dayAgo(2), feedback: '테이프를 미리 붙여 본 시도가 좋았어요. 다음에는 물의 양을 바꿔 가며 작은 종이에 먼저 실험해 보면 어떨까요?', feedback_at: days(-1),
      summary: [{ label: '오늘 한 일', text: '수채화로 하늘을 칠했다.' }, { label: '시도해 본 것', text: '물을 많이 써서 번지게 하는 방법을 해 봤다.' }, { label: '잘 안 된 것 (훌륭한 실패)', text: '물이 너무 많아서 종이가 울고 색이 탁해졌다.' }, { label: '다음에 해 볼 것', text: '종이를 테이프로 붙이고 물을 조금만 써 보겠다.' }],
      messages: [{ role: 'user', content: '오늘 수채화로 하늘 칠했어요', at: days(-2) }, { role: 'assistant', content: '하늘을 칠했군요! 어떤 방법으로 칠해 봤어요?', at: days(-2) },
        { role: 'user', content: '물 많이 해서 번지게 했는데 종이가 울었어요', at: days(-2) }, { role: 'assistant', content: '종이가 울어서 속상했겠어요. 왜 그렇게 됐다고 생각해요?', at: days(-2) },
        { role: 'user', content: '물이 너무 많았던 것 같아요. 다음엔 테이프로 붙이고 물 조금만 쓸래요', at: days(-2) }] },
    { id: 'j2', student_id: 's2', day: dayAgo(1), feedback: '', feedback_at: null, summary: null,
      messages: [{ role: 'user', content: '찰흙으로 컵 만들었는데 손잡이가 떨어졌어요', at: days(-1) }, { role: 'assistant', content: '손잡이가 떨어졌군요. 붙일 때 어떻게 했는지 알려 줄래요?', at: days(-1) }] },
  ];
  const jOf = (sid) => journal.filter((e) => e.student_id === sid).sort((a, b) => b.day.localeCompare(a.day));
  const jj = (e, withMessages) => ({ id: e.id, day: e.day, summary: e.summary, feedback: e.feedback, feedback_at: e.feedback_at, count: e.messages.filter((m) => m.role === 'user').length, ...(withMessages ? { messages: e.messages.map((m) => ({ ...m })) } : {}) });
  let signedIn = true;
  return {
    mode: 'demo',
    async account() { return signedIn ? (role === 'teacher' ? { kind: 'teacher', id: 'me', name: '연습 교사' } : { kind: 'student', id: me.id, nickname: '하늘이' }) : { kind: 'guest', id: null }; },
    async signInGoogle() { signedIn = true; },                        // 연습 모드: 구글로 가지 않고 바로 로그인된 것으로 한다
    async logout() { signedIn = false; },
    async signInTeacher() { signedIn = true; },

    async studentHome() {
      return {
        me: { id: me.id, nickname: '하늘이' },
        notices: notices.filter((n) => n.class_ids.includes(me.classId)).sort((a, b) => b.pinned - a.pinned || newest(a, b)),
        assignments: assignments.filter((a) => a.class_ids.includes(me.classId)).sort(newest).map((a) => aj(a, me.id)),
      };
    },
    async teacherHome() {
      return {
        drive: drive.email ? { ...drive } : null,
        classes: classes.map((c) => ({ ...c, count: students.filter((s) => s.classId === c.id).length })),
        assignments: [...assignments].sort(newest).map((a) => aj(a, null)),
        notices: [...notices].sort((a, b) => b.pinned - a.pinned || newest(a, b)),
      };
    },
    async saveAssignment(a) {
      checkClasses(a.class_ids);
      if (!a.title?.trim()) throw new Error('제목을 1~80자로 적어 주세요');
      if (a.lock_after_due && !a.due_at) throw new Error('마감 뒤 제출을 막으려면 마감 날짜와 시간을 정해 주세요');
      const term = currentTerm();
      const row = { title: a.title.trim(), body: a.body ?? '', link: a.link ?? '', school_year: +a.school_year || term.school_year, semester: +a.semester || term.semester,
        due_at: a.due_at || null, lock_after_due: !!a.lock_after_due, closed: !!a.closed, class_ids: [...a.class_ids] };
      if (a.id) { Object.assign(assignments.find((x) => x.id === a.id), row); return a.id; }
      const made = { id: id(), created_at: new Date().toISOString(), ...row }; assignments.push(made); return made.id;
    },
    async deleteAssignment(aid) { assignments.splice(assignments.findIndex((x) => x.id === aid), 1); },
    async saveNotice(n) {
      checkClasses(n.class_ids);
      if (!n.title?.trim()) throw new Error('제목을 1~80자로 적어 주세요');
      const row = { title: n.title.trim(), body: n.body ?? '', pinned: !!n.pinned, class_ids: [...n.class_ids] };
      if (n.id) { Object.assign(notices.find((x) => x.id === n.id), row); return n.id; }
      const made = { id: id(), created_at: new Date().toISOString(), teacher: '연습 교사', ...row }; notices.push(made); return made.id;
    },
    async deleteNotice(nid) { notices.splice(notices.findIndex((x) => x.id === nid), 1); },
    async submissions(aid) {
      const a = assignments.find((x) => x.id === aid);
      return classes.filter((c) => a.class_ids.includes(c.id)).map((c) => ({ id: c.id, name: c.name,
        students: students.filter((s) => s.classId === c.id).map((s) => ({ id: s.id, no: s.no, name: s.name, files: files.filter((f) => f.assignment_id === aid && f.kind === 'sub' && f.student_id === s.id).map(fj) })) }));
    },
    async connectDrive() { await sleep(300); drive.email = 'teacher@example.com'; return { demo: true }; },      // 연습 모드: 구글로 가지 않고 연결된 것처럼 보여 준다
    async finishConnect() { return { email: drive.email, folder: drive.folder }; },
    async checkDrive() { if (!drive.email) throw new Error('선생님이 아직 구글 드라이브를 연결하지 않았습니다'); return { email: drive.email, folder: drive.folder }; },
    async disconnectDrive() { drive.email = ''; },
    async setLimits(mb, n) { drive.max_file_mb = mb; drive.max_files = n; },
    async upload(assignmentId, kind, file, onProgress = () => {}) {
      const a = assignments.find((x) => x.id === assignmentId);
      if (file.size > drive.max_file_mb * 1048576) throw new Error(`파일 하나는 ${drive.max_file_mb}MB 까지 올릴 수 있습니다`);
      if (kind === 'sub') {
        if (a.closed) throw new Error('선생님이 제출을 마감했습니다');
        if (locked(a)) throw new Error('마감 시간이 지나 제출할 수 없습니다. 선생님께 말씀드려 주세요');
        if (files.filter((f) => f.assignment_id === a.id && f.kind === 'sub' && f.student_id === me.id).length >= drive.max_files) throw new Error(`이 과제에는 파일을 ${drive.max_files}개까지 낼 수 있습니다. 먼저 낸 파일을 지우고 다시 올려 주세요`);
      }
      for (const p of [0.3, 0.7, 1]) { await sleep(250); onProgress(p); }
      const f = { id: id(), assignment_id: a.id, kind, student_id: kind === 'sub' ? me.id : null, name: file.name, mime: file.type, blob: file, created_at: new Date().toISOString() };
      files.push(f); return fj(f);
    },
    async download(fileId, onProgress = () => {}) { const f = files.find((x) => x.id === fileId); await sleep(200); onProgress(1); return { name: f.name, blob: f.blob }; },
    async removeFile(fileId) {
      const f = files.find((x) => x.id === fileId), a = assignments.find((x) => x.id === f.assignment_id);
      if (role !== 'teacher' && locked(a)) throw new Error('마감되어 지울 수 없습니다');
      files.splice(files.indexOf(f), 1);
    },

    // 훌륭한 실패: 연습 모드에서는 AI 대신 정해 둔 질문을 차례로 돌려준다
    async journalWrite(day, texts) {
      const d = day || todayKr(), summary = jconf.fields.map((label, i) => ({ label, text: (texts[i] ?? '').trim() }));
      if (!summary.some((x) => x.text)) throw new Error('한 칸 이상 적어 주세요');
      await sleep(300);
      let e = journal.find((x) => x.student_id === me.id && x.day === d);
      if (!e) { e = { id: id(), student_id: me.id, day: d, summary: null, feedback: '', feedback_at: null, messages: [] }; journal.push(e); }
      e.summary = summary;
    },
    async journalHome() { return { on: jconf.enabled && (jconf.mode === 'write' || jconf.has_key), shown: jconf.enabled, mode: jconf.mode, fields: [...jconf.fields], today: todayKr(), limit: jconf.daily_limit, entries: jOf(me.id).map((e) => jj(e, false)) }; },
    async journalEntry(eid) { return jj(journal.find((e) => e.id === eid), true); },
    async journalChat(day, text) {
      if (!jconf.has_key) throw new Error('선생님이 아직 AI 를 연결하지 않았어요. 선생님께 말씀드려 주세요');
      if (!text.trim()) throw new Error('한 번에 1~1000자로 적어 주세요');
      const d = day || todayKr();
      let e = journal.find((x) => x.student_id === me.id && x.day === d);
      if (!e) { e = { id: id(), student_id: me.id, day: d, summary: null, feedback: '', feedback_at: null, messages: [] }; journal.push(e); }
      const said = e.messages.filter((m) => m.role === 'user').length;
      if (said >= jconf.daily_limit) throw new Error('오늘은 이야기를 충분히 나눴어요. "오늘 기록 정리하기"를 눌러 마무리해 주세요');
      e.messages.push({ role: 'user', content: text.trim(), at: new Date().toISOString() });
      await sleep(700);
      const asks = ['그랬군요! 그걸 하면서 어떤 방법을 써 봤어요?', '해 보니 생각대로 안 된 부분이 있었나요? 어디에서 막혔는지 알려 주세요.', '그때 왜 그렇게 됐다고 생각해요?', '다음 시간에는 무엇을 다르게 해 보고 싶어요?', '이야기 고마워요. 이제 아래의 "오늘 기록 정리하기"를 눌러 보세요. (연습 모드의 AI 는 정해진 질문만 합니다)'];
      const reply = asks[Math.min(said, asks.length - 1)];
      e.messages.push({ role: 'assistant', content: reply, at: new Date().toISOString() });
      return { reply };
    },
    async journalFinish(day) {
      const e = journal.find((x) => x.student_id === me.id && x.day === (day || todayKr()));
      const said = (e?.messages ?? []).filter((m) => m.role === 'user').map((m) => m.content);
      if (!said.length) throw new Error('먼저 오늘 한 일을 이야기해 주세요');
      await sleep(900);
      e.summary = jconf.fields.map((label, i) => ({ label, text: said[i] ?? '이야기하지 않음' }));        // 연습 모드: 학생이 한 말을 차례로 칸에 넣는다
      return { summary: e.summary };
    },
    async journalTeacherHome() {
      return { conf: { ...jconf, fields: [...jconf.fields] }, classes: classes.map((c) => ({ id: c.id, name: c.name, students: students.filter((s) => s.classId === c.id).map((s) => {
        const list = jOf(s.id); return { id: s.id, no: s.no, name: s.name, entries: list.length, waiting: list.filter((e) => !e.feedback).length, last_day: list[0]?.day ?? null };
      }) })) };
    },
    async journalStudent(sid) { const s = students.find((x) => x.id === sid); return { student: { id: s.id, no: s.no, name: s.name, class: classes.find((c) => c.id === s.classId).name }, entries: jOf(sid).map((e) => jj(e, true)) }; },
    async journalSaveSettings(p) {
      const fields = (p.fields ?? []).map((x) => x.trim()).filter(Boolean);
      if (fields.length < 1 || fields.length > 8) throw new Error('양식의 칸은 1~8개, 칸 이름은 40자까지로 정해 주세요');
      Object.assign(jconf, { enabled: !!p.enabled, mode: p.mode === 'write' ? 'write' : 'ai', guide: p.guide ?? '', fields, model: p.model, daily_limit: +p.daily_limit || 30 });
    },
    async journalSetKey(key) { if ((key ?? '').trim().length < 20) throw new Error('Claude API 열쇠를 다시 확인해 주세요 (sk-ant- 로 시작합니다)'); await sleep(400); jconf.has_key = true; },
    async journalClearKey() { jconf.has_key = false; },
    async journalFeedback(eid, text) { const e = journal.find((x) => x.id === eid); e.feedback = text.trim(); e.feedback_at = e.feedback ? new Date().toISOString() : null; },
    async journalExport(sid) {
      const s = students.find((x) => x.id === sid), name = `훌륭한 실패 전체 기록 - ${classes.find((c) => c.id === s.classId).name} ${s.no}번 ${s.name}`;
      return { name, html: journalDoc(name, [...jOf(sid)].reverse()), link: null };
    },
  };
}

export const isDemo = () => !backendEnabled() || new URLSearchParams(location.search).has('demo');
// role: 'student' | 'teacher' (연습 모드에서 누구로 보일지)
export const createApi = (role) => (isDemo() ? Promise.resolve(demoApi(role)) : serverApi());
