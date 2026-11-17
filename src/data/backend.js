// Supabase 연결. 아래 두 값을 채우면 서버 저장과 실제 멀티플레이가 켜진다.
// 비워 두면: 캐릭터는 브라우저에만 저장되고, 멀티플레이는 같은 브라우저의 탭끼리만 연결된다(시험용).
//
// 값 위치: Supabase 대시보드 → Project Settings → API Keys
//   ※ 'Secret keys' 는 절대 여기에 넣지 않는다. (서버 함수에서만 사용)
export const SUPABASE_URL = 'https://tizvsfquglhefuhqjzdp.supabase.co';
// ↓ 'Publishable key' (sb_publishable_ 로 시작하는 한 줄)를 따옴표 안에 붙여 넣는다. 공개해도 되는 열쇠다.
export const SUPABASE_ANON_KEY = 'sb_publishable_0adsPL0-oozb4GWTbGfHCw_taSuQ9wy';

export const backendEnabled = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);

let clientPromise = null;
// Supabase 클라이언트 (설정이 없으면 null). 처음 필요할 때만 라이브러리를 내려받는다
export function getClient() {
  if (!backendEnabled()) return Promise.resolve(null);
  return (clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY)));
}

// 게스트용 임시 ID 받기: 로그인한 적이 없으면 '익명 로그인'을 조용히 한다. (화면에는 아무것도 보이지 않음)
// 멀티플레이와 보안 규칙이 "누구인지"를 구분할 수 있게 하기 위한 것이고, 실패해도 관람은 그대로 할 수 있다.
// (대시보드 Authentication → Sign In / Providers 에서 Anonymous sign-ins 를 켜야 동작)
let guestPromise = null;
export function ensureSession() {
  if (!backendEnabled()) return Promise.resolve(null);
  return (guestPromise ??= (async () => {
    const client = await getClient();
    const { data } = await client.auth.getSession();
    if (data.session) return data.session.user;
    const { data: signed, error } = await client.auth.signInAnonymously();
    if (error) { console.warn('게스트 임시 ID 를 받지 못했습니다 (관람은 가능):', error.message); return null; }
    return signed.user;
  })().catch(() => null));
}

// 지금 로그인한 사용자 (게스트의 임시 ID 포함. 없으면 null)
export async function currentUser() {
  const client = await getClient();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session?.user ?? null;
}
