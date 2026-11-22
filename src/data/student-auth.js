// 지금 접속한 사람이 누구인지(게스트 · 학생 · 교사)와 구글 로그인 · 가입 · 로그아웃
//   게스트: 로그인 없음. 서버가 연결돼 있으면 눈에 안 보이는 '익명 로그인'으로 임시 ID 만 받는다
//   학생  : 구글로 로그인하고, 처음에 학번 · 이름 · 별명을 적어 가입한다. 화면에는 별명만 보인다
//   교사  : 구글(또는 예전 이메일 계정)로 로그인하고, 관리자의 승인을 받는다
// 로그인은 '수업 공간'(포털)에서 한다. 같은 사이트 안이라 가상미술관 · 아틀리에에서도 로그인이 이어진다.
import { backendEnabled, getClient, ensureSession } from './backend.js';

// 서버에 "나는 누구인가요?"(whoami) 를 물어본 답을 로그인한 사람별로 한 번만 받아 둔다
let asked = { userId: null, answer: null };
export function forgetAccount() { asked = { userId: null, answer: null }; }

// 지금 계정: { kind: 'guest' | 'student' | 'teacher', id, … }
//   학생: nickname            교사: name, role
//   게스트인데 구글로 로그인은 한 상태면 signedIn = true 이고, unregistered(가입 전) 또는 pending(교사 승인 대기) 가 함께 온다
export async function currentAccount() {
  const client = await getClient().catch(() => null);
  if (!client) return { kind: 'guest', id: null };
  const { data } = await client.auth.getSession();
  const user = data.session?.user;
  if (!user || user.is_anonymous) return { kind: 'guest', id: user?.id ?? null };
  if (asked.userId !== user.id) asked = { userId: user.id, answer: client.rpc('whoami').then(({ data: who, error }) => (error ? null : who)) };
  const who = await asked.answer;
  if (!who) { forgetAccount(); return { kind: 'guest', id: user.id }; }             // 서버에 묻지 못했으면 게스트로 (다음에 다시 묻는다)
  if (who.kind === 'student') return { kind: 'student', id: user.id, nickname: who.nickname ?? '' };
  if (who.kind === 'teacher') return { kind: 'teacher', id: user.id, name: who.name ?? '', role: who.role };
  if (who.kind === 'guest') return { kind: 'guest', id: user.id };
  return { kind: 'guest', id: user.id, signedIn: true, unregistered: who.kind === 'new', pending: who.kind === 'pending', name: who.name ?? '', googleName: user.user_metadata?.full_name ?? '' };
}

// 구글 로그인 화면으로 이동한다. 로그인하면 redirectTo(기본: 지금 화면)로 돌아온다
export async function signInWithGoogle(redirectTo = location.origin + location.pathname + location.search) {
  if (!backendEnabled()) return { error: '아직 서버에 연결되어 있지 않아 로그인할 수 없어요' };
  const client = await getClient();
  const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { prompt: 'select_account' } } });
  return error ? { error: '구글 로그인 화면을 열지 못했어요. 잠시 뒤 다시 해 보세요' } : {};
}

// 학생 가입: 학번 · 이름 · 별명 (같은 학번의 학급이 여러 개일 때만 학급 코드). 성공하면 { ok }, 실패하면 { error }
export async function signUpStudent(studentCode, name, nickname, classCode = '') {
  const client = await getClient();
  if (!client) return { error: '아직 서버에 연결되어 있지 않아요' };
  const { error } = await client.rpc('student_signup', { p_code: String(studentCode), p_name: name, p_nickname: nickname, p_class_code: classCode || null });
  forgetAccount();
  return error ? { error: error.message || '가입하지 못했어요. 잠시 뒤 다시 해 보세요' } : { ok: true };
}
// 교사 신청: 이름 · 학교. 관리자가 승인하면 교사가 된다
export async function applyTeacher(name, school) {
  const client = await getClient();
  if (!client) return { error: '아직 서버에 연결되어 있지 않아요' };
  const { error } = await client.rpc('teacher_apply', { p_name: name, p_school: school });
  forgetAccount();
  return error ? { error: error.message || '신청하지 못했어요. 잠시 뒤 다시 해 보세요' } : { ok: true };
}

// 로그아웃 (수업 공간 · 아틀리에에서 사용)
export async function signOut() {
  forgetAccount();
  const client = await getClient();
  await client?.auth.signOut();
}
// 미술관에서 로그아웃하면 다시 게스트가 된다 (새 임시 ID 를 조용히 받음)
export async function logoutStudent() {
  await signOut();
  const client = await getClient();
  client?.auth.signInAnonymously().catch(() => {});
}

// 지금 로그인한 학생 { id, nickname } (학생이 아니면 null). 학번 · 이름은 화면으로 가져오지 않는다
export async function currentStudent() {
  const account = await currentAccount();
  return account.kind === 'student' ? { id: account.id, nickname: account.nickname } : null;
}
// 별명을 바꿨을 때: 다음에 물어볼 때 새 별명을 받도록 기억을 지운다
export function rememberStudent() { forgetAccount(); }

export { ensureSession };
