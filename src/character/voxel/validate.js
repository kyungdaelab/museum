// 캐릭터 데이터 검사 규칙. 서버 함수(저장할 때)와 브라우저(다른 접속자에게서 받았을 때)가 같은 파일을 쓴다.
import { REGIONS, MARGIN, MAX_EXTRA, getBaseModel } from './model.js';

export const MAX_ITEMS = 16;
const COLOR = /^#[0-9a-f]{6}$/, ITEM = /^[a-z0-9_-]{1,40}$/;

/* cfg   : decodeAvatar() 결과 { colors, paint, extra, items }
   opts  : base  = 기본 모형 (생략하면 내장 모형)
           owned = 이 학생이 가진 아이템 id 목록 (null 이면 아이템 보유 검사 생략)
   반환  : 문제 목록(문자열 배열). 빈 배열이면 통과 */
export function validateAvatar(cfg, { base = getBaseModel(), owned = null } = {}) {
  const errors = [], [bx, by, bz] = base.size, seen = new Set();
  if (!cfg || typeof cfg !== 'object') return ['캐릭터 데이터가 없습니다'];
  for (const r of REGIONS) if (!COLOR.test(cfg.colors?.[r.key] ?? '')) errors.push(`${r.label} 색이 올바르지 않습니다`);

  // 추가 픽셀: 400개 이하, 허용 범위 안, 기본 모형과 겹치지 않음, 부위 번호 1~6
  const extra = Array.isArray(cfg.extra) ? cfg.extra : [];
  if (extra.length > MAX_EXTRA) errors.push(`추가 픽셀이 ${extra.length}개입니다 (최대 ${MAX_EXTRA}개)`);
  let outside = 0, overlap = 0, dup = 0, bad = 0;
  for (const e of extra) {
    const [x, y, z, c, part] = e;
    if (![x, y, z, part].every(Number.isInteger) || !COLOR.test(c) || part < 1 || part > 6) { bad++; continue; }
    if (x < -MARGIN.x || x >= bx + MARGIN.x || y < 0 || y >= by + MARGIN.top || z < -MARGIN.z || z >= bz + MARGIN.z) { outside++; continue; }
    if (base.get(x, y, z)) overlap++;
    const k = x + ',' + y + ',' + z; if (seen.has(k)) dup++; seen.add(k);
  }
  if (bad) errors.push(`형식이 잘못된 추가 픽셀이 ${bad}개 있습니다`);
  if (outside) errors.push(`허용 범위를 벗어난 추가 픽셀이 ${outside}개 있습니다`);
  if (overlap) errors.push(`기본 모형과 겹치는 추가 픽셀이 ${overlap}개 있습니다`);
  if (dup) errors.push(`같은 자리에 겹친 추가 픽셀이 ${dup}개 있습니다`);

  // 기본 모형은 색만 바꿀 수 있다: 색칠은 기본 모형이 있는 칸에만. (모양을 바꾸는 값은 형식에 아예 없음)
  let offBase = 0; seen.clear();
  for (const e of Array.isArray(cfg.paint) ? cfg.paint : []) {
    const [x, y, z, c] = e, k = x + ',' + y + ',' + z;
    if (![x, y, z].every(Number.isInteger) || !COLOR.test(c) || !base.get(x, y, z) || seen.has(k)) offBase++;
    seen.add(k);
  }
  if (offBase) errors.push(`기본 모형이 아닌 칸을 칠한 값이 ${offBase}개 있습니다`);

  // 착용 아이템: 가진 것만
  const items = Array.isArray(cfg.items) ? cfg.items : [];
  if (items.length > MAX_ITEMS || items.some((id) => typeof id !== 'string' || !ITEM.test(id)) || new Set(items).size !== items.length) errors.push('착용 아이템 목록이 올바르지 않습니다');
  else if (owned) { const miss = items.filter((id) => !owned.includes(id)); if (miss.length) errors.push(`가지고 있지 않은 아이템을 착용했습니다: ${miss.join(', ')}`); }
  return errors;
}

// 색만 남기고 추가 픽셀 · 색칠을 뺀 설정 (교사가 초기화할 때, 검사에 통과하지 못한 데이터를 보여 줄 때)
export const stripEdits = (cfg) => ({ ...cfg, colors: { ...cfg.colors }, paint: [], extra: [], items: [...(cfg.items ?? [])] });
