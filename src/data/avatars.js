// 캐릭터 저장 · 불러오기 · 공유
//   학생 · 교사 → Supabase avatars 표 (저장은 서버 함수 save-avatar 가 검사한 뒤 수행) → 어느 기기에서든 유지
//   게스트      → 그 기기의 브라우저에만 저장 (src/character/config.js). 서버에는 저장하지 않는다
import { getClient } from './backend.js';
import { currentAccount } from './student-auth.js';
// 서버에 저장하는 계정(학생 · 승인받은 교사). 게스트는 null → 브라우저에만 저장
const currentUser = async () => { const a = await currentAccount(); return a.kind === 'guest' ? null : a; };
import { encodeAvatar, decodeAvatar } from '../character/voxel/codec.js';
import { validateAvatar, stripEdits } from '../character/voxel/validate.js';
import { saveConfig, normalizeConfig } from '../character/config.js';

// 서버 함수가 돌려준 오류 내용을 읽어 문장으로
async function functionError(error) {
  try { const body = await error.context.json(); return [body.error, ...(body.errors ?? [])].filter(Boolean).join('\n'); }
  catch { return error.message || '서버에 연결하지 못했습니다'; }
}

// 저장. 반환: { where: 'server' | 'local', error?: 문장 }
// 브라우저에는 항상 저장하고, 로그인한 학생이면 서버에도 저장한다.
export async function saveMyAvatar(config) {
  saveConfig(config);
  const user = await currentUser().catch(() => null);
  if (!user) return { where: 'local' };
  const client = await getClient();
  const { error } = await client.functions.invoke('save-avatar', { body: { data: encodeAvatar(config), nickname: config.nickname } });
  return error ? { where: 'local', error: await functionError(error) } : { where: 'server' };
}

// 로그인한 학생의 서버 캐릭터 불러오기. 없거나 로그인 전이면 null
// 반환: { config(닉네임 제외), reset: { reason, at } | null }  — reset 은 교사가 초기화한 경우
export async function loadMyAvatar() {
  const user = await currentUser().catch(() => null);
  if (!user) return null;
  const client = await getClient();
  const { data, error } = await client.from('avatars').select('data, reset_at, reset_reason').eq('student_id', user.id).maybeSingle();
  if (error || !data) return null;
  try { return { config: decodeAvatar(data.data), reset: data.reset_reason ? { reason: data.reset_reason, at: data.reset_at } : null }; }
  catch { return null; }
}

// 다른 학생의 캐릭터 (멀티플레이에서 입장할 때 한 번만 받음). 같은 학생·같은 수정 시각이면 다시 받지 않는다
const cache = new Map();
export function fetchAvatar(studentId, version = '') {
  const key = studentId + '@' + version;
  if (!cache.has(key))
    cache.set(key, (async () => {
      const client = await getClient();
      if (!client) return null;
      const { data } = await client.from('avatar_public').select('data').eq('student_id', studentId).maybeSingle();
      return data ? safeDecode(data.data) : null;
    })().catch(() => null));
  return cache.get(key);
}

// 받은 캐릭터 문자열 → 설정. 규칙에 어긋나면 추가 픽셀 · 색칠을 빼고 색만 사용, 읽을 수 없으면 null
export function safeDecode(text) {
  try {
    const cfg = decodeAvatar(text);
    return normalizeConfig(validateAvatar(cfg).length ? stripEdits(cfg) : cfg);
  } catch { return null; }
}

// 교사: 학생 캐릭터의 추가 픽셀 · 색칠을 초기화하고 사유를 남긴다. 반환: { ok } | { error }
export async function resetAvatar(studentId, reason) {
  const client = await getClient();
  if (!client) return { error: '서버에 연결되어 있지 않습니다' };
  const { error } = await client.functions.invoke('reset-avatar', { body: { student_id: studentId, reason } });
  return error ? { error: await functionError(error) } : { ok: true };
}
