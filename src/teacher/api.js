// 교사용 · 관리자용 화면이 쓰는 기능 모음.
//   Supabase 설정이 있으면(src/data/backend.js) → 실제 서버
//   없거나 주소에 ?demo 가 붙으면 → 연습 모드: 브라우저 안에서만 흉내 낸다 (저장되지 않고, 새로고침하면 사라짐)
//
// 전시실 · 작품은 DB 의 열 이름 그대로 다룬다 (rooms: title, type 'flat' | 'sculpture', max_artworks, visibility, … /
// artworks: slot, kind, title, artist, grade, material, size_cm, description, file_path, thumbnail_path, file_size, adjust)
import { backendEnabled, getClient } from '../data/backend.js';
import { uploadArtwork, uploadFile, confirmUpload, deleteArtwork as removeArtworkFiles, deleteRoom as removeRoomFiles } from '../data/storage.js';

export const KIND_OF_TYPE = { flat: ['image'], sculpture: ['model', 'splat'] };

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

async function fnError(error) {
  try { const b = await error.context.json(); return new Error(b.error || error.message); } catch { return new Error(error.message || '서버에 연결하지 못했습니다'); }
}
const META = ['title', 'artist', 'grade', 'material', 'description', 'size_cm', 'adjust'];
const pick = (src, keys) => Object.fromEntries(keys.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));
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
      return { id: user.id, email: user.email, profile };
    },
    async signIn(email, password) { const { error } = await db.auth.signInWithPassword({ email, password }); if (error) throw new Error('이메일 또는 비밀번호가 맞지 않습니다'); },
    async signUp(email, password, name, school) {
      const { error } = await db.auth.signUp({ email, password, options: { data: { name, school } } });
      if (error) throw new Error(error.message);
    },
    async signOut() { await db.auth.signOut(); },

    // ── 학급 · 학생 ──
    async listClasses() {
      const rows = must(await db.from('classes').select('id, code, name, school, grade, class_no, students(count)').order('created_at', { ascending: false }));
      return rows.map((c) => ({ ...c, count: c.students?.[0]?.count ?? 0 }));
    },
    async createClass(school, grade, classNo) { return must(await db.rpc('create_class', { p_school: school, p_grade: grade, p_class_no: classNo })); },
    async listStudents(classId) {
      const students = must(await db.from('students').select('id, student_no, name, nickname').eq('class_id', classId).order('student_no'));
      const status = must(await db.from('student_status').select('student_id, locked_until, pin_issued_at, must_change').eq('class_id', classId));
      const byId = new Map(status.map((s) => [s.student_id, s]));
      return students.map((s) => ({ id: s.id, no: s.student_no, name: s.name, nickname: s.nickname, lockedUntil: byId.get(s.id)?.locked_until ?? null, pinIssuedAt: byId.get(s.id)?.pin_issued_at ?? null, mustChange: !!byId.get(s.id)?.must_change }));
    },
    // password = 선생님이 정하는 처음 비밀번호 (비우면 1234)
    async addStudents(classId, students, password) { return roster({ action: 'add', class_id: classId, students, password }); },
    async reissuePin(studentId, password) { return (await roster({ action: 'reissue', student_id: studentId, password })).card; },
    async removeStudent(studentId) { await roster({ action: 'remove', student_id: studentId }); },
    async deleteClass(classId, confirm) { return roster({ action: 'delete_class', class_id: classId, confirm }); },

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
  };
}

/* ───────────── 연습 모드 (브라우저 안에서만) ───────────── */
function demoApi() {
  const classes = [], students = [], rooms = [], artworks = [], editors = [], codes = new Map(), roomClasses = new Map();
  const settings = { max_rooms_per_teacher: 3, default_limit_flat_mb: 100, default_limit_sculpture_mb: 300 };
  const teachers = [
    { teacher_id: 'me', name: '연습 교사', school: '연습초', role: 'admin', approved: true, email: 'me@example.com', created_at: '2026-11-01' },
    { teacher_id: 't2', name: '김선생', school: '한빛초', role: 'teacher', approved: true, email: 'kim@example.com', created_at: '2026-11-05' },
    { teacher_id: 't3', name: '이선생', school: '바다초', role: 'teacher', approved: false, email: 'lee@example.com', created_at: '2026-11-12' },
  ];
  const checkPw = (v) => { const p = String(v ?? '').trim() || '1234'; if (!/^\S{4,20}$/.test(p)) throw new Error('비밀번호는 빈칸 없이 4~20자로 정해 주세요'); return p; };
  const id = () => crypto.randomUUID();
  const usedMb = (roomId) => Math.round(artworks.filter((a) => a.room_id === roomId).reduce((s, a) => s + a.file_size, 0) / 1048576 * 100) / 100;
  const view = (r) => ({ ...r, storage_used_mb: usedMb(r.id), artwork_count: artworks.filter((a) => a.room_id === r.id).length, has_entry_code: codes.has(r.id), is_owner: true });
  return {
    mode: 'demo',
    async session() { return { id: 'me', email: '연습 모드', profile: { name: '연습 교사', role: 'admin', approved: true, school: '연습초' } }; },
    async signIn() {}, async signUp() {}, async signOut() {},
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
    async removeStudent(studentId) { students.splice(students.findIndex((x) => x.id === studentId), 1); },
    async deleteClass(classId, confirm) {
      const c = classes.find((x) => x.id === classId);
      if (confirm !== c.code) throw new Error('확인을 위해 학급 코드를 정확히 입력해 주세요');
      const n = students.filter((s) => s.classId === classId).length;
      for (let i = students.length - 1; i >= 0; i--) if (students[i].classId === classId) students.splice(i, 1);
      classes.splice(classes.indexOf(c), 1); return { deleted: n };
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
      if (list.length >= r.max_artworks) throw new Error(`이 전시실에는 작품을 ${r.max_artworks}개까지만 등록할 수 있습니다`);
      if (list.some((a) => a.slot === slot)) throw new Error(`${slot}번 자리에 이미 작품이 있습니다`);
      const size = file.size + (thumb?.size ?? 0);
      if (usedMb(r.id) + size / 1048576 > r.storage_limit_mb) throw new Error(`전시실 용량 한도(${r.storage_limit_mb}MB)를 넘습니다`);
      const a = { id: id(), room_id: r.id, slot, kind, title: '', artist: '', grade: '', material: '', description: '', size_cm: {}, adjust: {}, ...pick(meta, META),
        file_path: URL.createObjectURL(file), thumbnail_path: thumb ? URL.createObjectURL(thumb) : null, file_size: size };
      artworks.push(a); return a;
    },
    async updateArtwork(aid, patch) { const a = artworks.find((x) => x.id === aid); Object.assign(a, pick(patch, META)); return a; },
    async moveArtwork(aid, slot) { const a = artworks.find((x) => x.id === aid), other = artworks.find((x) => x.room_id === a.room_id && x.slot === slot); if (other) other.slot = a.slot; a.slot = slot; },
    async removeArtwork(aid) { artworks.splice(artworks.findIndex((x) => x.id === aid), 1); },

    async getSettings() { return { ...settings }; },
    async saveSettings(patch) { Object.assign(settings, patch); },
    async adminOverview() {
      return teachers.map((t) => ({ ...t, room_count: t.teacher_id === 'me' ? rooms.length : 0, used_mb: t.teacher_id === 'me' ? rooms.reduce((s, r) => s + usedMb(r.id), 0) : 0, artwork_count: t.teacher_id === 'me' ? artworks.length : 0 }));
    },
    async setApproved(tid, approved) { teachers.find((t) => t.teacher_id === tid).approved = approved; },
    async adminRooms() { return rooms.map(view); },
    async setBlocked(rid, blocked, reason) { Object.assign(rooms.find((r) => r.id === rid), { blocked, blocked_reason: blocked ? reason : null }); },
    async storageUsage() {
      const used = Math.round(artworks.reduce((s, a) => s + a.file_size, 0) / 1048576 * 100) / 100;
      return { used_mb: used, stored_mb: used, free_limit_mb: 1024, percent: Math.round(used / 1024 * 1000) / 10, room_count: rooms.length, artwork_count: artworks.length };
    },
  };
}

export const isDemo = () => !backendEnabled() || new URLSearchParams(location.search).has('demo');
export const createApi = () => (isDemo() ? Promise.resolve(demoApi()) : serverApi());
