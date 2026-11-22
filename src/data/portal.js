// '수업 공간'(포털) 주소. 깃허브에서는 사이트 맨 앞(/), 내 컴퓨터에서 시험할 때는 /포털/ 폴더
export const PORTAL_URL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '/포털/' : '/';
