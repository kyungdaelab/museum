/* 순위표: 게임이 끝나면 닉네임을 적어 점수를 올린다.
   기기 한 대로 돌아가며 할 때 쓰는 용도라 이 탭 안에서만 기억하고(sessionStorage), 탭을 닫으면 지워진다.
   쓰는 법: Rank.mount(상자, '게임:난이도', 점수, '제목') */
window.Rank = (function(){
  const css = `
  .result{overflow:auto;justify-content:flex-start !important}
  .result > :first-child{margin-top:auto} .result > :last-child{margin-bottom:auto}
  .rank{width:min(100%,420px);background:#17153a;border:1px solid #2f2b6b;border-radius:16px;padding:12px 14px;text-align:left;flex:none}
  .rank h3{margin:0 0 8px;font-size:16px;color:#ffd84a;display:flex;justify-content:space-between;align-items:center}
  .rank form{display:flex;gap:8px;margin:0 0 10px}
  .rank input{flex:1;min-width:0;padding:10px 12px;border-radius:10px;border:1px solid #2f2b6b;background:#0e0d28;color:#fff;font:inherit}
  .rank form button{padding:10px 14px;white-space:nowrap}
  .rank ol{list-style:none;margin:0;padding:0;max-height:210px;overflow:auto}
  .rank li{display:grid;grid-template-columns:2.6em 1fr auto;gap:8px;padding:6px 6px;border-bottom:1px dashed #2f2b6b;font-weight:700}
  .rank li:last-child{border:0}
  .rank li.me{color:#ffd84a;background:#26225e;border-radius:8px}
  .rank .empty{color:#a9a4d6;font-weight:400;font-size:14px;padding:6px 4px}
  .rank .clear{background:transparent;border:0;color:#a9a4d6;font-size:12px;padding:2px 4px;text-decoration:underline}`;
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);

  const mem = {};
  function read(key){
    try{ const v = JSON.parse(sessionStorage.getItem('rank:' + key)); if(Array.isArray(v)) return v; }catch(e){}
    return mem[key] || [];
  }
  function write(key, list){ mem[key] = list; try{ sessionStorage.setItem('rank:' + key, JSON.stringify(list)); }catch(e){} }
  function add(key, name, score){
    const list = read(key), id = Date.now() + '-' + Math.round(Math.random()*1e6);
    list.push({id, name, score});
    list.sort((a, b) => b.score - a.score);           // 점수가 같으면 먼저 올린 사람이 위
    write(key, list.slice(0, 50));
    return id;
  }
  function el(tag, text, cls){ const e = document.createElement(tag); if(text !== undefined) e.textContent = text; if(cls) e.className = cls; return e; }

  /* box 안에 "닉네임 입력 + 순위표"를 그린다 */
  function mount(box, key, score, title){
    let mine = null;
    function draw(){
      box.textContent = '';
      const wrap = el('div', undefined, 'rank'), head = el('h3', title);
      const clear = el('button', '순위 지우기', 'clear'); clear.type = 'button';
      clear.onclick = () => { if(clear.dataset.sure){ write(key, []); mine = mine && 'gone'; draw(); } else { clear.dataset.sure = '1'; clear.textContent = '정말 지울까요?'; } };
      head.append(clear); wrap.append(head);
      if(!mine){
        const form = el('form'), input = el('input'), btn = el('button', '순위에 올리기', 'primary');
        input.maxLength = 10; input.placeholder = '닉네임 (10자까지)'; input.autocomplete = 'off';
        form.onsubmit = e => { e.preventDefault(); mine = add(key, input.value.trim() || '이름 없음', score); draw(); };
        form.append(input, btn); wrap.append(form);
        setTimeout(() => { try{ input.focus({preventScroll:true}); }catch(e){} }, 50);
      }
      const list = read(key), ol = el('ol');
      if(!list.length) wrap.append(el('div', '아직 기록이 없어요. 첫 번째로 이름을 올려 보세요!', 'empty'));
      list.forEach((r, i) => {
        const li = el('li', undefined, r.id === mine ? 'me' : '');
        li.append(el('span', (i+1) + '위'), el('span', r.name), el('span', r.score + '점'));
        ol.append(li);
        if(r.id === mine) setTimeout(() => li.scrollIntoView({block:'nearest'}), 60);
      });
      wrap.append(ol); box.append(wrap);
    }
    draw();
  }
  return {mount, read, add};
})();
