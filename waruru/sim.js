// 난이도 시험용 자동 대국. 게임 화면(index.html)을 연 상태에서 이 파일을 불러와 simulate(...)를 부른다.
// 봇은 "아직 못 한 원리 중 가장 적은 행동으로 끝낼 수 있는 것"을 골라 그 다음 한 수를 둔다.
// 일부러 남을 막지는 않는다(우연히 자리가 겹쳐 막히는 일만 있다). 판이 92% 넘게 기우는 수는 두지 않는다.
(() => {
  'use strict';
  const rnd = n => Math.floor(Math.random() * n);
  const SAFE = .92;
  const SHAPES = [
    [[0,0],[1,0],[0,1]], [[0,0],[1,0],[1,1]], [[0,0],[0,1],[1,1]], [[1,0],[0,1],[1,1]],
    [[0,0],[2,0],[1,1]], [[0,0],[2,0],[1,2]], [[0,0],[0,2],[1,1]], [[0,0],[0,2],[2,1]],
    [[0,0],[2,0],[1,-1]], [[0,0],[2,1],[1,2]],
  ];
  const DIRS = []; for (const s of [1, 2]) for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]) DIRS.push([dx * s, dy * s]);

  const free = (x, y) => inb(x, y) && !S.cells[y][x] && !blocked(x, y);
  // 내 점이면서 아직 원리에 쓰지 않은 점 (쓴 점은 다른 원리에 재사용할 수 없다)
  const own = (p, x, y) => { const c = inb(x, y) ? S.cells[y][x] : null; return c && c.p === p && !c.u ? c : null; };

  // 점들을 (덜 기우는 순서로) 놓았을 때의 가장 나쁜 기울기와 그 순서
  function riskPlan(extra) {
    let tx = 0, ty = 0;
    for (let y = 0; y < S.N; y++) for (let x = 0; x < S.N; x++) { const c = S.cells[y][x]; if (c) { tx += c.w * (x - S.R); ty += c.w * (y - S.R); } }
    const rem = extra.slice(), order = []; let worst = 0;
    while (rem.length) {
      let bi = 0, br = Infinity;
      rem.forEach((d, i) => { const r = Math.hypot(tx + d.w * (d.x - S.R), ty + d.w * (d.y - S.R)); if (r < br) { br = r; bi = i; } });
      const d = rem.splice(bi, 1)[0]; tx += d.w * (d.x - S.R); ty += d.w * (d.y - S.R); order.push(d); worst = Math.max(worst, br / S.limit);
    }
    return { worst, order };
  }
  // 나중에 그을 선이 가능한가 (planned: 앞으로 놓을 점 자리)
  function lineOK(p, a, b, planned) {
    if (Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) > MAX_LINE) return false;
    if (between(a, b).some(q => S.cells[q[1]][q[0]] || planned.some(d => d.x === q[0] && d.y === q[1]))) return false;
    return !S.lines.some(l => l.p !== p && crosses(a, b, l.a, l.b));
  }
  const mostW = pc => { let b = 0; for (const w of [1, 2, 3]) if (pc[w] > (pc[b] || 0)) b = w; return b; };

  // 면 카드: 빈 자리 k개에 줄 크기·색을 정한다 (ex: 이미 있는 내 점들). 안 되면 null
  function solveFace(id, ex, k, pieces) {
    const pc = { ...pieces }, out = [];
    const take = w => { if (!pc[w]) return false; pc[w]--; return true; };
    const E = [...new Set(ex.map(c => c.h))], W = new Set(ex.map(c => c.w));
    let ws = [], hs = [];
    if (id === 'variety' || id === 'contrast') {
      if (id === 'contrast' && W.has(2)) return null;
      const miss = (id === 'variety' ? [1, 2, 3] : [3, 1]).filter(w => !W.has(w));
      if (miss.length > k) return null;
      for (const w of miss) { if (!take(w)) return null; ws.push(w); }
      while (ws.length < k) { const w = id === 'variety' ? mostW(pc) : (pc[1] >= pc[3] ? 1 : 3); if (!w || !take(w)) return null; ws.push(w); }
      hs = ws.map(() => rnd(6));
    } else {
      for (let i = 0; i < k; i++) { const w = mostW(pc); if (!w || !take(w)) return null; ws.push(w); }
      if (id === 'unity') {
        if (E.length > 1) return null;
        const h = E.length ? E[0] : rnd(6); hs = ws.map(() => h);
      } else if (id === 'analog') {
        let ok = false; const s0 = rnd(6);
        for (let t = 0; t < 6 && !ok; t++) {
          const s = (s0 + t) % 6, win = [s, (s + 1) % 6, (s + 2) % 6];
          if (!E.every(h => win.includes(h))) continue;
          const fresh = win.filter(h => !E.includes(h)); hs = [];
          for (let i = 0; i < k; i++) hs.push(fresh.length ? fresh[i % fresh.length] : win[i % 3]);
          if (new Set([...E, ...hs]).size >= 2) ok = true;
        }
        if (!ok) return null;
      } else if (id === 'comp') {
        const pair = E.some(h => E.includes((h + 3) % 6));
        if (pair) hs = ws.map(() => rnd(6));
        else if (!k) return null;
        else { const b = E.length ? E[0] : rnd(6); hs = ws.map((_, i) => i === 0 ? (b + 3) % 6 : b); }
      }
    }
    for (let i = 0; i < k; i++) out.push({ w: ws[i], h: hs[i] });
    return out;
  }

  // 각 원리의 가장 싼 계획: { cost, next }  (next: 다음 한 수)
  function planFace(p, id) {
    const P = S.players[p]; let best = null;
    for (const sh of SHAPES) for (let ay = -1; ay < S.N; ay++) for (let ax = -1; ax < S.N; ax++) {
      const pos = sh.map(([dx, dy]) => [ax + dx, ay + dy]);
      if (!pos.every(q => inb(...q) && (own(p, ...q) || free(...q)))) continue;
      const ex = [], emptyPos = [];
      pos.forEach(q => { const c = own(p, ...q); c ? ex.push(c) : emptyPos.push(q); });
      const pairs = [[0, 1], [1, 2], [2, 0]].map(([i, j]) => [pos[i], pos[j]]);
      const miss = pairs.filter(([a, b]) => !(own(p, ...a) && own(p, ...b) && linked(p, a, b)));
      if (!miss.length) continue;                                  // 이미 닫힌 면은 다시 못 쓴다
      const attrs = solveFace(id, ex, emptyPos.length, P.pieces); if (!attrs) continue;
      const need = emptyPos.map((q, i) => ({ x: q[0], y: q[1], ...attrs[i] }));
      if (!miss.every(([a, b]) => lineOK(p, a, b, need))) continue;
      const rp = riskPlan(need); if (rp.worst > SAFE) continue;
      const cost = need.length + miss.length, score = cost * 10 + rp.worst * 4 + Math.random();
      if (best && best.score <= score) continue;
      const next = need.length ? { type: 'dot', ...rp.order[0] } : { type: 'line', a: miss[0][0], b: miss[0][1] };
      best = { cost, score, next };
    }
    return best;
  }
  function planRow(p, id) {
    const P = S.players[p]; let best = null;
    for (const ws of (id === 'repeat' ? [[1, 1, 1], [2, 2, 2], [3, 3, 3]] : [[1, 2, 3]])) for (const [dx, dy] of DIRS)
      for (let ay = 0; ay < S.N; ay++) for (let ax = 0; ax < S.N; ax++) {
        const pos = [0, 1, 2].map(k => [ax + k * dx, ay + k * dy]);
        if (!pos.every(q => inb(...q))) continue;
        const need = [], pc = { ...P.pieces }; let ok = true;
        pos.forEach((q, i) => { const c = S.cells[q[1]][q[0]];
          if (c) { if (c.p !== p || c.u || c.w !== ws[i]) ok = false; }
          else if (!free(...q) || !pc[ws[i]]) ok = false;
          else { pc[ws[i]]--; need.push({ x: q[0], y: q[1], w: ws[i], h: rnd(6) }); } });
        if (!ok) continue;
        const miss = [[pos[0], pos[1]], [pos[1], pos[2]]].filter(([a, b]) => !(own(p, ...a) && own(p, ...b) && linked(p, a, b)));
        if (!miss.length || !miss.every(([a, b]) => lineOK(p, a, b, need))) continue;
        const rp = riskPlan(need); if (rp.worst > SAFE) continue;
        const cost = need.length + miss.length, score = cost * 10 + rp.worst * 4 + Math.random();
        if (best && best.score <= score) continue;
        best = { cost, score, next: need.length ? { type: 'dot', ...rp.order[0] } : { type: 'line', a: miss[0][0], b: miss[0][1] } };
      }
    return best;
  }
  function anyDot(p) {
    const P = S.players[p]; let best = null;
    for (let y = 0; y < S.N; y++) for (let x = 0; x < S.N; x++) if (free(x, y)) for (const w of [1, 2, 3]) if (P.pieces[w]) {
      const r = riskPlan([{ x, y, w }]).worst + Math.random() * .02 - P.pieces[w] * .01;
      if (!best || r < best.r) best = { r, next: { type: 'dot', x, y, w, h: rnd(6) } };
    }
    return best && best.r <= SAFE ? best.next : null;
  }
  function planEmph(p) {
    const P = S.players[p]; let best = null;
    // 가운데(cw)와 둘레(sw) 크기 조합: 중+소4 · 대+소4 · 대+중4
    for (const [cw, sw] of [[2, 1], [3, 1], [3, 2]]) for (let ay = 0; ay < S.N; ay++) for (let ax = 0; ax < S.N; ax++) {
      const c = S.cells[ay][ax]; if (c ? !(c.p === p && !c.u && c.w === cw) : !(free(ax, ay) && P.pieces[cw])) continue;
      const nb = DIR8.map(([dx, dy]) => [ax + dx, ay + dy]);
      const have = nb.filter(q => { const o = own(p, ...q); return o && o.w === sw; }).length;
      const fr = nb.filter(q => free(...q)).sort((a, b) => Math.hypot(a[0] - S.R, a[1] - S.R) - Math.hypot(b[0] - S.R, b[1] - S.R));
      const k = Math.max(0, 4 - have); if (fr.length < k || P.pieces[sw] < k) continue;
      const need = fr.slice(0, k).map(q => ({ x: q[0], y: q[1], w: sw, h: rnd(6) }));
      if (!c) need.push({ x: ax, y: ay, w: cw, h: rnd(6) });
      if (!need.length) { const d = anyDot(p); if (d) return { cost: 1, score: 10, next: d }; continue; }   // 이미 갖춰졌으면 아무 점이나 놓아 인정받는다
      const rp = riskPlan(need); if (rp.worst > SAFE) continue;
      const score = need.length * 10 + rp.worst * 4 + Math.random();
      if (!best || score < best.score) best = { cost: need.length, score, next: { type: 'dot', ...rp.order[0] } };
    }
    return best;
  }
  function planBalance(p) {
    const P = S.players[p], N = S.N, opts = []; let pairs = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const mi = N - 1 - i, mj = N - 1 - j; if (j * N + i >= mj * N + mi) continue;
      const a = S.cells[j][i], m = S.cells[mj][mi];
      if (a && m) { if (a.p === p && m.p === p && !a.u && !m.u && a.w === m.w) pairs++; continue; }
      let need = null;
      if (a && a.p === p && !a.u && free(mi, mj) && P.pieces[a.w]) need = [{ x: mi, y: mj, w: a.w, h: rnd(6) }];
      else if (m && m.p === p && !m.u && free(i, j) && P.pieces[m.w]) need = [{ x: i, y: j, w: m.w, h: rnd(6) }];
      else if (!a && !m && free(i, j) && free(mi, mj)) { const w = [1, 2, 3].filter(k => P.pieces[k] >= 2).sort((x, y) => P.pieces[y] - P.pieces[x])[0]; if (w) need = [{ x: i, y: j, w, h: rnd(6) }, { x: mi, y: mj, w, h: rnd(6) }]; }
      if (!need) continue;
      const rp = riskPlan(need); if (rp.worst > SAFE) continue;
      opts.push({ cost: need.length, score: need.length * 10 + rp.worst * 4 + Math.random(), order: rp.order });
    }
    if (pairs >= 2) { const d = anyDot(p); return d ? { cost: 1, score: 10, next: d } : null; }
    opts.sort((x, y) => x.score - y.score);
    const k = 2 - pairs; if (opts.length < k) return null;
    const cost = opts.slice(0, k).reduce((s, o) => s + o.cost, 0);
    return { cost, score: cost * 10, next: { type: 'dot', ...opts[0].order[0] } };
  }
  const PLAN = { repeat: p => planRow(p, 'repeat'), grad: p => planRow(p, 'grad'), emph: planEmph, balance: planBalance,
                 variety: p => planFace(p, 'variety'), contrast: p => planFace(p, 'contrast'), unity: p => planFace(p, 'unity'),
                 analog: p => planFace(p, 'analog'), comp: p => planFace(p, 'comp') };

  // 지우기가 있으면 쓴다: 가장 앞선 상대의, 선이 이어진(만드는 중인) 소 점을 우선. 판이 떨어지는 지우기는 하지 않는다
  let erased = 0;
  function useErasers(p) {
    const P = S.players[p];
    while (S.attack && usableErasers(P) > 0 && !S.over && S.cur === p) {   // (지우기가 행동을 쓰는 규칙이면 쓰다가 차례가 넘어갈 수 있다)
      let best = null;
      for (let y = 0; y < S.N; y++) for (let x = 0; x < S.N; x++) {
        if (!canErase(x, y)) continue;
        const c = S.cells[y][x]; S.cells[y][x] = null; const r = torque().risk; S.cells[y][x] = c;
        if (r > SAFE) continue;
        const sc = S.players[c.p].done.size * 10 + ((S.adj[c.p].get(x + ',' + y) || { size: 0 }).size ? 5 : 0) + Math.random();
        if (!best || sc > best.sc) best = { sc, x, y };
      }
      if (!best) break;
      eraseDot(best.x, best.y); erased++;
    }
  }

  function choose(p, noise) {
    const P = S.players[p];
    useErasers(p);
    if (S.over || S.cur !== p) return { type: 'none' };
    if (Math.random() < noise) {            // 서툰 수: 아무 데나(떨어지지만 않게) 점을 놓는다
      const cand = [];
      for (let y = 0; y < S.N; y++) for (let x = 0; x < S.N; x++) if (free(x, y)) for (const w of [1, 2, 3]) if (P.pieces[w] && riskPlan([{ x, y, w }]).worst < 1) cand.push({ type: 'dot', x, y, w, h: rnd(6), card: null });
      return cand.length ? cand[rnd(cand.length)] : null;
    }
    let best = null;
    for (const c of S.cards) if (!P.done.has(c.id)) { const pl = PLAN[c.id](p); if (pl && (!best || pl.score < best.score)) best = { ...pl, card: c.id }; }
    return best ? { ...best.next, card: best.card } : null;
  }

  // 게임 속 '컴퓨터 상대'가 쓰는 입구: p번 사람의 다음 한 수를 고른다 (noise가 클수록 서툴다)
  window.botChoose = choose;

  window.simulate = function (games, cfg) {
    const keep = { ...opt }, fns = { render, showToast, addLog, showResult };
    Object.assign(opt, { map: cfg.map || 'desert', pushFrom: cfg.pushFrom || 1, ai: 0,
                         plusActs: cfg.plusActs || 0, seatDots: cfg.seatDots || [], seatErasers: cfg.seatErasers || [], seatDelay: cfg.seatDelay || [], n: cfg.n, size: cfg.size, acts: cfg.acts, goal: cfg.goal || 4, mode: 'end', attack: cfg.attack ? 'on' : 'off', finish: cfg.finish || 'round', rotate: !!cfg.rotate, delay: cfg.delay || 'auto', handicap: cfg.handicap || 'auto',
                         startMode: 'fixed', shield: cfg.shield !== false, erStart: cfg.erStart || 0, erPer: cfg.erPer || 'principle', erCost: !!cfg.erCost, hitCap: cfg.hitCap || 0 });
    window.render = window.showToast = window.addLog = window.showResult = () => {};
    const recs = [];
    try {
      for (let g = 0; g < games; g++) {
        newGame();
        if (cfg.cards) S.cards = cfg.cards.map(id => PRINCIPLES.find(c => c.id === id));
        const spent = S.players.map(() => ({})), per = []; let guard = 0, passes = 0, maxRisk = 0; erased = 0;
        while (!S.over && guard++ < 600) {
          const p = S.cur, P = S.players[p], act = choose(p, cfg.noise || 0);
          if (act && act.type === 'none') continue;
          if (!act) { passes++; endTurn(); continue; }
          const before = [...P.done], sig = S.lines.length + ':' + dotsLeft(P);
          if (act.card) spent[p][act.card] = (spent[p][act.card] || 0) + 1;
          if (act.type === 'dot') { S.sel = act.w; S.hue = act.h; placeDot(act.x, act.y); } else if (canLine(p, act.a, act.b)) drawLine(act.a, act.b);
          if (sig === S.lines.length + ':' + dotsLeft(P) && S.cur === p && !S.over) { passes++; endTurn(); continue; }   // 수가 먹히지 않았으면 넘긴다
          [...P.done].filter(id => !before.includes(id)).forEach(id => per.push({ id, acts: spent[p][id] || 0 }));
          maxRisk = Math.max(maxRisk, torque().risk);
        }
        // 우승: 3가지를 모두 완성한 사람 중 점수가 가장 높은 사람 (같은 바퀴 마무리 규칙)
        const full = S.players.filter(q => !q.fallen && q.done.size >= S.cards.length).sort((a, b) => b.score - a.score);
        recs.push({ cards: S.cards.map(c => c.id), winner: full.length ? S.players.indexOf(full[0]) : -1, full: full.length,
                    // 동점: 공격 규칙을 켠 판은 먼저 완성한 사람, 끈 판은 공동 우승 (게임 규칙과 같게)
                    winners: (w => S.attack ? [w.sort((a, b) => S.fullOrder.indexOf(a) - S.fullOrder.indexOf(b))[0]] : w)(full.filter(q => q.score === full[0].score).map(q => S.players.indexOf(q))),
                    gap: full.length > 1 ? full[0].score - full[1].score : null, fall: S.players.some(q => q.fallen),
                    round: S.round - (S.oi === 0 ? 1 : 0), done: S.players.map(q => q.done.size), per, passes, maxRisk, erased, hits: S.players.map(q => q.hits),
                    fullOrder: S.fullOrder.filter(i => !S.players[i].fallen), scores: S.players.map(q => q.score),
                    used: S.players.map(q => q.pieces).map((pc, i) => 0), dotsLeft: S.players.map(dotsLeft) });
      }
    } finally { Object.assign(opt, keep); Object.assign(window, fns); newGame(); }
    return recs;
  };

  // 같은 대국 기록에 우승 판정 방식만 바꿔 적용해 본다.
  // bonus: 완성한 순서대로 주는 추가 점수 [1등, 2등, ...] / tieFirst: 동점이면 먼저 완성한 사람이 이김
  window.judge = function (recs, n, bonus, tieFirst) {
    const seats = Array(n).fill(0); let ties = 0, games = 0;
    for (const r of recs) {
      if (!r.fullOrder.length) continue; games++;
      const sc = r.fullOrder.map((i, k) => ({ i, k, s: r.scores[i] + (bonus[k] || 0) }));
      const top = Math.max(...sc.map(e => e.s)); let w = sc.filter(e => e.s === top);
      if (w.length > 1 && tieFirst) w = [w[0]];
      if (w.length > 1) ties++;
      w.forEach(e => seats[e.i] += 1 / w.length);
    }
    return { 자리: seats.map(v => Math.round(v / games * 100)), 공동: Math.round(ties / games * 100) };
  };

  // 지우기가 얼마나 공정하게 쓰였는지 요약
  window.fairness = function (recs, n) {
    const won = recs.filter(r => r.winner >= 0), avg = a => a.length ? +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2) : null;
    const seats = Array.from({ length: n }, (_, i) => Math.round(won.reduce((s, r) => s + (r.winners.includes(i) ? 1 / r.winners.length : 0), 0) / won.length * 100));
    const uniq = recs.filter(r => { const m = Math.max(...r.hits); return m > 0 && r.hits.filter(h => h === m).length === 1; });   // 가장 많이 당한 사람이 한 명인 판
    return {
      자리: seats.join('·'), 자리차: Math.max(...seats) - Math.min(...seats),
      바퀴: avg(won.map(r => r.round)), 못끝낸: recs.length - won.length,
      지우기: avg(recs.map(r => r.erased)),
      최다피해평균: avg(recs.map(r => Math.max(...r.hits))), 세번이상당한판: Math.round(recs.filter(r => Math.max(...r.hits) >= 3).length / recs.length * 100) + '%',
      최다피해자우승: uniq.length ? Math.round(uniq.filter(r => r.winners.includes(r.hits.indexOf(Math.max(...r.hits)))).length / uniq.length * 100) + '%' : '-',
      혼자완성: Math.round(recs.filter(r => r.full === 1).length / recs.length * 100) + '%',
      점수차: avg(recs.filter(r => r.gap !== null).map(r => r.gap)),
    };
  };

  // 기록 요약
  window.summarize = function (recs, n) {
    const won = recs.filter(r => r.winner >= 0), avg = a => a.length ? +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2) : null;
    const hist = {}; won.forEach(r => hist[r.round] = (hist[r.round] || 0) + 1);
    const card = {};
    recs.forEach(r => r.cards.forEach(id => { const c = card[id] = card[id] || { dealt: 0, noWin: 0, acts: [], done: 0, slots: 0 }; c.dealt++; if (r.winner < 0) c.noWin++; c.slots += r.done.length; }));
    recs.forEach(r => r.per.forEach(e => { card[e.id].done++; if (e.acts) card[e.id].acts.push(e.acts); }));
    const cards = Object.fromEntries(Object.entries(card).map(([id, c]) => [id, { 나온판: c.dealt, 완성률: +(c.done / c.slots).toFixed(2), 평균행동: avg(c.acts), 승자없는판: c.noWin }]));
    return { 판수: recs.length, 우승자나온판: won.length, 떨어진판: recs.filter(r => r.fall).length,
             우승바퀴평균: avg(won.map(r => r.round)), 우승바퀴분포: hist,
             완성자수분포: recs.reduce((h, r) => (h[r.full] = (h[r.full] || 0) + 1, h), {}),
             최대기울기평균: avg(recs.map(r => r.maxRisk)), 기울기70넘은판: recs.filter(r => r.maxRisk >= .7).length,
             남은점평균: avg(recs.flatMap(r => r.dotsLeft)), 판당지우기평균: avg(recs.map(r => r.erased)),
             자리별우승: Array.from({ length: n }, (_, i) => +won.reduce((s, r) => s + (r.winners.includes(i) ? 1 / r.winners.length : 0), 0).toFixed(1)),
             공동우승판: won.filter(r => r.winners.length > 1).length, 일이등점수차평균: avg(recs.filter(r => r.gap !== null).map(r => r.gap)),
             승자없는판의카드: recs.filter(r => r.winner < 0).slice(0, 12).map(r => r.cards.join('+') + ' [' + r.done.join('') + ']'),
             카드: cards };
  };
})();
