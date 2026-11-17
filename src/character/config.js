// 캐릭터 설정을 브라우저(localStorage)에 저장 / 불러오기
// 게스트는 여기에만 저장한다. 학생·교사는 여기에 더해 서버에도 저장한다(src/data/avatars.js).
// 저장소를 쓸 수 없으면(사생활 보호 모드 등) 오류 없이 기본값으로 진행한다.
//
// 설정: { nickname, colors: { skin, hair, eye, top, bottom, shoes },
//         paint: [[x, y, z, '#색'], …], extra: [[x, y, z, '#색', 부위번호], …], items: [아이템 id, …] }   (좌표는 기본 모형 격자 기준)
import { REGIONS, MAX_EXTRA } from './voxel/model.js';
import { NICK_MAX, cleanNickname, guestName, isGuestName } from '../shared/nickname.js';

export { NICK_MAX, isGuestName };
const STORAGE_KEY = 'vmuseum.avatar.v2';
const OLD_KEY = 'vmuseum.avatar.v1';           // 복셀 이전(로우폴리) 캐릭터 설정
const GUEST_KEY = 'vmuseum.guestName';         // 이 기기의 '관람객 + 숫자' (새로고침해도 같은 숫자)
const MAX_PAINT = 6000;
const isColor = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const isCell = (e) => Array.isArray(e) && [0, 1, 2].every((i) => Number.isInteger(e[i]) && e[i] >= -64 && e[i] < 192) && isColor(e[3]);

// 닉네임을 비웠을 때 쓰는 이름. 한 번 정해지면 이 기기에서는 계속 같은 이름
let guest = '';
export function myGuestName() {
  if (guest) return guest;
  try { guest = localStorage.getItem(GUEST_KEY) ?? ''; } catch { /* 무시 */ }
  if (!isGuestName(guest) || guest === '관람객') { guest = guestName(); try { localStorage.setItem(GUEST_KEY, guest); } catch { /* 무시 */ } }
  return guest;
}

// 기본 모형 그대로의 설정 (다른 사람의 캐릭터를 읽지 못했을 때 등)
export const defaultConfig = () => ({ nickname: myGuestName(), colors: Object.fromEntries(REGIONS.map((r) => [r.key, r.color])), paint: [], extra: [], items: [] });

// 처음 온 사람: 기본 캐릭터에 무작위 색 (추천 색 중에서 고름)
function firstVisitConfig() {
  const cfg = defaultConfig();
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  for (const r of REGIONS) {
    if (r.key === 'eye' || r.key === 'shoes') continue;                       // 눈 · 신발은 기본색
    cfg.colors[r.key] = pick(r.key === 'skin' ? r.choices.slice(0, 5) : r.choices);   // 피부는 사람 피부색 범위에서
  }
  return cfg;
}

// 어떤 값이 들어와도 쓸 수 있는 설정으로 정리 (잘못된 값은 버림)
// 닉네임: 비었거나 금칙어가 있으면 '관람객 + 숫자'
export function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}, cfg = defaultConfig();
  for (const r of REGIONS) if (isColor(src.colors?.[r.key])) cfg.colors[r.key] = src.colors[r.key].toLowerCase();
  cfg.nickname = cleanNickname(src.nickname) || myGuestName();
  const seen = new Set(), once = (e) => { const k = e[0] + ',' + e[1] + ',' + e[2]; if (seen.has(k)) return false; seen.add(k); return true; };
  if (Array.isArray(src.paint))
    cfg.paint = src.paint.filter((e) => isCell(e) && once(e)).slice(0, MAX_PAINT).map((e) => [e[0], e[1], e[2], e[3].toLowerCase()]);
  if (Array.isArray(src.extra))
    cfg.extra = src.extra.filter((e) => isCell(e) && Number.isInteger(e[4]) && e[4] >= 1 && e[4] <= 6 && once(e))
      .slice(0, MAX_EXTRA).map((e) => [e[0], e[1], e[2], e[3].toLowerCase(), e[4]]);
  if (Array.isArray(src.items))            // 착용한 선물 아이템 id
    cfg.items = [...new Set(src.items.filter((id) => typeof id === 'string' && /^[a-z0-9_-]{1,40}$/.test(id)))].slice(0, 16);
  return cfg;
}

// 꾸민 것이 있는가 (추가 픽셀이나 칸별 색칠) — 로그인할 때 "지금 캐릭터를 계정에 저장할까요?" 를 물을지 판단
export const hasEdits = (cfg) => !!(cfg?.extra?.length || cfg?.paint?.length);

export function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) return normalizeConfig(saved);
    // 예전 캐릭터 설정이 있으면 닉네임과 색만 이어받음
    const old = JSON.parse(localStorage.getItem(OLD_KEY));
    if (old) return normalizeConfig({ nickname: old.nickname, colors: { skin: old.skin, hair: old.hairColor, top: old.top } });
  } catch { /* 저장소 차단·손상된 값 → 아래 기본값 */ }
  const first = firstVisitConfig();
  saveConfig(first);                             // 무작위 색이 새로고침마다 바뀌지 않게 바로 저장 (실패해도 그대로 진행)
  return first;
}
export function saveConfig(cfg) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); return true; }
  catch { return false; }                        // 사생활 보호 모드·용량 초과 등: 저장만 건너뜀
}
