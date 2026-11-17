// 닉네임 규칙: 금칙어 필터와 게스트 기본 이름 ('관람객 + 숫자')
// 브라우저와 서버 함수가 같은 파일을 쓴다. (서버용 복사본은 tools/sync-shared.ps1 이 만든다)
//
// ▸ 금칙어 추가: BLOCKED 에 낱말을 추가합니다. 띄어쓰기 · 기호 · 숫자를 끼워 넣어 피해 가는 것도 걸러집니다.
export const NICK_MAX = 12;
export const GUEST_PREFIX = '관람객';

// 기본 목록(욕설 · 비하 · 성적 표현 · 관리자 사칭). 학교에서 쓰며 필요한 낱말을 더해 주세요.
const BLOCKED = [
  '시발', '씨발', '씨바', '시바', 'ㅅㅂ', 'ㅆㅂ', '병신', 'ㅂㅅ', '지랄', 'ㅈㄹ', '좆', '존나', '졸라', 'ㅈㄴ', '개새', '새끼', 'ㅅㄲ',
  '꺼져', '닥쳐', '미친놈', '미친년', '또라이', '찐따', '멍청이', '바보새', '쓰레기', '죽어', '뒤져', '자살', '살인',
  '섹스', '야동', '변태', '보지', '자지', '성기', '가슴만', '창녀', '걸레년',
  '애미', '애비', '느금', '니엄마', '엄창', '장애인', '틀딱', '한남충', '김치녀', '급식충',
  'fuck', 'shit', 'bitch', 'asshole', 'dick', 'pussy', 'sex', 'porn', 'nigger', 'nigga', 'faggot', 'retard',
  '관리자', '운영자', 'admin',
];
// 비교할 때: 소문자로, 띄어쓰기 · 기호 · 숫자를 빼고 본다 ("시 1 발" → "시발")
const squash = (s) => s.toLowerCase().replace(/[^a-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');
const BLOCKED_SQUASHED = BLOCKED.map(squash);

export function hasBlockedWord(text) {
  const s = squash(String(text ?? ''));
  return !!s && BLOCKED_SQUASHED.some((w) => s.includes(w));
}

// '관람객 + 숫자 4자리'
export const guestName = () => GUEST_PREFIX + String(1000 + Math.floor(Math.random() * 9000));
export const isGuestName = (name) => new RegExp(`^${GUEST_PREFIX}\\d*$`).test(name ?? '');

// 입력한 닉네임 정리: 앞뒤 공백 제거, 12자까지. 비었거나 금칙어가 있으면 '' 를 돌려준다 (부르는 쪽이 기본 이름으로 대신함)
export function cleanNickname(text) {
  if (typeof text !== 'string') return '';
  const n = Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, NICK_MAX).join('');
  return n && !hasBlockedWord(n) ? n : '';
}
