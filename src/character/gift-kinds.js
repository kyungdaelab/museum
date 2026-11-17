// 선물의 종류: 훈장 + 꾸미기 아이템 10종. 선생님이 종류를 고르고 이름 · 색 · 효과를 정해 직접 만든다.
// 선물 하나 = { id, name, kind, shape(훈장 모양), metal(주 색), ribbon(둘째 색), name_color(이름 글자 색), effect }
//   kind 가 'medal' 이면 metal = 메달 색, ribbon = 리본 색.  아이템이면 metal = 주 색, ribbon = 둘째 색.
// ▸ 새 종류 추가: ① 여기 GIFT_KINDS 에 한 줄  ② giftSvg 에 그림  ③ src/character/items.js 의 GEAR 에 3D 모양  ④ DB 의 medals_kind_check (0010)
import { cleanMedal, medalSvg, darker } from './medal-shapes.js';

// c1 / c2 = 색 칸의 이름 (c2 가 없으면 색을 하나만 고름), colors = 처음 색 [주 색, 둘째 색]
export const GIFT_KINDS = {
  medal:   { label: '훈장',      icon: '🏅', c1: '메달 색',   c2: '리본 색',     colors: ['#ffd35a', '#c8372d'], desc: '가슴과 별명 옆에 다는 훈장' },
  halo:    { label: '후광',      icon: '😇', c1: '고리 색',                      colors: ['#ffd35a', '#ffffff'], desc: '머리 위에 떠서 빛나는 고리' },
  wings:   { label: '날개',      icon: '🪽', c1: '날개 색',   c2: '깃 끝 색',    colors: ['#ffffff', '#bcd4ff'], desc: '등 뒤에서 천천히 펄럭이는 날개' },
  crown:   { label: '왕관',      icon: '👑', c1: '왕관 색',   c2: '보석 색',     colors: ['#ffd35a', '#e5484d'], desc: '머리에 쓰는 왕관' },
  cape:    { label: '망토',      icon: '🦸', c1: '망토 색',                      colors: ['#c8372d', '#ffffff'], desc: '등 뒤로 늘어져 살랑이는 망토' },
  star:    { label: '별가루',    icon: '✨', c1: '',                             colors: ['#ffd35a', '#ffffff'], desc: '몸 둘레를 도는 반짝이는 별가루' },
  ears:    { label: '동물 귀',   icon: '🐱', c1: '귀 색',     c2: '귀 안쪽 색',  colors: ['#f2b76b', '#ffd6dd'], desc: '머리 위에 쫑긋 솟은 귀' },
  bow:     { label: '머리 리본', icon: '🎀', c1: '리본 색',   c2: '매듭 색',     colors: ['#f06292', '#c2185b'], desc: '머리 위에 다는 큰 리본' },
  scarf:   { label: '목도리',    icon: '🧣', c1: '목도리 색', c2: '줄무늬 색',   colors: ['#2e7d6b', '#f4f1ea'], desc: '목에 두르고 앞으로 늘어뜨린 목도리' },
  balloon: { label: '풍선',      icon: '🎈', c1: '풍선 색',                      colors: ['#e5484d', '#ffffff'], desc: '손에 묶여 머리 위로 둥실 떠 있는 풍선' },
  pet:     { label: '꼬마 친구', icon: '🐥', c1: '몸 색',     c2: '날개 색',     colors: ['#ffd54f', '#ff8a65'], desc: '어깨 옆을 따라다니며 날아다니는 작은 친구' },
};
export const GIFT_KEYS = Object.keys(GIFT_KINDS);
export const EFFECTS = { sparkle: '반짝이 (별빛이 반짝반짝)', blink: '깜빡이 (빛이 깜빡깜빡)', none: '효과 없음' };
export const MAX_GEAR = 6;            // 한 캐릭터가 한꺼번에 걸치는 아이템 수 (같은 종류는 하나만)

export const isMedal = (g) => (g?.kind ?? 'medal') === 'medal';
// 받은 값이 이상해도 그릴 수 있게 다듬는다
export const cleanGift = (g) => ({ ...cleanMedal(g), kind: GIFT_KINDS[g?.kind] ? g.kind : 'medal', effect: EFFECTS[g?.effect] ? g.effect : 'sparkle' });
export const newGift = (kind = 'medal') => ({ name: '', kind, shape: 'star', metal: GIFT_KINDS[kind].colors[0], ribbon: GIFT_KINDS[kind].colors[1], name_color: '#b8860b', effect: 'sparkle' });

// 선물 그림(SVG 글). 훈장은 훈장 그림, 아이템은 종류별 간단한 그림에 고른 색을 입힌다. 교사 화면과 이름 창에서 쓴다
const ART = {
  halo:    (a) => `<ellipse cx="0" cy="-2" rx="15" ry="6" fill="none" stroke="${a}" stroke-width="4.5"/><ellipse cx="0" cy="-2" rx="15" ry="6" fill="none" stroke="#fff" stroke-width="1.2" opacity=".7"/>`,
  wings:   (a, b) => `<path d="M-1 0C-6 -16 -19 -17 -19 -8C-19 -3 -16 0 -14 2C-15 5 -12 8 -10 9C-9 12 -5 12 -2 10Z" fill="${a}" stroke="${b}" stroke-width="1.4"/><path d="M1 0C6 -16 19 -17 19 -8C19 -3 16 0 14 2C15 5 12 8 10 9C9 12 5 12 2 10Z" fill="${a}" stroke="${b}" stroke-width="1.4"/>`,
  crown:   (a, b) => `<path d="M-15 10V-6L-8 2L0 -12L8 2L15 -6V10Z" fill="${a}" stroke="${darker(a)}" stroke-width="1.4" stroke-linejoin="round"/><circle cx="0" cy="4" r="3" fill="${b}"/>`,
  cape:    (a) => `<path d="M-9 -14H9L15 14Q0 8 -15 14Z" fill="${a}" stroke="${darker(a)}" stroke-width="1.4" stroke-linejoin="round"/><path d="M-9 -14H9" stroke="${darker(a, 0.6)}" stroke-width="3" stroke-linecap="round"/>`,
  star:    () => `<path d="M-6 -14L-4 -6L4 -4L-4 -2L-6 6L-8 -2L-16 -4L-8 -6Z" fill="#ffd35a"/><path d="M9 0L10.500 6L16 7.500L10.500 9L9 15L7.500 9L2 7.500L7.500 6Z" fill="#ffe9a3"/><circle cx="10" cy="-10" r="2" fill="#fff3c4"/>`,
  ears:    (a, b) => `<path d="M-17 10L-11 -13L-1 6Z" fill="${a}" stroke="${darker(a)}" stroke-width="1.4" stroke-linejoin="round"/><path d="M-13 6L-10.500 -6L-5 5Z" fill="${b}"/><path d="M17 10L11 -13L1 6Z" fill="${a}" stroke="${darker(a)}" stroke-width="1.4" stroke-linejoin="round"/><path d="M13 6L10.500 -6L5 5Z" fill="${b}"/>`,
  bow:     (a, b) => `<path d="M0 0L-17 -11V11Z" fill="${a}" stroke="${darker(a)}" stroke-width="1.4" stroke-linejoin="round"/><path d="M0 0L17 -11V11Z" fill="${a}" stroke="${darker(a)}" stroke-width="1.4" stroke-linejoin="round"/><circle cx="0" cy="0" r="4.500" fill="${b}"/>`,
  scarf:   (a, b) => `<rect x="-15" y="-11" width="30" height="10" rx="5" fill="${a}" stroke="${darker(a)}" stroke-width="1.4"/><path d="M3 -2H12V14H3Z" fill="${a}" stroke="${darker(a)}" stroke-width="1.4"/><path d="M3 5H12M3 10H12" stroke="${b}" stroke-width="2"/>`,
  balloon: (a) => `<path d="M0 6Q4 12 -1 18" fill="none" stroke="#8a8272" stroke-width="1.2"/><ellipse cx="0" cy="-6" rx="11" ry="13" fill="${a}" stroke="${darker(a)}" stroke-width="1.4"/><path d="M-2 7H2L0 4Z" fill="${darker(a)}"/><ellipse cx="-4" cy="-11" rx="2.500" ry="4" fill="#fff" opacity=".6"/>`,
  pet:     (a, b) => `<ellipse cx="-11" cy="2" rx="6" ry="4" fill="${b}"/><ellipse cx="11" cy="2" rx="6" ry="4" fill="${b}"/><circle cx="0" cy="0" r="11" fill="${a}" stroke="${darker(a)}" stroke-width="1.4"/><circle cx="-4" cy="-2" r="1.800" fill="#2b2b2b"/><circle cx="4" cy="-2" r="1.800" fill="#2b2b2b"/><path d="M-2 3L0 6L2 3Z" fill="${darker(b, 0.85)}"/>`,
};
export function giftSvg(gift) {
  const g = cleanGift(gift);
  if (g.kind === 'medal') return medalSvg(g);
  return `<svg viewBox="-20 -24 40 46" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${ART[g.kind](g.metal, g.ribbon)}</svg>`;
}
