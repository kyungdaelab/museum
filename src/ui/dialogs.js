// 화면 안의 작은 창들: 예/아니오 묻기, 입장 코드 입력, 전시실 공유(링크 · QR)
// (브라우저 기본 확인 창은 앱 안에서 막히는 경우가 있어 쓰지 않는다)
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// 창 하나 띄우기. build(panel, close) 에서 내용을 채우고, close(값) 을 부르면 닫히며 그 값이 결과가 된다
function open(build, dismissValue = null) {
  return new Promise((resolve) => {
    const overlay = el('div', 'dlg'), panel = el('div', 'dlgPanel');
    const close = (value) => { overlay.remove(); resolve(value); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(dismissValue); });
    overlay.append(panel); document.body.append(overlay);
    build(panel, close);
  });
}
const buttons = (...list) => { const row = el('div', 'dlgBtns'); row.append(...list); return row; };
const button = (text, cls, onClick) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', onClick); return b; };

// 예/아니오. 반환: true(예) / false(아니오 · 바깥 클릭)
export function ask(text, yesLabel = '예', noLabel = '아니오', note = '') {
  return open((panel, close) => {
    panel.append(el('p', 'dlgText', text));
    if (note) panel.append(el('p', 'muted', note));
    panel.append(buttons(button(noLabel, 'chip', () => close(false)), button(yesLabel, 'dlgMain', () => close(true))));
  }, false);
}

// 입장 코드 입력. check(code) → 맞으면 true. 반환: 맞은 코드 또는 null(취소)
export function askCode(title, check) {
  return open((panel, close) => {
    const form = el('form'), input = el('input'), msg = el('p', 'dlgMsg');
    input.type = 'text'; input.maxLength = 20; input.autocomplete = 'off'; input.spellcheck = false; input.placeholder = '입장 코드';
    const submit = el('button', 'dlgMain', '입장'); submit.type = 'submit';
    form.append(el('p', 'dlgText', `'${title}' 은(는) 입장 코드가 필요해요`), el('p', 'muted', '선생님께 받은 입장 코드를 적어 주세요.'), input, msg,
      buttons(button('취소', 'chip', () => close(null)), submit));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = input.value.trim(); if (!code) return;
      submit.disabled = true; msg.textContent = '확인하는 중…';
      const ok = await check(code).catch(() => false);
      submit.disabled = false;
      if (ok) close(code); else { msg.textContent = '입장 코드가 맞지 않아요'; input.select(); }
    });
    panel.append(form); input.focus();
  });
}

// 전시실 공유: 주소와 QR. 이 주소로 들어오면 로그인 없이 꾸미기 → 바로 입장
export function showShare(title, url) {
  return open((panel, close) => {
    const canvas = el('canvas', 'dlgQr'), link = el('input'), msg = el('p', 'dlgMsg');
    link.type = 'text'; link.readOnly = true; link.value = url; link.addEventListener('focus', () => link.select());
    panel.append(el('p', 'dlgText', `'${title}' 공유하기`), el('p', 'muted', '이 주소나 QR 로 들어오면 로그인 없이 바로 관람할 수 있어요.'), canvas, link, msg,
      buttons(button('닫기', 'chip', () => close(null)),
        button('주소 복사', 'dlgMain', async () => {
          try { await navigator.clipboard.writeText(url); msg.textContent = '주소를 복사했어요'; }
          catch { link.focus(); msg.textContent = '주소를 길게 눌러(또는 Ctrl+C) 복사해 주세요'; }
        })));
    drawQr(canvas, url).catch(() => { canvas.remove(); msg.textContent = 'QR 을 만들지 못했어요. 주소를 복사해 주세요.'; });
  });
}

async function drawQr(canvas, text) {
  const { default: qrcode } = await import('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm');
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), quiet = 4, cell = Math.max(3, Math.floor(280 / (n + quiet * 2)));
  canvas.width = canvas.height = (n + quiet * 2) * cell;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
}
