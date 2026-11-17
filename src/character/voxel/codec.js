// 캐릭터 데이터 압축: 설정(JSON) ↔ 짧은 문자열
// 서버 저장과 다른 접속자에게 보내는 데 쓴다. (브라우저와 서버 함수가 같은 파일을 사용 — three.js 등 다른 것에 의존하지 않음)
//
// 담는 것: 기본 모형 색 영역 6개 + 칸별 색칠 + 추가 픽셀(좌표 · 색 · 소속 부위) + 착용 아이템 id
// 형식 "v1." + base64url( 아래 바이트들 )
//   영역 색 6 × 3바이트
//   색 목록: 개수(1) + 색마다 3바이트            ← 색칠·추가 픽셀이 쓰는 색을 번호로 줄이기 위함
//   추가 픽셀: 개수(2) + 픽셀마다 5바이트 (x+64, y, z+64, 색 번호, 부위)
//   색칠: 개수(2) + 칸마다 4바이트 (x+64, y, z+64, 색 번호)
//   아이템: 개수(1) + 아이템마다 길이(1) + 글자
// 크기: 추가 픽셀 400개 ≈ 2.7KB, 기본 모형 겉면을 전부 따로 칠해도 20KB 안팎.
import { REGIONS } from './model.js';

const PREFIX = 'v1.', OFF = 64;
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; };
const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

export function encodeAvatar(cfg) {
  const out = [], colors = [], index = new Map();
  const ci = (c) => { c = c.toLowerCase(); if (!index.has(c)) { if (colors.length >= 255) throw new Error('색이 너무 많습니다'); index.set(c, colors.length); colors.push(c); } return index.get(c); };
  const extra = (cfg.extra ?? []).map((e) => [e[0] + OFF, e[1], e[2] + OFF, ci(e[3]), e[4]]);
  const paint = (cfg.paint ?? []).map((e) => [e[0] + OFF, e[1], e[2] + OFF, ci(e[3])]);
  for (const r of REGIONS) out.push(...rgb(cfg.colors?.[r.key] ?? r.color));
  out.push(colors.length); for (const c of colors) out.push(...rgb(c));
  out.push(extra.length >> 8, extra.length & 255); for (const e of extra) out.push(...e);
  out.push(paint.length >> 8, paint.length & 255); for (const e of paint) out.push(...e);
  const items = (cfg.items ?? []).map((id) => new TextEncoder().encode(id));
  out.push(items.length); for (const b of items) out.push(b.length, ...b);
  if (out.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error('저장할 수 없는 값이 있습니다');
  let bin = ''; for (const v of out) bin += String.fromCharCode(v);
  return PREFIX + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 문자열 → { colors, paint, extra, items }. 형식이 맞지 않으면 오류
export function decodeAvatar(text) {
  if (typeof text !== 'string' || !text.startsWith(PREFIX)) throw new Error('캐릭터 데이터 형식이 아닙니다');
  let bin;
  try { bin = atob(text.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/')); } catch { throw new Error('캐릭터 데이터가 깨졌습니다'); }
  let p = 0;
  const u8 = () => { if (p >= bin.length) throw new Error('캐릭터 데이터가 중간에 끊겼습니다'); return bin.charCodeAt(p++); };
  const u16 = () => u8() << 8 | u8(), color = () => hex(u8(), u8(), u8());
  const cfg = { colors: {}, paint: [], extra: [], items: [] };
  for (const r of REGIONS) cfg.colors[r.key] = color();
  const colors = Array.from({ length: u8() }, color);
  const pick = () => { const c = colors[u8()]; if (!c) throw new Error('없는 색 번호가 있습니다'); return c; };
  for (let n = u16(); n > 0; n--) { const x = u8() - OFF, y = u8(), z = u8() - OFF, c = pick(); cfg.extra.push([x, y, z, c, u8()]); }
  for (let n = u16(); n > 0; n--) cfg.paint.push([u8() - OFF, u8(), u8() - OFF, pick()]);
  for (let n = u8(); n > 0; n--) { const len = u8(), bytes = new Uint8Array(len); for (let i = 0; i < len; i++) bytes[i] = u8(); cfg.items.push(new TextDecoder().decode(bytes)); }
  if (p !== bin.length) throw new Error('캐릭터 데이터 끝에 알 수 없는 값이 있습니다');
  return cfg;
}
