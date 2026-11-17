// 파일 저장소: 작품 파일(이미지 · GLB · 스플랫 · 썸네일)을 읽고, 올리고, 지우는 곳.
// 저장소에 관한 코드는 이 파일에만 둔다. 저장소를 바꾸려면 이 파일(과 서버 함수 storage-files)만 고치면 된다.
// 지금 저장소: Supabase Storage 의 'artworks' 버킷 (Supabase 가 연결되지 않았으면 프로젝트 폴더의 샘플 파일)
//
// 읽기  : 버킷의 공개 주소에서 바로 읽는다 (관람자는 로그인 없이 작품을 본다)
// 올리기: 브라우저에는 쓰기 권한이 없다. 서버 함수가 권한과 한도를 확인한 뒤 내주는 '업로드용 서명 주소'로 올린다
//          ① 주소 받기(upload_url) → ② 그 주소로 파일 보내기 → ③ 완료 알리기(confirm: 서버가 실제 크기를 재서 DB 에 기록)
// 경로 규칙: rooms/{전시실 id}/{작품 id}.확장자      썸네일: rooms/{전시실 id}/thumbs/{작품 id}.확장자
import { getClient, backendEnabled, SUPABASE_URL } from './backend.js';

const BUCKET = 'artworks';
const LOCAL_BASE = 'assets/rooms';
const safePath = (path) => path.split('/').map(encodeURIComponent).join('/');

// 작품 정보에 적힌 파일 경로 → 불러올 주소
export function fileUrl(roomId, path) {
  if (typeof path !== 'string' || !path) return '';
  if (/^(data:|blob:|https?:\/\/|\/)/.test(path) || path.startsWith(LOCAL_BASE + '/')) return path;    // 이미 완성된 주소
  if (path.startsWith('rooms/') && backendEnabled()) return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${safePath(path)}`;   // 저장소의 파일
  return `${LOCAL_BASE}/${encodeURIComponent(roomId)}/${safePath(path)}`;      // 샘플 파일
}

// 서버 함수 storage-files 부르기. 오류는 교사에게 보여 줄 문장으로 던진다
async function call(body) {
  const client = await getClient();
  if (!client) throw new Error('서버에 연결되어 있지 않습니다');
  const { data, error } = await client.functions.invoke('storage-files', { body });
  if (!error) return data;
  let message = '서버에 연결하지 못했습니다';
  try { message = (await error.context.json()).error || message; } catch { /* 기본 문장 사용 */ }
  throw new Error(message);
}
const extOf = (file) => (file.name.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? '').toLowerCase();

// 파일 하나를 저장소에 올린다 → 저장 경로(key). (아직 DB 에는 기록되지 않는다. 다 올린 뒤 confirmUpload 를 부른다)
export async function uploadFile(artworkId, file, { thumb = false } = {}) {
  const { key, token } = await call({ action: 'upload_url', artwork_id: artworkId, ext: extOf(file), size: file.size, thumb });
  const client = await getClient();
  const { error } = await client.storage.from(BUCKET).uploadToSignedUrl(key, token, file, { upsert: true, contentType: file.type || 'application/octet-stream' });
  if (error) throw new Error('파일을 올리지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요. (' + error.message + ')');
  return key;
}

// 업로드 완료 알리기: 서버가 실제 파일 크기를 확인해 DB 에 기록하고 전시실 사용 용량을 갱신한다
//   반환: { file_size, storage_used_mb, storage_limit_mb }.  한도를 넘으면 서버가 올린 파일을 지우고 오류를 낸다
export const confirmUpload = (artworkId, key, thumbKey = null) => call({ action: 'confirm', artwork_id: artworkId, key, thumb_key: thumbKey });

// 작품 파일(과 썸네일)을 한 번에 올리고 확정
export async function uploadArtwork(artworkId, file, thumbFile = null) {
  const key = await uploadFile(artworkId, file);
  const thumbKey = thumbFile ? await uploadFile(artworkId, thumbFile, { thumb: true }) : null;
  return confirmUpload(artworkId, key, thumbKey);
}

// 작품 삭제 · 전시실 삭제: 파일과 DB 줄을 함께 지운다 (DB 에서만 지우면 파일이 저장소에 남으므로 반드시 이 함수로)
export const deleteArtwork = (artworkId) => call({ action: 'delete_artwork', artwork_id: artworkId });
export const deleteRoom = (roomId) => call({ action: 'delete_room', room_id: roomId });

// 관리자: 저장소에 실제로 들어 있는 전체 용량 { used_mb, free_limit_mb, percent, cap_mb, uploads_blocked }  (무료 1GB 기준)
export const storageUsage = () => call({ action: 'usage' });
