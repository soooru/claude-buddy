// 밥 받기 — 위젯 안에서 30초 동안 떨어지는 밥을 클마고치로 받는 미니게임.
// 창이 숨겨지거나 Claude 가 부르면 멈춘다. 애니메이션은 판이 돌아가는 동안에만 requestAnimationFrame 으로.
(function (root) {
  const PX = 3; // 도트 한 칸 = 3px
  const ROUND_MS = 30e3;
  const FOOD_PAL = { W: '#f1f3f5', E: '#1f1e1d', m: '#2b8a3e', Y: '#fcd34d', O: '#ff922b', R: '#ff6b6b', K: '#495057', k: '#868e96' };
  // 주먹밥 +1 · 별사탕 +3 · 버그 -2(잠깐 어지러움)
  const ITEMS = {
    rice: { pts: 1, art: ['..WWW..', '.WWWWW.', 'WWWWWWW', 'WWmmmWW', 'WmmmmmW', '.mmmmm.'] },
    star: { pts: 3, art: ['...Y...', '..YYY..', 'YYYOYYY', '.YYYYY.', '.YY.YY.', 'Y.....Y'] },
    bug: { pts: -2, art: ['.k...k.', '..k.k..', '.RRERR.', 'RRRERRR', 'RERERER', '.RRERR.'] },
  };

  function drawRows(ctx, rows, pal, x, y, flip) {
    const w = Math.max(...rows.map((r) => r.length));
    rows.forEach((line, ry) => [...line].forEach((ch, rx) => {
      const c = pal[ch];
      if (!c) return;
      ctx.fillStyle = c;
      ctx.fillRect(Math.round(x + (flip ? w - 1 - rx : rx) * PX), Math.round(y + ry * PX), PX + 0.2, PX + 0.2);
    }));
  }
  const size = (rows) => [Math.max(...rows.map((r) => r.length)) * PX, rows.length * PX];

  // canvas: 그릴 곳 · hooks: { art(), pal, calling(), onTick(left, score), onEnd(score), onPause(why) }
  function create(canvas, hooks) {
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0;
    let state = 'idle'; // idle · run · pause · over
    let raf = 0, last = 0, left = ROUND_MS, score = 0, items = [], spawnIn = 0, stunUntil = 0, pops = [];
    let px = 0, target = null, keys = { l: false, r: false }, flip = false;

    function fit() {
      const dpr = window.devicePixelRatio || 1;
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!px) px = W / 2;
    }

    function spawn(t) {
      // 뒤로 갈수록 빨라지고 버그가 늘어난다
      const r = Math.random();
      const bugP = 0.12 + 0.18 * t;
      const kind = r < bugP ? 'bug' : r < bugP + 0.08 ? 'star' : 'rice';
      const [w] = size(ITEMS[kind].art);
      // 처음 88px/s(+0~33) → 끝 200px/s — 초반만 조금 빠르게, 끝 속도는 그대로
      items.push({ kind, x: 6 + Math.random() * (W - w - 12), y: -24, v: (88 + 112 * t) + Math.random() * 33 });
    }

    function step(dt) {
      const t = 1 - left / ROUND_MS; // 0 → 1
      left -= dt;
      const now = performance.now();
      const art = hooks.art();
      const [pw, ph] = size(art);
      const py = H - ph - 6;
      // 움직이기 — 마우스 목표를 따라가거나 화살표/A·D. 어지러운 동안은 못 움직인다
      const speed = 300 * (dt / 1000);
      if (now > stunUntil) {
        let dir = (keys.r ? 1 : 0) - (keys.l ? 1 : 0);
        if (dir) target = null;
        else if (target != null) dir = Math.abs(target - px) < speed ? 0 : Math.sign(target - px);
        if (dir) flip = dir < 0;
        px = target != null && Math.abs(target - px) < speed ? target : px + dir * speed;
      }
      px = Math.max(pw / 2, Math.min(W - pw / 2, px));

      spawnIn -= dt;
      if (spawnIn <= 0) { spawn(t); spawnIn = 650 - 300 * t; }
      const top = py + ph * 0.25;
      items = items.filter((it) => {
        it.y += it.v * (dt / 1000);
        const [iw, ih] = size(ITEMS[it.kind].art);
        const hit = it.y + ih >= top && it.y < py + ph && it.x + iw > px - pw / 2 + 2 && it.x < px + pw / 2 - 2;
        if (hit) {
          const p = ITEMS[it.kind].pts;
          score = Math.max(0, score + p);
          if (it.kind === 'bug') stunUntil = now + 800;
          pops.push({ x: it.x, y: top - 6, text: p > 0 ? `+${p}` : `${p}`, bad: p < 0, until: now + 600 });
          return false;
        }
        return it.y < H;
      });
      pops = pops.filter((p) => p.until > now);
      return { art, pw, py, now };
    }

    function draw(s) {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#2e3138';
      ctx.fillRect(0, H - 4, W, 4); // 바닥
      for (const it of items) drawRows(ctx, ITEMS[it.kind].art, FOOD_PAL, it.x, it.y);
      const dizzy = s.now < stunUntil;
      const wob = dizzy ? Math.sin(s.now / 40) * 2 : 0;
      drawRows(ctx, s.art, hooks.pal, px - s.pw / 2 + wob, s.py, flip);
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      if (dizzy) { ctx.fillStyle = '#ff922b'; ctx.fillText('@_@', px, s.py - 4); }
      for (const p of pops) { ctx.fillStyle = p.bad ? '#ff6b6b' : '#fcd34d'; ctx.fillText(p.text, p.x + 10, p.y); }
    }

    function frame(ts) {
      if (state !== 'run') return;
      // 창이 가려졌다 돌아오면 dt 가 커진다 — 한 프레임에 너무 많이 진행하지 않게
      const dt = Math.min(50, ts - (last || ts));
      last = ts;
      if (hooks.calling()) { pause('call'); return; }
      const s = step(dt);
      draw(s);
      hooks.onTick(Math.max(0, left), score);
      if (left <= 0) { state = 'over'; items = []; draw(step(0)); hooks.onEnd(score); return; }
      raf = requestAnimationFrame(frame);
    }

    function start() {
      fit();
      left = ROUND_MS; score = 0; items = []; pops = []; spawnIn = 300; stunUntil = 0; px = W / 2; target = null;
      resume();
    }
    function resume() {
      if (state === 'run') return;
      state = 'run'; last = 0;
      raf = requestAnimationFrame(frame);
    }
    function pause(why) {
      if (state !== 'run') return;
      state = 'pause';
      cancelAnimationFrame(raf);
      hooks.onPause(why);
    }
    function stop() { cancelAnimationFrame(raf); state = 'idle'; }

    canvas.addEventListener('pointermove', (e) => { target = e.offsetX; });
    canvas.addEventListener('pointerleave', () => { target = null; });
    const key = (down) => (e) => {
      if (state !== 'run') return;
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') { keys.l = down; e.preventDefault(); }
      if (k === 'arrowright' || k === 'd') { keys.r = down; e.preventDefault(); }
    };
    document.addEventListener('keydown', key(true));
    document.addEventListener('keyup', key(false));
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause('hidden'); });
    window.addEventListener('blur', () => { keys = { l: false, r: false }; });

    return { start, resume, pause, stop, get state() { return state; } };
  }

  root.FoodGame = { create, ROUND_MS };
})(window);
