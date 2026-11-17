// 지금 접속한 사람이 누구인지(게스트 · 학생 · 교사)와 학생 로그인 · 로그아웃
//   게스트: 로그인 없음. 서버가 연결돼 있으면 눈에 안 보이는 '익명 로그인'으로 임시 ID 만 받는다
//   학생  : 학번(학년+반+번호, 예: 20315) + PIN (서버 함수 student-login 이 확인하고 세션 발급. 이메일은 쓰지 않는다)
//   교사  : 교사용 화면(teacher.html)에서 이메일로 로그인. 같은 브라우저면 미술관에서도 교사로 인식한다
import { backendEnabled, getClient, ensureSession } from './backend.js';

const INFO_KEY = 'vmuseum.student';        // 화면 표시용 정보(닉네임 · 번호 · 학급 이름). 로그인 자체는 Supabase 가 따로 기억한다

// 지금 계정: { kind: 'guest' | 'student' | 'teacher', id }  (id 는 게스트의 임시 ID 일 수도, 없을 수도 있음)
export async function currentAccount() {
  const client = await getClient().catch(() => null);
  if (!client) return { kind: 'guest', id: null };
  const { data } = await client.auth.getSession();
  const user = data.session?.user;
  if (!user || user.is_anonymous) return { kind: 'guest', id: user?.id ?? null };
  if (user.user_metadata?.kind === 'student') return { kind: 'student', id: user.id };
  const { data: profile } = await client.from('profiles').select('approved, name').eq('id', user.id).maybeSingle();
  return profile?.approved ? { kind: 'teacher', id: user.id, name: profile.name } : { kind: 'guest', id: user.id };     // 승인 전 교사는 게스트와 같게
}

// 학생 로그인. 성공하면 { student }, 실패하면 { error: 학생에게 보여 줄 문장 }
// classCode 는 같은 학번이 다른 학급에도 있어 서버가 물어볼 때만 보낸다 (그때 { needClass: true } 가 함께 온다)
export async function loginStudent(studentCode, pin, classCode = '') {
  if (!backendEnabled()) return { error: '아직 서버에 연결되어 있지 않아 로그인할 수 없어요' };
  const client = await getClient();
  const { data, error } = await client.functions.invoke('student-login', { body: { student_code: String(studentCode), pin, class_code: classCode || undefined } });
  if (error) {
    try { const b = await error.context.json(); return { error: b.error || '로그인하지 못했어요', needClass: !!b.need_class }; }
    catch { return { error: '서버에 연결하지 못했어요. 잠시 뒤 다시 해 보세요' }; }
  }
  // 게스트의 임시 ID 를 학생 계정으로 바꾼다
  const { error: sessionError } = await client.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
  if (sessionError) return { error: '로그인하지 못했어요. 다시 해 보세요' };
  try { localStorage.setItem(INFO_KEY, JSON.stringify(data.student)); } catch { /* 무시 */ }
  return { student: data.student };
}

// 화면 표시용 학생 정보를 이 기기에 기억해 둔다 (별명을 바꿨을 때 다음 접속에도 새 별명이 보이게)
export function rememberStudent(info) {
  try { localStorage.setItem(INFO_KEY, JSON.stringify(info)); } catch { /* 무시 */ }
}

// 로그인한 학생이 자기 비밀번호를 바꾼다. 성공하면 { ok: true }, 실패하면 { error }
export async function changeStudentPassword(current, next) {
  const client = await getClient();
  if (!client) return { error: '아직 서버에 연결되어 있지 않아요' };
  const { error } = await client.functions.invoke('student-login', { body: { action: 'change', current, next } });
  if (error) {
    try { return { error: (await error.context.json()).error || '비밀번호를 바꾸지 못했어요' }; }
    catch { return { error: '서버에 연결하지 못했어요. 잠시 뒤 다시 해 보세요' }; }
  }
  return { ok: true };
}

// 로그아웃하면 다시 게스트가 된다 (새 임시 ID 를 조용히 받음)
export async function logoutStudent() {
  try { localStorage.removeItem(INFO_KEY); } catch { /* 무시 */ }
  const client = await getClient();
  await client?.auth.signOut();
  client?.auth.signInAnonymously().catch(() => {});
}

// 지금 로그인한 학생 정보 (학생이 아니면 null)
export async function currentStudent() {
  const account = await currentAccount();
  if (account.kind !== 'student') return null;
  try { const info = JSON.parse(localStorage.getItem(INFO_KEY)); if (info?.id === account.id) return info; } catch { /* 아래에서 다시 읽음 */ }
  const client = await getClient();
  const { data: row } = await client.from('students').select('id, nickname, student_no, classes(name, code)').eq('id', account.id).maybeSingle();
  return row ? { id: row.id, nickname: row.nickname, student_no: row.student_no, class_name: row.classes?.name ?? '', class_code: row.classes?.code ?? '' } : null;
}

export { ensureSession };
