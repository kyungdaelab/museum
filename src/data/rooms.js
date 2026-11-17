// 전시실 · 작품 목록 읽기
//   Supabase 설정이 있으면(src/data/backend.js) → Supabase 의 rooms / artworks 표
//   없으면 → data 폴더의 샘플 JSON
// 작품 목록은 전시실에 들어갈 때 그 전시실 것만 읽는다. (다른 전시실 것은 미리 읽지 않음)
import { backendEnabled, getClient, ensureSession } from './backend.js';

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} 을(를) 읽지 못했습니다 (${res.status})`);
  return res.json();
}

// DB 의 유형 이름 ↔ 앱 안의 유형 이름 (DB: sculpture = 앱: solid)
const TYPE_FROM_DB = { flat: 'flat', sculpture: 'solid' };

// DB 의 전시실 줄 → 앱에서 쓰는 전시실 설정
function roomFromDb(r, teacherName = '') {
  return {
    id: r.id, title: r.title, description: r.description, teacher: teacherName,
    period: r.starts_on || r.ends_on ? { start: r.starts_on ?? '', end: r.ends_on ?? '' } : null,
    type: TYPE_FROM_DB[r.type] ?? r.type, maxArtworks: r.max_artworks,
    theme: r.theme ?? {}, arrangement: r.theme?.arrangement,
    visibility: r.visibility, hasEntryCode: r.has_entry_code, maxVisitors: r.max_visitors,
    // 게스트 설정 (멀티플레이에서 사용): 게스트 허용, 게스트 캐릭터 표시 방식('full' 꾸민 그대로 / 'base' 기본 모형 + 색만), 게스트 최대 인원
    guestAllowed: r.guest_allowed ?? true, guestAvatarMode: r.guest_avatar_mode ?? 'base', maxGuests: r.max_guests ?? 20,
  };
}

// 입장이 막혔을 때 관람자에게 보여 줄 문장
const DENIED = {
  not_found: '전시실을 찾을 수 없어요. 주소가 맞는지, 전시가 끝나지 않았는지 확인해 주세요.',
  guest_blocked: '이 전시실은 로그인한 학생만 들어갈 수 있어요. 오른쪽 위의 학생 로그인을 눌러 주세요.',
  class_only: '이 전시실은 정해진 학급 학생만 들어갈 수 있어요. 해당 학급이면 학생 로그인을 해 주세요.',
};

// DB 의 작품 줄 → 앱에서 쓰는 작품 정보 (종류에 따라 파일 경로가 image / model / splat 항목으로 들어감)
function artworkFromDb(a) {
  const adj = a.adjust ?? {}, cm = a.size_cm ?? {};
  const size = [cm.width && `가로 ${cm.width}`, cm.height && `높이 ${cm.height}`, cm.depth && `깊이 ${cm.depth}`].filter(Boolean).join(' × ');
  return {
    id: a.id, type: a.kind, slot: a.slot, title: a.title, artist: a.artist, grade: a.grade, material: a.material,
    size: size ? size + ' cm' : '', description: a.description,
    [a.kind]: a.file_path, thumbnail: a.thumbnail_path ?? undefined,
    sizeCm: cm, rotation: adj.rotation, crop: adj.crop, frameColor: adj.frameColor,
  };
}

// 전시실 목록 (공개 전시실만. 링크 공유 · 비공개는 나오지 않음)
export async function listRooms() {
  if (!backendEnabled()) { const json = await getJson('data/rooms.json'); return Array.isArray(json) ? json : json.rooms ?? []; }
  await ensureSession();
  const client = await getClient();
  // 공개 전시실 + (로그인한 학생이면) 내 학급 전용 전시실. 무엇이 보이는지는 DB 의 보안 규칙이 정한다
  const { data, error } = await client.from('rooms').select('*, artworks(count)').in('visibility', ['public', 'class']).eq('blocked', false).order('created_at', { ascending: false });
  if (error) throw new Error('전시실 목록을 읽지 못했습니다: ' + error.message);
  return data.map((r) => ({ ...roomFromDb(r), artworkCount: r.artworks?.[0]?.count ?? 0 }));
}

// 전시실 하나 열기 (링크 · QR 로 들어왔을 때). 반환: { room } 또는 { denied: 관람자에게 보여 줄 문장 }
export async function getRoom(roomId) {
  if (!backendEnabled()) {
    const room = (await listRooms()).find((r) => r.id === roomId);
    return room ? { room } : { denied: DENIED.not_found };
  }
  await ensureSession();                                    // 게스트 임시 ID (실패해도 계속)
  const client = await getClient();
  const { data: access, error: accessError } = await client.rpc('room_access', { p_room: roomId });
  if (accessError) return { denied: DENIED.not_found };      // 주소가 잘못된 경우(형식 오류) 포함
  if (access !== 'ok') return { denied: DENIED[access] ?? DENIED.not_found };
  const { data, error } = await client.rpc('get_room', { p_room: roomId });
  if (error || !data?.[0]) return { denied: DENIED.not_found };
  return { room: roomFromDb(data[0]) };
}

// 입장 코드가 맞는가 (코드가 없는 전시실은 항상 참)
export async function checkRoomCode(room, code) {
  if (!backendEnabled()) return !room.entryCode || room.entryCode === code;      // 샘플 데이터에서 시험할 때
  const client = await getClient();
  const { data, error } = await client.rpc('check_room_code', { p_room: room.id, p_code: code });
  return !error && data === true;
}

// 한 전시실의 작품 목록. 입장 코드가 있는 전시실은 code 가 맞아야 받는다 (틀리면 빈 목록)
export async function getArtworks(roomId, code = null) {
  if (!backendEnabled()) { const json = await getJson(`data/rooms/${encodeURIComponent(roomId)}.json`); return Array.isArray(json) ? json : json.artworks ?? []; }
  const client = await getClient();
  const { data, error } = await client.rpc('get_room_artworks', { p_room: roomId, p_code: code });
  if (error) throw new Error('작품 목록을 읽지 못했습니다: ' + error.message);
  return (data ?? []).map(artworkFromDb);
}
