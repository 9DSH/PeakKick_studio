import { useEffect, useRef } from 'react';
import { W, H, cl, draw, bAt, presence, view, proj, unproj } from './engine.js';

// Canvas + animation loop + click logic. `pb` is the playback ref owned by App.
export default function Board({ D, sel, se, mode, scrubT, pb, ph, cv, onEnd, onSelect, onMove, onAttach, onMsg }) {
  const R = useRef(); R.current = { D, sel, se, mode, scrubT };
  const oe = useRef(); oe.current = onEnd;

  useEffect(() => {
    const ctx = cv.current.getContext('2d'); let id;
    const loop = (now) => {
      const { D, sel, se, mode, scrubT } = R.current, p = pb.current, tot = D.kfs.at(-1).t + 1.2;
      let t, edit = false;
      if (p.on) { t = (now - p.t0) / 1000; if (t >= tot) { t = tot; p.on = false; p.hold = now + 500; oe.current(); } }
      else if (now < p.hold) t = tot;
      else if (mode === 'scrub') t = scrubT;
      else { t = D.kfs[sel].t; edit = true; }
      draw(ctx, D, t, edit, sel, se);
      if (ph.current) ph.current(t, p.on);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  const click = (e) => {
    const { D, sel, se, mode } = R.current;
    if (pb.current.on) return;
    if (mode === 'scrub') return onMsg('Pick a numbered keyframe on the timeline to edit.');
    const r = cv.current.getBoundingClientRect(), x = ((e.clientX - r.left) * W) / r.width, y = ((e.clientY - r.top) * H) / r.height, k = D.kfs[sel], v = view(k.field, D.meta.fit, k.sw);
    const near = (q, rad) => { const p = proj(v, q); return Math.hypot(p[0] - x, p[1] - y) < rad * v.k; };
    const onBall = near(bAt(D, k), 26), players = [];
    ['A', 'B'].forEach((t) => D.teams[t].players.forEach((p, i) => { if (presence(D, p, k.t, true) && near(k[t][i], 27 * (p.size || 1) + 8)) players.push(t + i); }));
    if (se === 'ball') {                       // ball selected: next click on a player = give him the ball
      if (onBall) return onAttach(null);        // click the ball again = let it go
      if (players.length) return onAttach(players[0]);
    } else {                                    // anything else selected: normal selecting
      if (onBall) return onSelect('ball');
      if (players.length) return onSelect(players[0]);
    }
    if (!se) return onMsg('Nothing is selected. Click a player or the ball first (right-click deselects).');
    const w = unproj(v, x, y);
    onMove(se, [+cl(w[0], -6, 74).toFixed(1), +cl(w[1], -6, 111).toFixed(1)]);
  };

  return <canvas ref={cv} id="c" width={W} height={H} onClick={click} onContextMenu={(e) => { e.preventDefault(); onSelect(null); }} />;
}
