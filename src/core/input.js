// 입력: 키보드 · 마우스/터치 드래그 · 휠/핀치 줌 · 가상 조이스틱 · 탭
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'];

/* opts:
     canvas, stickEl, knobEl
     isBlocked()   : 패널이 열려 있는 등 이동을 막아야 할 때 true
     isOrbiting()  : 감상 모드(OrbitControls 가 캔버스를 쓰는 중)일 때 true
     onLook(dx, dy, isTouch), onZoom(factor), onTap(x, y), onTouch(), onActivity() */
export function createInput(opts) {
  const { canvas, stickEl, knobEl } = opts;
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (opts.isBlocked() || !MOVE_KEYS.includes(e.code)) return;
    keys.add(e.code); e.preventDefault(); opts.onActivity?.();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  // 시점 회전(드래그) · 핀치 줌
  const ptrs = new Map(); let pinch = 0, tap = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (opts.isOrbiting()) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch = 0; canvas.classList.add('dragging');
    tap = ptrs.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    if (e.pointerType === 'touch') opts.onTouch?.();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 1) opts.onLook(dx, dy, e.pointerType === 'touch');
    else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) opts.onZoom(pinch / d);
      pinch = d;
    }
  });
  const end = (e) => { ptrs.delete(e.pointerId); pinch = 0; if (!ptrs.size) canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', (e) => {       // 드래그 없이 짧게 누르면 '탭'
    if (tap && ptrs.has(e.pointerId) && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 8 && performance.now() - tap.t < 500) opts.onTap?.(e.clientX, e.clientY);
    tap = null; end(e);
  });
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (!opts.isOrbiting()) opts.onZoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // 가상 조이스틱
  const stick = { x: 0, y: 0, id: null };
  const setStick = (e) => {
    const r = stickEl.getBoundingClientRect(), max = r.width / 2 - 20;
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > max) { dx *= max / len; dy *= max / len; }
    knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    stick.x = dx / max; stick.y = -dy / max;
  };
  const endStick = (e) => { if (e && e.pointerId !== stick.id) return; stick.id = null; stick.x = stick.y = 0; knobEl.style.transform = ''; };
  stickEl.addEventListener('pointerdown', (e) => { stick.id = e.pointerId; try { stickEl.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ } setStick(e); opts.onActivity?.(); });
  stickEl.addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) setStick(e); });
  stickEl.addEventListener('pointerup', endStick);
  stickEl.addEventListener('pointercancel', endStick);

  return {
    // 이동 입력: x = 오른쪽(+)/왼쪽(-), y = 앞(+)/뒤(-), run = 달리기
    axis() {
      let x = stick.x, y = stick.y;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
      if (keys.has('KeyW') || keys.has('ArrowUp')) y += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) y -= 1;
      return { x, y, run: keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(stick.x, stick.y) > 0.92 };
    },
    clear() { keys.clear(); ptrs.clear(); endStick(); canvas.classList.remove('dragging'); },
  };
}
