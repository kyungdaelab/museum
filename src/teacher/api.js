// 교사용 · 관리자용 화면이 쓰는 기능 모음.
//   Supabase 설정이 있으면(src/data/backend.js) → 실제 서버
//   없거나 주소에 ?demo 가 붙으면 → 연습 모드: 브라우저 안에서만 흉내 낸다 (저장되지 않고, 새로고침하면 사라짐)
//
// 전시실 · 작품은 DB 의 열 이름 그대로 다룬다 (rooms: title, type 'flat' | 'sculpture', max_artworks, visibility, … /
// artworks: slot, kind, title, artist, grade, material, size_cm, description, file_path, thumbnail_path, file_size, adjust)
import { backendEnabled, getClient } from '../data/backend.js';
import { signInWithGoogle, applyTeacher, forgetAccount } from '../data/student-auth.js';
import { uploadArtwork, uploadFile, confirmUpload, deleteArtwork as removeArtworkFiles, deleteRoom as removeRoomFiles } from '../data/storage.js';

export const KIND_OF_TYPE = { flat: ['image'], sculpture: ['model', 'splat'], mixed: ['image', 'model', 'splat'] };
// 선생님이 학생에게 줄 수 있는 선물 아이템 (모양은 src/character/items.js)
export { ITEM_LIST } from '../character/item-list.js';

// 학교 이름 앞 두 글자의 첫소리 → 알파벳 (DB 의 create_class 와 같은 규칙. 연습 모드에서 사용)
export function schoolInitials(school) {
  let out = '';
  for (const ch of school) {
    if (out.length >= 2) break;
    const c = ch.codePointAt(0);
    if (c >= 44032 && c <= 55203) out += 'GGNDDRMBBSSOJJCKTPH'[Math.floor((c - 44032) / 588)];
    else if (/[A-Za-z]/.test(ch)) out += ch.toUpperCase();
  }
  return out || 'CL';
}

// 명단 글(붙여넣기 · CSV) → [{ no, name }].  한 줄에 "번호, 이름" · "번호(탭)이름" · "번호 이름". 번호가 없으면 앞 번호 다음 번호
export function parseRoster(text) {
  const rows = [], errors = [], seen = new Set();
  let next = 1;
  for (const [i, raw] of String(text).split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split(/\t|,|;/).map((c) => c.trim()).filter(Boolean);
    let no, name;
    if (cells.length >= 2 && /^\d+$/.test(cells[0])) { no = +cells[0]; name = cells.slice(1).join(' '); }
    else { const m = line.match(/^(\d+)\s*[번.)]?\s+(.+)$/); if (m) { no = +m[1]; name = m[2].trim(); } else if (/^\d+$/.test(line)) { errors.push(`${i + 1}번째 줄: 이름이 없습니다`); continue; } else { no = next; name = cells.join(' '); } }
    if (i === 0 && /번호|이름|닉네임|name|no/i.test(line) && !/^\d/.test(line)) continue;        // 제목 줄은 건너뜀
    if (no < 1 || no > 99) { errors.push(`${i + 1}번째 줄: 번호는 1~99 사이여야 합니다 (${no})`); continue; }
    if (name.length > 20) { errors.push(`${i + 1}번째 줄: 이름은 20자까지입니다`); continue; }
    if (seen.has(no)) { errors.push(`${i + 1}번째 줄: ${no}번이 두 번 나옵니다`); continue; }
    seen.add(no); rows.push({ no, name }); next = no + 1;
  }
  return { rows: rows.sort((a, b) => a.no - b.no), errors };
}

// 학번 → 가능한 [학년, 반, 번호] 들.  학번 = 학년 + 반 + 번호(두 자리). 예: 2312 → 2학년 3반 12번 (서버 student-login 과 같은 규칙)
//   다섯 자리는 (학년 1 + 반 2) 가 먼저, (학년 2 + 반 1) 이 다음.  예전 방식 20312 → 2학년 3반 12번
export function parseStudentCode(code) {
  const sc = String(code).trim();
  if (!/^\d{4,6}$/.test(sc)) return [];
  const head = sc.slice(0, -2), no = Number(sc.slice(-2));
  const splits = head.length === 2 ? [1] : head.length === 3 ? [1, 2] : [2];
  return no < 1 ? [] : splits.map((g) => ({ grade: Number(head.slice(0, g)), classNo: Number(head.slice(g)), no }))
    .filter((p) => p.grade >= 1 && p.grade <= 12 && p.classNo >= 1 && p.classNo <= 40);
}

// 진급 명단 글 → 옮길 계획.  한 줄에 "지금 학번, 새 학번" (쉼표 · 탭 · 빈칸 · 화살표로 구분)
//   classes  = 내 학급 [{ id, school, grade, class_no, name }]     students = 내 학생 [{ id, classId, no, name }]
//   반환 { moves: [{ studentId, name, from, to, classId | null, classKey, no }], creates: [{ key, school, grade, classNo }], errors }
//     classId 가 null 이면 새 학급을 만들어야 한다 → creates 의 같은 key 로 만든 뒤 채운다
export function planPromotion(text, classes, students) {
  const moves = [], errors = [], creates = new Map(), seenStudent = new Set(), seenSeat = new Map();
  const classById = new Map(classes.map((c) => [c.id, c]));
  const findClasses = (p, school) => classes.filter((c) => c.grade === p.grade && c.class_no === p.classNo && (school == null || c.school === school));
  for (const [i, raw] of String(text).split(/\r?\n/).entries()) {
    const line = raw.trim(), at = `${i + 1}번째 줄`;
    if (!line) continue;
    const cells = line.split(/[\s,;→>-]+/).filter(Boolean);
    if (cells.length < 2 || !/^\d+$/.test(cells[0]) || !/^\d+$/.test(cells[1])) {
      if (i === 0 && !/^\d/.test(line)) continue;                                  // 제목 줄은 건너뜀
      errors.push(`${at}: "지금 학번, 새 학번" 두 칸으로 적어 주세요 (${line})`); continue;
    }
    const [from, to] = cells;
    // 지금 학번 → 학생
    const found = [];
    for (const p of parseStudentCode(from)) for (const c of findClasses(p)) { const s = students.find((x) => x.classId === c.id && x.no === p.no); if (s && !found.includes(s)) found.push(s); }
    if (!found.length) { errors.push(`${at}: 지금 학번 ${from} 인 학생을 내 학급에서 찾지 못했습니다`); continue; }
    if (found.length > 1) { errors.push(`${at}: 학번 ${from} 인 학생이 내 학급에 두 명 이상 있습니다 (학교가 다른 학급). 한쪽 학급을 먼저 정리해 주세요`); continue; }
    const student = found[0], school = classById.get(student.classId).school;
    if (seenStudent.has(student.id)) { errors.push(`${at}: 학번 ${from} 이 두 번 나옵니다`); continue; }
    // 새 학번 → 옮겨 갈 학급 (같은 학교에서 찾고, 없으면 새로 만든다)
    const cands = parseStudentCode(to);
    if (!cands.length) { errors.push(`${at}: 새 학번 ${to} 를 읽지 못했습니다 (학년 + 반 + 번호 두 자리, 예: 3105)`); continue; }
    let target = null, pick = cands[0];
    for (const p of cands) { const c = findClasses(p, school)[0]; if (c) { target = c; pick = p; break; } }
    const classKey = target ? target.id : `${school}|${pick.grade}|${pick.classNo}`, seat = `${classKey}#${pick.no}`;
    if (seenSeat.has(seat)) { errors.push(`${at}: 새 학번 ${to} 가 ${seenSeat.get(seat)}번째 줄과 겹칩니다`); continue; }
    if (!target && !creates.has(classKey)) creates.set(classKey, { key: classKey, school, grade: pick.grade, classNo: pick.classNo });
    seenStudent.add(student.id); seenSeat.set(seat, i + 1);
    moves.push({ studentId: student.id, name: student.name, from, to, classId: target?.id ?? null, classKey, no: pick.no });
  }
  // 옮겨 갈 자리에 이미 (이번에 옮기지 않는) 학생이 있는지
  for (const m of moves) {
    const sitting = m.classId && students.find((s) => s.classId === m.classId && s.no === m.no && !seenStudent.has(s.id));
    if (sitting) errors.push(`새 학번 ${m.to}: 이미 ${sitting.name} 학생이 쓰고 있습니다. 그 학생도 명단에 넣어 함께 옮기거나 번호를 바꿔 주세요`);
  }
  return { moves, creates: [...creates.values()], errors };
}

/* ───────────── 명렬표 ───────────── */
const normName = (s) => String(s ?? '').replace(/\s/g, '').toLowerCase();
// 명렬표 글 → 줄 [{ line, code, name, prev }].  한 줄에 한 명:
//   "학번, 이름"  또는  "학년, 반, 번호, 이름"  (엑셀에서 복사해 붙여 넣어도 된다)
//   새 학년에 동명이인이 있을 때만 맨 뒤 칸에 이전 학번을 더 적는다:  "3105, 김하늘, 2312"
export function parseRosterText(text) {
  const rows = [], errors = [];
  for (const [i, raw] of String(text).split(/\r?\n/).entries()) {
    const line = raw.trim(), at = `${i + 1}번째 줄`;
    if (!line) continue;
    let cells = line.split(/[\t,;]+/).map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) cells = line.split(/\s+/);
    const num = (c) => /^\d+$/.test(c ?? '');
    let code, name, prev;
    if (/^\d{4,6}$/.test(cells[0]) && cells[1] && !num(cells[1])) [code, name, prev] = cells;
    else if (num(cells[0]) && num(cells[1]) && num(cells[2]) && cells[3] && cells[0].length <= 2 && cells[1].length <= 2 && cells[2].length <= 2)
      [code, name, prev] = [`${+cells[0]}${+cells[1]}${String(+cells[2]).padStart(2, '0')}`, cells[3], cells[4]];
    else { if (i === 0 && !/^\d/.test(line)) continue; errors.push(`${at}: "학번, 이름" 으로 적어 주세요 (${line})`); continue; }      // 첫 줄의 제목은 건너뜀
    if (name.length > 20) { errors.push(`${at}: 이름은 20자까지입니다`); continue; }
    if (prev != null && !/^\d{4,6}$/.test(prev)) { errors.push(`${at}: 이전 학번은 숫자 4~6자리로 적어 주세요 (${prev})`); continue; }
    rows.push({ line: i + 1, code, name, prev: prev ?? '' });
  }
  return { rows, errors };
}

// 명렬표를 지금 상태와 견주어 '무엇을 할지' 계획을 세운다.
//   classes = 내 학급 [{ id, school, grade, class_no }]     entries = 지금 명렬표 [{ class_id, no, name, student_id }]
//   반환 { creates: [{ key, school, grade, classNo }], entries: [{ classId | null, classKey, no, name, studentId | null }],
//          drops: [{ class_id, no }], errors, count: { fresh(새 자리), moved(정보가 이어지는 학생), same(그대로) } }
//   · 같은 자리에 같은 이름이 이미 있으면 그대로 둔다
//   · 다른 자리에 같은 이름이 한 명 있으면(또는 이전 학번을 적어 주면) 그 학생을 새 자리로 옮긴다 → 계정 · 캐릭터 · 제출 기록이 이어진다
export function planRoster(text, school, classes, entries) {
  const { rows, errors } = parseRosterText(text);
  const out = { creates: [], entries: [], drops: [], errors, count: { fresh: 0, moved: 0, same: 0 } };
  const seatKey = (classId, no) => `${classId}#${no}`;
  const bySeat = new Map(entries.map((e) => [seatKey(e.class_id, e.no), e]));
  const classOf = (p, sch) => classes.find((c) => c.grade === p.grade && c.class_no === p.classNo && (sch == null || c.school === sch));
  const creates = new Map(), used = new Set(), taken = new Map(), moving = new Set();
  for (const r of rows) {
    const at = `${r.line}번째 줄`, cands = parseStudentCode(r.code);
    if (!cands.length) { errors.push(`${at}: 학번 ${r.code} 를 읽지 못했습니다 (학년 + 반 + 번호 두 자리, 예: 2312)`); continue; }
    let pick = cands[0], cls = null;
    for (const p of cands) { const c = classOf(p, school); if (c) { cls = c; pick = p; break; } }
    const classKey = cls ? cls.id : `${school}|${pick.grade}|${pick.classNo}`, seat = seatKey(classKey, pick.no);
    if (taken.has(seat)) { errors.push(`${at}: 학번 ${r.code} 가 ${taken.get(seat)}번째 줄과 겹칩니다`); continue; }
    taken.set(seat, r.line);
    const here = cls ? bySeat.get(seat) : null;
    if (here && normName(here.name) === normName(r.name) && !r.prev) { used.add(here); out.count.same++; continue; }       // 이미 그 자리에 그 학생

    // 이어 갈 학생 찾기: 이전 학번을 적었으면 그 자리, 아니면 다른 자리에 있는 같은 이름
    let from = null;
    if (r.prev) {
      for (const p of parseStudentCode(r.prev)) { for (const c of classes.filter((x) => x.grade === p.grade && x.class_no === p.classNo)) { const e = bySeat.get(seatKey(c.id, p.no)); if (e && !used.has(e)) { from = e; break; } } if (from) break; }
      if (!from) { errors.push(`${at}: 이전 학번 ${r.prev} 인 학생을 내 학급에서 찾지 못했습니다`); continue; }
    } else {
      const same = entries.filter((e) => e !== here && !used.has(e) && normName(e.name) === normName(r.name));
      if (same.length > 1) { errors.push(`${at}: ${r.name} 학생이 지금 명렬표에 ${same.length}명 있습니다(동명이인). 이름 뒤에 이전 학번을 적어 주세요 → ${r.code}, ${r.name}, 이전학번`); continue; }
      from = same[0] ?? null;
    }
    if (!cls && !creates.has(classKey)) creates.set(classKey, { key: classKey, school, grade: pick.grade, classNo: pick.classNo });
    if (from) { used.add(from); out.drops.push({ class_id: from.class_id, no: from.no }); if (from.student_id) moving.add(from.student_id); }
    out.entries.push({ classId: cls?.id ?? null, classKey, no: pick.no, name: r.name, studentId: from?.student_id ?? null, code: r.code });
    if (from) out.count.moved++; else out.count.fresh++;
  }
  // 넣으려는 자리에 이미 다른 학생이 가입해 있고, 그 학생은 이번에 옮겨 가지 않는 경우
  for (const e of out.entries) {
    const here = e.classId && bySeat.get(seatKey(e.classId, e.no));
    if (here?.student_id && !moving.has(here.student_id) && (e.studentId || normName(here.name) !== normName(e.name)))
      errors.push(`학번 ${e.code}: 그 자리에 이미 ${here.name} 학생이 가입해 있습니다. 그 학생의 새 학번도 명렬표에 넣거나, 먼저 가입을 취소해 주세요`);
  }
  out.creates = [...creates.values()];
  return out;
}

async function fnError(error) {
  try { const b = await error.context.json(); return new Error(b.error || error.message); } catch { return new Error(error.message || '서버에 연결하지 못했습니다'); }
}
const META = ['title', 'artist', 'grade', 'material', 'description', 'size_cm', 'adjust'];
const pick = (src, keys) => Object.fromEntries(keys.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));
const MEDAL_FIELDS = ['name', 'kind', 'shape', 'metal', 'ribbon', 'name_color', 'effect'];      // 선물(훈장 · 꾸미기 아이템) 한 개의 값
const ROOM_FIELDS = ['title', 'description', 'type', 'max_artworks', 'theme', 'visibility', 'starts_on', 'ends_on', 'guest_allowed', 'guest_avatar_mode', 'max_guests'];

/* ───────────── 실제 서버 ───────────── */
async function serverApi() {
  const db = await getClient();
  const roster = async (body) => { const { data, error } = await db.functions.invoke('class-roster', { body }); if (error) throw await fnError(error); return data; };
  const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  const myId = async () => (await db.auth.getSession()).data.session?.user?.id;
  const withCount = (r, owner) => ({ ...r, is_owner: owner, artwork_count: r.artworks?.[0]?.count ?? 0 });
  return {
    mode: 'server',
    async session() {
      const { data } = await db.auth.getSession(); const user = data.session?.user;
      if (!user || user.is_anonymous) return null;
      const profile = must(await db.from('profiles').select('name, role, approved, school').eq('id', user.id).maybeSingle());
      return { id: user.id, email: user.email, profile, googleName: user.user_metadata?.full_name ?? '' };      // profile 이 없으면 아직 교사 신청 전
    },
    // 구글 로그인 화면으로 이동했다가 이 화면으로 돌아온다 / 구글로 로그인한 뒤 교사 가입 신청
    async signInGoogle() { const r = await signInWithGoogle(); if (r.error) throw new Error(r.error); },
    async applyTeacher(name, school) { const r = await applyTeacher(name, school); if (r.error) throw new Error(r.error); },
    async signIn(email, password) { const { error } = await db.auth.signInWithPassword({ email, password }); if (error) throw new Error('이메일 또는 비밀번호가 맞지 않습니다'); },
    async signUp(email, password, name, school) {
      const { error } = await db.auth.signUp({ email, password, options: { data: { name, school } } });
      if (error) throw new Error(error.message);
    },
    async signOut() { forgetAccount(); await db.auth.signOut(); },

    // ── 학급 · 학생 ──
    // 내 학급 (졸업생 아카이브는 빼고, 학년 · 반 순서로)
    async listClasses() {
      const rows = must(await db.from('classes').select('id, code, name, school, grade, class_no, students(count)').eq('archived', false).order('grade').order('class_no'));
      return rows.map((c) => ({ ...c, count: c.students?.[0]?.count ?? 0 }));
    },
    // 명렬표: 내 학급의 자리 [{ class_id, no, name, student_id(가입했으면), nickname, email }] / 반영 (계획은 planRoster 가 세운다)
    rosterList: async () => must(await db.rpc('roster_list')),
    rosterCommit: async (entries, drops) => must(await db.rpc('roster_commit', { p: { entries, drops } })),
    // 졸업 처리(학급 → ○○학년도 졸업생 아카이브) / 아카이브 목록 / 졸업생 한 명이 냈던 자료
    graduateClass: async (classId, year) => must(await db.rpc('graduate_class', { p_class: classId, p_year: year ?? null })),
    graduates: async () => must(await db.rpc('graduates')),
    graduateFiles: async (studentId) => must(await db.rpc('graduate_files', { p_student: studentId })),
    async createClass(school, grade, classNo) { return must(await db.rpc('create_class', { p_school: school, p_grade: grade, p_class_no: classNo })); },
    // 우리 반에 가입한 학생 [{ id, no, name, nickname, email(구글 계정), joined_at }]. 학생은 수업 공간에서 구글로 스스로 가입한다
    async listStudents(classId) { return must(await db.rpc('class_members', { p_class: classId })); },
    // 선물 아이템: 학급 학생들이 가진 아이템 { 학생 id: [아이템 id, …] } / 주기 · 거두기 (권한은 DB 가 확인: 담당 교사와 관리자만)
    async listItems(classId) {
      const ids = must(await db.from('students').select('id').eq('class_id', classId)).map((s) => s.id);
      const rows = ids.length ? must(await db.from('student_items').select('student_id, item_id').in('student_id', ids)) : [];
      const out = {}; for (const r of rows) (out[r.student_id] ??= []).push(r.item_id); return out;
    },
    async setItem(studentId, itemId, on) {
      if (on) must(await db.from('student_items').upsert({ student_id: studentId, item_id: itemId, granted_by: await myId() }, { onConflict: 'student_id,item_id', ignoreDuplicates: true }));
      else must(await db.from('student_items').delete().eq('student_id', studentId).eq('item_id', itemId));
    },
    // 훈장: 내가 만든 훈장 목록 / 만들기 · 고치기(id 가 있으면) / 지우기 / 학급 학생들이 받은 훈장 { 학생 id: [훈장 id] } / 주기 · 거두기
    async listMedals() { return must(await db.from('medals').select('id, name, kind, shape, metal, ribbon, name_color, effect').eq('teacher_id', await myId()).order('created_at')); },
    async saveMedal(m) {
      const row = pick(m, MEDAL_FIELDS);
      return m.id ? must(await db.from('medals').update(row).eq('id', m.id).select().single()) : must(await db.from('medals').insert(row).select().single());
    },
    async deleteMedal(id) { must(await db.from('medals').delete().eq('id', id)); },
    async listStudentMedals(classId) {
      const ids = must(await db.from('students').select('id').eq('class_id', classId)).map((s) => s.id);
      const rows = ids.length ? must(await db.from('student_medals').select('student_id, medal_id').in('student_id', ids).order('granted_at')) : [];
      const out = {}; for (const r of rows) (out[r.student_id] ??= []).push(r.medal_id); return out;
    },
    async setStudentMedal(studentId, medalId, on) {
      if (on) must(await db.from('student_medals').upsert({ student_id: studentId, medal_id: medalId, granted_by: await myId() }, { onConflict: 'student_id,medal_id', ignoreDuplicates: true }));
      else must(await db.from('student_medals').delete().eq('student_id', studentId).eq('medal_id', medalId));
    },
    // password = 선생님이 정하는 처음 비밀번호 (비우면 1234)
    async addStudents(classId, students, password) { return roster({ action: 'add', class_id: classId, students, password }); },
    async reissuePin(studentId, password) { return (await roster({ action: 'reissue', student_id: studentId, password })).card; },
    async removeStudent(studentId) { await roster({ action: 'remove', student_id: studentId }); },
    async deleteClass(classId, confirm) { return roster({ action: 'delete_class', class_id: classId, confirm }); },
    // 진급 · 반 바꾸기: 내 학급의 모든 학생 / 학생 옮기기 [{ studentId, classId, no }] (권한 · 번호 겹침은 DB 가 확인, 전부 되거나 전부 안 됨)
    async listAllStudents(classIds) {
      if (!classIds.length) return [];
      return must(await db.from('students').select('id, class_id, student_no, name').in('class_id', classIds)).map((s) => ({ id: s.id, classId: s.class_id, no: s.student_no, name: s.name }));
    },
    async moveStudents(moves) { return must(await db.rpc('move_students', { p_moves: moves.map((m) => ({ student_id: m.studentId, class_id: m.classId, no: m.no })) })); },

    // ── 전시실 ──
    async listRooms() {
      const uid = await myId();
      const mine = must(await db.from('rooms').select('*, artworks(count)').eq('owner_id', uid).order('created_at'));
      const shared = must(await db.from('room_editors').select('room_id').eq('teacher_id', uid)).map((e) => e.room_id);
      const others = shared.length ? must(await db.from('rooms').select('*, artworks(count)').in('id', shared)) : [];
      return [...mine.map((r) => withCount(r, true)), ...others.map((r) => withCount(r, false))];
    },
    async createRoom(input) { return must(await db.from('rooms').insert({ ...pick(input, ROOM_FIELDS), owner_id: await myId() }).select().single()); },
    async updateRoom(id, patch) { return must(await db.from('rooms').update(pick(patch, ROOM_FIELDS)).eq('id', id).select().single()); },
    async deleteRoom(id) { await removeRoomFiles(id); },           // 서버 함수가 파일과 전시실을 함께 지운다
    async getEntryCode(roomId) { return must(await db.from('room_secrets').select('entry_code').eq('room_id', roomId).maybeSingle())?.entry_code ?? ''; },
    async setEntryCode(roomId, code) {
      if (code) must(await db.from('room_secrets').upsert({ room_id: roomId, entry_code: code }));
      else must(await db.from('room_secrets').delete().eq('room_id', roomId));
    },
    // 학급 전용 전시실에 들어올 수 있는 학급
    async listRoomClasses(roomId) { return must(await db.from('room_classes').select('class_id').eq('room_id', roomId)).map((r) => r.class_id); },
    async setRoomClasses(roomId, classIds) {
      must(await db.from('room_classes').delete().eq('room_id', roomId));
      if (classIds.length) must(await db.from('room_classes').insert(classIds.map((class_id) => ({ room_id: roomId, class_id }))));
    },
    // 공동 담당 교사
    async teacherDirectory() { return must(await db.rpc('teacher_directory')); },
    async listEditors(roomId) {
      const ids = must(await db.from('room_editors').select('teacher_id').eq('room_id', roomId)).map((e) => e.teacher_id);
      return ids.length ? must(await db.from('profiles').select('id, name, school').in('id', ids)) : [];
    },
    async addEditor(roomId, teacherId) { must(await db.from('room_editors').insert({ room_id: roomId, teacher_id: teacherId })); },
    async removeEditor(roomId, teacherId) { must(await db.from('room_editors').delete().eq('room_id', roomId).eq('teacher_id', teacherId)); },

    // ── 작품 ──
    async listArtworks(roomId) { return must(await db.from('artworks').select('*').eq('room_id', roomId).order('slot')); },
    // 작품 줄을 먼저 만들고(자리 · 종류 규칙은 DB 가 확인) → 파일을 올린다. 올리기에 실패하면 만든 줄을 지운다
    async addArtwork(room, slot, kind, meta, file, thumb) {
      const row = must(await db.from('artworks').insert({ room_id: room.id, slot, kind, ...pick(meta, META), file_path: 'pending', file_size: 0 }).select().single());
      try { await uploadArtwork(row.id, file, thumb); }
      catch (e) { await db.from('artworks').delete().eq('id', row.id); throw e; }
      return must(await db.from('artworks').select('*').eq('id', row.id).single());
    },
    async updateArtwork(id, patch) { return must(await db.from('artworks').update(pick(patch, META)).eq('id', id).select().single()); },
    async moveArtwork(id, slot) { must(await db.rpc('move_artwork', { p_artwork: id, p_slot: slot })); },
    // 썸네일만 새로 올리기 (스플랫 작품의 대신 보여 줄 그림)
    async setThumbnail(artwork, file) {
      const key = await uploadFile(artwork.id, file, { thumb: true });
      await confirmUpload(artwork.id, artwork.file_path, key);
      return must(await db.from('artworks').select('*').eq('id', artwork.id).single());
    },
    async removeArtwork(id) { await removeArtworkFiles(id); },     // 서버 함수가 파일과 작품 줄을 함께 지운다

    // ── 운영 규칙 · 관리자 ──
    async getSettings() { return must(await db.from('app_settings').select('*').maybeSingle()) ?? { max_rooms_per_teacher: 3, default_limit_flat_mb: 100, default_limit_sculpture_mb: 300 }; },
    async saveSettings(patch) { must(await db.from('app_settings').update({ ...pick(patch, ['max_rooms_per_teacher', 'default_limit_flat_mb', 'default_limit_sculpture_mb']), updated_at: new Date().toISOString() }).eq('id', true)); },
    async adminOverview() { return must(await db.rpc('admin_overview')); },
    async setApproved(teacherId, approved) { must(await db.from('profiles').update({ approved }).eq('id', teacherId)); },
    async adminRooms() { return must(await db.from('rooms').select('id, title, type, visibility, blocked, blocked_reason, owner_id, storage_used_mb, storage_limit_mb').order('storage_used_mb', { ascending: false })); },
    async setBlocked(roomId, blocked, reason) { must(await db.from('rooms').update({ blocked, blocked_reason: blocked ? reason : null }).eq('id', roomId)); },
    async storageUsage() { const rows = must(await db.rpc('storage_usage')); return Array.isArray(rows) ? rows[0] : rows; },
    // 관리자 도구 (0017_admin_tools.sql)
    async adminTakeRoom(roomId) { must(await db.rpc('admin_take_room', { p_room: roomId })); },               // 전시실 한 개를 내 것으로
    async adminTakeOver(teacherId) { return must(await db.rpc('admin_take_over', { p_teacher: teacherId })); }, // 그 계정의 전시실 · 학급 등을 모두 내 것으로 → { rooms, classes }
    async adminRemoveTeacher(teacherId) { must(await db.rpc('admin_remove_teacher', { p_teacher: teacherId })); },
    async adminSetRole(teacherId, role) { must(await db.rpc('admin_set_role', { p_teacher: teacherId, p_role: role })); },
    async adminHandOver(teacherId) { must(await db.rpc('admin_hand_over', { p_teacher: teacherId })); },       // 그 사람을 관리자로, 나는 교사로
  };
}

/* ───────────── 연습 모드 (브라우저 안에서만) ───────────── */
function demoApi() {
  const classes = [], students = [], rooms = [], artworks = [], editors = [], codes = new Map(), roomClasses = new Map();
  const rosterRows = [], archive = [];        // 명렬표 자리 [{ class_id, no, name, student_id }] · 졸업생 아카이브
  const settings = { max_rooms_per_teacher: 3, default_limit_flat_mb: 100, default_limit_sculpture_mb: 300 };
  const teachers = [
    { teacher_id: 'me', name: '연습 교사', school: '연습초', role: 'admin', approved: true, email: 'me@example.com', created_at: '2026-11-01' },
    { teacher_id: 't2', name: '김선생', school: '한빛초', role: 'teacher', approved: true, email: 'kim@example.com', created_at: '2026-11-05' },
    { teacher_id: 't3', name: '이선생', school: '바다초', role: 'teacher', approved: false, email: 'lee@example.com', created_at: '2026-11-12' },
  ];
  const medals = [];
  const checkPw = (v) => { const p = String(v ?? '').trim() || '1234'; if (!/^\S{4,20}$/.test(p)) throw new Error('비밀번호는 빈칸 없이 4~20자로 정해 주세요'); return p; };
  const id = () => crypto.randomUUID();
  const usedMb = (roomId) => Math.round(artworks.filter((a) => a.room_id === roomId).reduce((s, a) => s + a.file_size, 0) / 1048576 * 100) / 100;
  const view = (r) => ({ ...r, storage_used_mb: usedMb(r.id), artwork_count: artworks.filter((a) => a.room_id === r.id).length, has_entry_code: codes.has(r.id), is_owner: true });
  return {
    mode: 'demo',
    async session() { return { id: 'me', email: '연습 모드', profile: { name: '연습 교사', role: 'admin', approved: true, school: '연습초' } }; },
    async signIn() {}, async signUp() {}, async signOut() {}, async signInGoogle() {}, async applyTeacher() {},
    async listClasses() { return classes.map((c) => ({ ...c, count: students.filter((s) => s.classId === c.id).length })); },
    async createClass(school, grade, classNo) {
      const base = `${schoolInitials(school)}-${grade}-${classNo}`; let code = base, i = 1;
      while (classes.some((c) => c.code === code)) code = `${base}-${++i}`;
      const c = { id: id(), code, name: `${grade}학년 ${classNo}반`, school, grade, class_no: classNo }; classes.unshift(c); return c;
    },
    async listStudents(classId) { return students.filter((s) => s.classId === classId).sort((a, b) => a.no - b.no); },
    async addStudents(classId, list, password) {
      const taken = list.filter((s) => students.some((x) => x.classId === classId && x.no === s.no)).map((s) => s.no);
      if (taken.length) throw new Error(`이미 등록된 번호입니다: ${taken.join(', ')}`);
      const p = checkPw(password);
      const cards = list.map((s) => { students.push({ id: id(), classId, no: s.no, name: s.name, nickname: '', lockedUntil: null, mustChange: true, pinIssuedAt: new Date().toISOString() }); return { no: s.no, name: s.name, pin: p }; });
      return { cards, failed: [], class_code: classes.find((c) => c.id === classId).code };
    },
    async reissuePin(studentId, password) { const p = checkPw(password), s = students.find((x) => x.id === studentId); s.pinIssuedAt = new Date().toISOString(); s.lockedUntil = null; s.mustChange = true; return { no: s.no, name: s.name, pin: p }; },
    async removeStudent(studentId) {
      students.splice(students.findIndex((x) => x.id === studentId), 1);
      for (const r of rosterRows) if (r.student_id === studentId) r.student_id = null;        // 자리는 남는다 → 다시 가입할 수 있다
      for (const g of archive) g.students = g.students.filter((s) => s.id !== studentId);
    },
    async listMedals() { return medals.map((m) => ({ ...m })); },
    async saveMedal(m) {
      if (!String(m.name ?? '').trim()) throw new Error('이름을 적어 주세요');
      if (m.id) { const old = medals.find((x) => x.id === m.id); Object.assign(old, pick(m, MEDAL_FIELDS)); return { ...old }; }
      if (medals.length >= 60) throw new Error('훈장과 아이템은 합쳐서 60개까지 만들 수 있습니다. 쓰지 않는 것을 지워 주세요');
      const made = { id: id(), ...pick(m, MEDAL_FIELDS) }; medals.push(made); return { ...made };
    },
    async deleteMedal(mid) { medals.splice(medals.findIndex((x) => x.id === mid), 1); for (const s of students) s.medals = (s.medals ?? []).filter((x) => x !== mid); },
    async listStudentMedals(classId) { return Object.fromEntries(students.filter((s) => s.classId === classId).map((s) => [s.id, [...(s.medals ?? [])]])); },
    async setStudentMedal(studentId, medalId, on) { const s = students.find((x) => x.id === studentId); s.medals = (s.medals ?? []).filter((i) => i !== medalId); if (on) s.medals.push(medalId); },
    async listItems(classId) { return Object.fromEntries(students.filter((s) => s.classId === classId).map((s) => [s.id, [...(s.items ?? [])]])); },
    async setItem(studentId, itemId, on) { const s = students.find((x) => x.id === studentId); s.items = (s.items ?? []).filter((i) => i !== itemId); if (on) s.items.push(itemId); },
    async deleteClass(classId, confirm) {
      const c = classes.find((x) => x.id === classId);
      if (confirm !== c.code) throw new Error('확인을 위해 학급 코드를 정확히 입력해 주세요');
      const n = students.filter((s) => s.classId === classId).length;
      for (let i = students.length - 1; i >= 0; i--) if (students[i].classId === classId) students.splice(i, 1);
      classes.splice(classes.indexOf(c), 1); return { deleted: n };
    },
    async listAllStudents(classIds) { return students.filter((s) => classIds.includes(s.classId)).map((s) => ({ id: s.id, classId: s.classId, no: s.no, name: s.name })); },
    // 명렬표 · 졸업 (연습 모드). '가입한 학생'을 흉내 내려면 demoJoin(classId, no) 을 부른다
    async rosterList() { return rosterRows.map((r) => { const s = students.find((x) => x.id === r.student_id); return { ...r, nickname: s?.nickname ?? null, email: s ? `student${s.no}@example.com` : null }; }); },
    async rosterCommit(entries, drops) {
      const moving = new Set(entries.map((e) => e.student_id).filter(Boolean));
      const clash = entries.find((e) => { const r = rosterRows.find((x) => x.class_id === e.class_id && x.no === e.no); return r?.student_id && !moving.has(r.student_id) && (e.student_id || normName(r.name) !== normName(e.name)); });
      if (clash) throw new Error(`이미 다른 학생이 가입해 있는 자리입니다: ${clash.no}번`);
      const gone = (r) => drops.some((d) => d.class_id === r.class_id && d.no === r.no && (!r.student_id || moving.has(r.student_id))) || (r.student_id && moving.has(r.student_id));
      for (let i = rosterRows.length - 1; i >= 0; i--) if (gone(rosterRows[i])) rosterRows.splice(i, 1);
      for (const e of entries) {
        if (e.student_id) Object.assign(students.find((s) => s.id === e.student_id), { classId: e.class_id, no: e.no, name: e.name });
        const i = rosterRows.findIndex((x) => x.class_id === e.class_id && x.no === e.no), sitting = students.find((s) => s.classId === e.class_id && s.no === e.no);
        const row = { class_id: e.class_id, no: e.no, name: e.name, student_id: e.student_id ?? sitting?.id ?? null };
        if (i >= 0) rosterRows[i] = row; else rosterRows.push(row);
      }
      for (let i = classes.length - 1; i >= 0; i--) { const c = classes[i]; if (drops.some((d) => d.class_id === c.id) && !students.some((s) => s.classId === c.id) && !rosterRows.some((r) => r.class_id === c.id)) classes.splice(i, 1); }
      return { entries: entries.length, moved: moving.size };
    },
    async demoJoin(classId, no) {
      const r = rosterRows.find((x) => x.class_id === classId && x.no === no);
      const s = { id: id(), classId, no, name: r.name, nickname: r.name.slice(-2) + '이', lockedUntil: null }; students.push(s); r.student_id = s.id; return s;
    },
    async graduateClass(classId, year) {
      const c = classes.find((x) => x.id === classId), y = year ?? new Date().getFullYear();
      let g = archive.find((a) => a.year === y); if (!g) archive.push(g = { class_id: id(), year: y, name: `${y}학년도 졸업생`, school: c.school, code: `GRAD-${y}`, students: [] });
      const leaving = students.filter((s) => s.classId === classId);
      for (const s of leaving) { g.students.push({ id: s.id, name: s.name, nickname: s.nickname, last_code: `${c.grade}${c.class_no}${String(s.no).padStart(2, '0')}`, email: `student${s.no}@example.com`, files: 0 }); students.splice(students.indexOf(s), 1); }
      for (let i = rosterRows.length - 1; i >= 0; i--) if (rosterRows[i].class_id === classId) rosterRows.splice(i, 1);
      classes.splice(classes.indexOf(c), 1);
      return { graduated: leaving.length, year: y };
    },
    async graduates() { return archive.map((g) => ({ ...g, students: [...g.students] })); },
    async graduateFiles() { return []; },
    async moveStudents(moves) {
      const moving = new Set(moves.map((m) => m.studentId));
      const taken = moves.find((m) => students.some((s) => s.classId === m.classId && s.no === m.no && !moving.has(s.id)));
      if (taken) throw new Error(`이미 다른 학생이 쓰고 있는 번호입니다: ${taken.no}번`);
      for (const m of moves) Object.assign(students.find((s) => s.id === m.studentId), { classId: m.classId, no: m.no });
      return moves.length;
    },

    async listRooms() { return rooms.map(view); },
    async createRoom(input) {
      if (rooms.length >= settings.max_rooms_per_teacher) throw new Error(`전시실은 한 사람당 ${settings.max_rooms_per_teacher}개까지 만들 수 있습니다. 쓰지 않는 전시실을 지우거나 관리자에게 문의해 주세요`);
      const r = { id: id(), owner_id: 'me', blocked: false, blocked_reason: null, guest_allowed: true, guest_avatar_mode: 'base', max_guests: 20, max_visitors: 35,
        storage_limit_mb: input.type === 'flat' ? settings.default_limit_flat_mb : settings.default_limit_sculpture_mb, ...pick(input, ROOM_FIELDS) };
      rooms.push(r); return view(r);
    },
    async updateRoom(rid, patch) {
      const r = rooms.find((x) => x.id === rid), n = artworks.filter((a) => a.room_id === rid), top = Math.max(0, ...n.map((a) => a.slot));
      if (patch.max_artworks < n.length) throw new Error(`작품이 ${n.length}개 있어서 최대 작품 수를 ${patch.max_artworks}개로 줄일 수 없습니다`);
      if (patch.max_artworks < top) throw new Error(`${top}번 자리에 작품이 있어서 최대 작품 수를 ${patch.max_artworks}개로 줄일 수 없습니다. 작품을 앞 번호 자리로 옮긴 뒤 줄여 주세요`);
      Object.assign(r, pick(patch, ROOM_FIELDS)); return view(r);
    },
    async deleteRoom(rid) { for (let i = artworks.length - 1; i >= 0; i--) if (artworks[i].room_id === rid) artworks.splice(i, 1); rooms.splice(rooms.findIndex((x) => x.id === rid), 1); },
    async getEntryCode(rid) { return codes.get(rid) ?? ''; },
    async setEntryCode(rid, code) { if (code) codes.set(rid, code); else codes.delete(rid); },
    async listRoomClasses(rid) { return roomClasses.get(rid) ?? []; },
    async setRoomClasses(rid, ids) { roomClasses.set(rid, [...ids]); },
    async setThumbnail(artwork, file) { const a = artworks.find((x) => x.id === artwork.id); a.thumbnail_path = URL.createObjectURL(file); return a; },
    async teacherDirectory() { return teachers.filter((t) => t.approved && t.teacher_id !== 'me'); },
    async listEditors(rid) { return editors.filter((e) => e.room === rid).map((e) => { const t = teachers.find((x) => x.teacher_id === e.teacher); return { id: t.teacher_id, name: t.name, school: t.school }; }); },
    async addEditor(rid, tid) { if (!editors.some((e) => e.room === rid && e.teacher === tid)) editors.push({ room: rid, teacher: tid }); },
    async removeEditor(rid, tid) { const i = editors.findIndex((e) => e.room === rid && e.teacher === tid); if (i >= 0) editors.splice(i, 1); },

    async listArtworks(rid) { return artworks.filter((a) => a.room_id === rid).sort((a, b) => a.slot - b.slot); },
    async addArtwork(room, slot, kind, meta, file, thumb) {
      const r = rooms.find((x) => x.id === room.id), list = artworks.filter((a) => a.room_id === r.id);
      if (!KIND_OF_TYPE[r.type].includes(kind)) throw new Error(r.type === 'flat' ? '평면 전용 전시실에는 그림만 등록할 수 있습니다' : '입체 전용 전시실에는 입체 작품만 등록할 수 있습니다');
      if (r.type === 'mixed' && (kind === 'image') !== (slot <= (r.theme?.flatCount ?? 0))) throw new Error(kind === 'image' ? '그림은 벽 자리에만 걸 수 있습니다' : '입체 작품은 받침대 자리에만 놓을 수 있습니다');
      if (list.length >= r.max_artworks) throw new Error(`이 전시실에는 작품을 ${r.max_artworks}개까지만 등록할 수 있습니다`);
      if (list.some((a) => a.slot === slot)) throw new Error(`${slot}번 자리에 이미 작품이 있습니다`);
      const size = file.size + (thumb?.size ?? 0);
      if (usedMb(r.id) + size / 1048576 > r.storage_limit_mb) throw new Error(`전시실 용량 한도(${r.storage_limit_mb}MB)를 넘습니다`);
      const a = { id: id(), room_id: r.id, slot, kind, title: '', artist: '', grade: '', material: '', description: '', size_cm: {}, adjust: {}, ...pick(meta, META),
        file_path: URL.createObjectURL(file), thumbnail_path: thumb ? URL.createObjectURL(thumb) : null, file_size: size };
      artworks.push(a); return a;
    },
    async updateArtwork(aid, patch) { const a = artworks.find((x) => x.id === aid); Object.assign(a, pick(patch, META)); return a; },
    async moveArtwork(aid, slot) {
      const a0 = artworks.find((x) => x.id === aid), r0 = rooms.find((x) => x.id === a0.room_id), fc = r0.theme?.flatCount ?? 0;
      if (r0.type === 'mixed' && (a0.slot <= fc) !== (slot <= fc)) throw new Error('그림은 벽 자리끼리, 입체 작품은 받침대 자리끼리만 옮길 수 있습니다');
      const a = a0, other = artworks.find((x) => x.room_id === a.room_id && x.slot === slot); if (other) other.slot = a.slot; a.slot = slot;
    },
    async removeArtwork(aid) { artworks.splice(artworks.findIndex((x) => x.id === aid), 1); },

    async getSettings() { return { ...settings }; },
    async saveSettings(patch) { Object.assign(settings, patch); },
    async adminOverview() {
      return teachers.map((t) => ({ ...t, room_count: t.teacher_id === 'me' ? rooms.length : 0, used_mb: t.teacher_id === 'me' ? rooms.reduce((s, r) => s + usedMb(r.id), 0) : 0, artwork_count: t.teacher_id === 'me' ? artworks.length : 0 }));
    },
    async setApproved(tid, approved) { teachers.find((t) => t.teacher_id === tid).approved = approved; },
    async adminRooms() { return rooms.map(view); },
    async setBlocked(rid, blocked, reason) { Object.assign(rooms.find((r) => r.id === rid), { blocked, blocked_reason: blocked ? reason : null }); },
    async adminTakeRoom(rid) { rooms.find((r) => r.id === rid).owner_id = 'me'; },
    async adminTakeOver() { return { rooms: 0, classes: 0 }; },
    async adminRemoveTeacher(tid) { if (tid === 'me') throw new Error('지금 로그인한 내 계정은 지울 수 없습니다'); teachers.splice(teachers.findIndex((t) => t.teacher_id === tid), 1); },
    async adminSetRole(tid, role) {
      if (role === 'teacher' && !teachers.some((t) => t.role === 'admin' && t.approved && t.teacher_id !== tid)) throw new Error('관리자가 한 명은 있어야 합니다. 먼저 다른 사람을 관리자로 지정해 주세요');
      teachers.find((t) => t.teacher_id === tid).role = role;
    },
    async adminHandOver(tid) { teachers.find((t) => t.teacher_id === tid).role = 'admin'; teachers.find((t) => t.teacher_id === 'me').role = 'teacher'; },
    async storageUsage() {
      const used = Math.round(artworks.reduce((s, a) => s + a.file_size, 0) / 1048576 * 100) / 100;
      return { used_mb: used, stored_mb: used, free_limit_mb: 1024, percent: Math.round(used / 1024 * 1000) / 10, room_count: rooms.length, artwork_count: artworks.length };
    },
  };
}

export const isDemo = () => !backendEnabled() || new URLSearchParams(location.search).has('demo');
export const createApi = () => (isDemo() ? Promise.resolve(demoApi()) : serverApi());
