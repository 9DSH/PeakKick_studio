// Pure logic: data model, camera views, interpolation, canvas drawing. No React in here.
// WORLD COORDINATES (metres): x 0-68 across, y 0-105 along the pitch. HOME goal is at y=0, AWAY goal at y=105. Home attacks up (y=105), Away attacks down (y=0).
// Team keys: A = Home, B = Away.
export const W = 1080, H = 1920, OY = 650, HOLD_ANGLE = 45, HOLD_GAP = 3;
export const RIGHT_BENCH_POINT = [60.5,52.5];
export const cl = (v, a, b) => Math.max(a, Math.min(b, v));
const FONT = "'Segoe UI','Helvetica Neue',Arial,sans-serif", S0 = W / 68;

// ---------- camera: which field is on screen (goal always at the top) ----------
// field 'away' = Away goal at the TOP (Home attacking up) | 'home' = Home goal at the BOTTOM (Away attacking down) | 'full' = whole pitch
export const view = (field, fit = 'stretch', sw = false) => {
  // every field (a half pitch or the full pitch) fills the board from just under the commentator box (y=700) to the bottom (y=1910)
  // sw = teams have swapped ends (second half): the Home team's half is then the one with the goal at y=105
  const T = 650, B = 1910, up = (field === 'away') !== !!sw, y0 = field === 'full' || !up ? -2.4 : 52.5, y1 = field === 'full' || up ? 107.4 : 52.5, sy = (B - T) / (y1 - y0), sx = fit === 'crop' ? sy : S0;
  return { a: sx, d: -sy, e: (W - 68 * sx) / 2, f: T + y1 * sy, k: field === 'full' ? 0.8 : 1, up };
};
export const proj = (v, q) => [v.a * q[0] + v.e, v.d * q[1] + v.f];
export const unproj = (v, x, y) => [(x - v.e) / v.a, (y - v.f) / v.d];

// ---------- data model ----------
export const dflt = (k, i) => [10 + (i % 4) * 16, (k === 'A' ? 25 : 85) + Math.floor(i / 4) * (k === 'A' ? 14 : -14)];
const STAT0 = () => ({ poss: [50, 50], shots: [0, 0], sot: [0, 0], big: [0, 0] });
export const mk = (t, nA, nB, id = 1, field = 'away') => { const a = dflt('A', 0); return { id, t, sw: false, sl: '1H', minute: 0, score: [0, 0], field, actor: null, hold: null, ball: [a[0] + 3, a[1] + 2], A: Array.from({ length: nA }, (_, i) => dflt('A', i)), B: Array.from({ length: nB }, (_, i) => dflt('B', i)), stats: STAT0(), comment: { type: 'info', text: '' } }; };

const RAW = [[0,[[34,60],[34,60],[30,68],[52,74],[36,84],[22,82],[28,72],[40,74],[24,80],[44,80],[34,104]]],
[1,[[24,74],[34,64],[24,74],[50,80],[36,88],[20,86],[28,76],[38,80],[24,84],[44,84],[34,104]]],
[2,[[47,86],[38,66],[26,78],[47,86],[37,92],[24,92],[30,80],[40,86],[26,88],[44,88],[34,104]]],
[2.7,[[45,90],[40,68],[28,80],[45,90],[37,94],[26,96],[32,84],[40,90],[28,92],[42,92],[34,104]]],
[3.4,[[36,95],[40,70],[30,82],[46,92],[36,95],[30,98],[34,90],[40,92],[30,96],[44,94],[34,104]]],
[3.9,[[37.5,105.4],[40,70],[30,82],[46,92],[36,95],[30,98],[34,90],[40,92],[30,96],[44,94],[32,104.4]]],
[4.6,[[37.5,105.4],[40,80],[31,88],[44,96],[36,95],[30,98],[34,90],[40,92],[30,96],[44,94],[32,104.4]]],
[5.6,[[37.5,105.4],[40,92],[32,92],[41,97],[36,95],[31,98],[34,90],[40,92],[30,96],[44,94],[32,104.4]]]];
const MOM = [ // minute, score, actor, hold, stats [poss, shots, sot, big], comment
[72, [1, 1], 'A0', 'A0', [54, 8, 3, 1], ['info', 'Home keep the ball in midfield']],
[72.3, [1, 1], 'A1', null, [54, 8, 3, 1], ['pass', 'Nice pass to the number 10']],
[72.6, [1, 1], 'A2', null, [55, 8, 3, 1], ['pass', 'Through ball for the winger']],
[72.8, [1, 1], 'A2', 'A2', [55, 8, 3, 1], ['info', 'The winger races down the right']],
[73, [1, 1], 'A3', null, [55, 8, 3, 1], ['pass', 'Cut back to the striker']],
[73.2, [2, 1], 'A3', null, [55, 9, 4, 2], ['goal', 'GOAL! The striker finishes low']],
[73.4, [2, 1], 'A3', null, [56, 9, 4, 2], ['info', 'Celebrations in the box']],
[73.6, [2, 1], 'A3', null, [56, 9, 4, 2], ['info', 'Home lead 2-1']]];
export const demo = () => ({
  meta: { showNames: true },
  teams: { A: { name: 'HOME', color: '#00e5ff', players: [8, 10, 7, 9, 11].map((n, i) => ({ n, name: ['Midfielder', 'Playmaker', 'Winger', 'Striker', ''][i] })) },
           B: { name: 'AWAY', color: '#f5c542', players: [4, 5, 3, 2, 1].map((n) => ({ n, name: n === 1 ? 'Keeper' : '' })) } },
  kfs: RAW.map((r, i) => { const m = MOM[i]; return { id: i + 1, t: r[0], minute: m[0], score: m[1], field: 'away', actor: m[2], hold: m[3], ball: r[1][0], A: r[1].slice(1, 6), B: r[1].slice(6, 11),
    stats: { poss: [m[4][0], 100 - m[4][0]], shots: [m[4][1], 6], sot: [m[4][2], 2], big: [m[4][3], 1] }, comment: { type: m[5][0], text: m[5][1] } }; }),
});

// Accepts AI-written JSON: anything missing is carried forward from the previous keyframe, and `mv` lets a keyframe list only the entities that moved.
export function normalize(n) {
  n.meta = n.meta || { showNames: true };
  ['A', 'B'].forEach((k) => { const T = (n.teams[k] = n.teams[k] || {}); T.name = T.name || (k === 'A' ? 'HOME' : 'AWAY'); T.color = T.color || (k === 'A' ? '#00e5ff' : '#f5c542'); if (!T.players?.length) T.players = [{ n: 1, name: '' }]; });
  const nA = n.teams.A.players.length, nB = n.teams.B.players.length; let prev = null;
  n.kfs = n.kfs.map((f, i) => {
    const base = prev || mk(0, nA, nB), g = { ...structuredClone(base), ...structuredClone(f) };
    if (g.subs?.length || g.ev==='sub' || g.comment?.type==='sub') {
      g.isolation='substitution'; g.movements={}; delete g.ballMovement; g.hold=null;
    }
    g.id = f.id ?? i + 1; g.hold = f.hold ?? null; g.comment = f.comment || { type: 'info', text: '' }; g.stats = { ...structuredClone(base.stats), ...(f.stats || {}) };
    if (f.mv) Object.entries(f.mv).forEach(([id, q]) => { if (id === 'ball') g.ball = q; else if (g[id[0]]) g[id[0]][+id.slice(1)] = q; });
    delete g.mv; ['subs', 'ev', 'evId', 'goalFor', 'og', 'ph'].forEach((x) => { if (f[x] === undefined) delete g[x]; });
    ['A', 'B'].forEach((k) => { const N = n.teams[k].players.length; while (g[k].length < N) g[k].push(dflt(k, g[k].length)); g[k].length = N; });
    prev = g; return g;
  });
  return n;
}

// ---------- state at a moment ----------
export const stAt = (D, t) => { let r = D.kfs[0]; for (const k of D.kfs) if (k.t <= t + 1e-6) r = k; return r; };
export const minuteAt = (D, t) => { const k = D.kfs; let j = 0; while (j < k.length - 1 && t >= k[j + 1].t) j++; const a = k[j], b = k[j + 1]; return b ? a.minute + (b.minute - a.minute) * cl((t - a.t) / (b.t - a.t), 0, 1) : a.minute; };
export const presence = (D, p, t, edit) => { // join = keyframe id where he first appears ('never' = unused substitute); leave = keyframe id where he goes off
  if (p.join === 'never') return 0;
  let al = 1; const jf = p.join != null && D.kfs.find((k) => k.id === p.join), lf = p.leave != null && D.kfs.find((k) => k.id === p.leave);
  if (jf) al = edit ? (t >= jf.t - 1e-6 ? 1 : 0) : Math.min(1, Math.max(0, (t - jf.t) / 0.4));
  if (lf) al *= edit ? (t >= lf.t - 1e-6 ? 0 : 1) : Math.min(1, Math.max(0, 1 - (t - lf.t) / 1.2));
  return al;
};
const gp = (f, id) => (id === 'ball' ? f.ball : f[id[0]][+id.slice(1)]);
export const holdOff = (D, id, field, sw) => { const v = view(field, D.meta?.fit, sw), p = D.teams[id[0]].players[+id.slice(1)] || {}, d = (27 * (p.size || 1) + 15 + HOLD_GAP) * v.k, a = (HOLD_ANGLE * Math.PI) / 180; return [(Math.cos(a) * d) / Math.abs(v.a), (Math.sin(a) * d) / Math.abs(v.d)]; };
export const bAt = (D, f) => { if (!f.hold) return f.ball; const q = gp(f, f.hold), o = holdOff(D, f.hold, f.field, f.sw); return [q[0] + o[0], q[1] + o[1]]; };
export function pos(D, id, t) {
  const k = D.kfs, L = k[k.length - 1], get = id === 'ball' ? (f) => bAt(D, f) : (f) => gp(f, id);
  const activeSub=k.find(f=>f.isolation==='substitution'&&f.subs?.length&&t>=f.t&&t<=f.t+(+f.subDuration||2.4));
  if(activeSub){const sub=activeSub.subs.find(s=>s.o===id||s.i===id);if(sub){const movement=activeSub.movements?.[id];const duration=+activeSub.subDuration||(movement?.duration)||2.4;const u=cl((t-activeSub.t)/duration,0,1);const eased=u*u*(3-2*u);if(movement?.start&&movement?.end)return [movement.start[0]+(movement.end[0]-movement.start[0])*eased,movement.start[1]+(movement.end[1]-movement.start[1])*eased];if(sub.o===id)return RIGHT_BENCH_POINT;if(sub.i===id)return gp(activeSub,id)}}
  if (t >= L.t) return get(L);
  if (t <= 0) return get(k[0]);
  let j = 0; while (t >= k[j + 1].t) j++;
  const a = k[j], b = k[j + 1];
  if (b.isolation==='substitution' && b.subs?.length) {
    const sub=b.subs.find(s=>s.o===id||s.i===id);
    if(sub){
      const duration=+b.subDuration||(+b.movements?.[id]?.duration)||2.4;
      const elapsed=t-b.t, u=cl(elapsed/duration,0,1), eased=u*u*(3-2*u);
      const movement=b.movements?.[id];
      if(sub.o===id){
        if(movement?.start&&movement?.end)return [movement.start[0]+(movement.end[0]-movement.start[0])*eased,movement.start[1]+(movement.end[1]-movement.start[1])*eased];
        const start=a[id[0]]?.[+id.slice(1)]||gp(a,id);return [start[0]+(RIGHT_BENCH_POINT[0]-start[0])*eased,start[1]+(RIGHT_BENCH_POINT[1]-start[1])*eased];
      }
      if(sub.i===id){
        if(movement?.start&&movement?.end)return [movement.start[0]+(movement.end[0]-movement.start[0])*eased,movement.start[1]+(movement.end[1]-movement.start[1])*eased];
        const end=gp(b,id);return [RIGHT_BENCH_POINT[0]+(end[0]-RIGHT_BENCH_POINT[0])*eased,RIGHT_BENCH_POINT[1]+(end[1]-RIGHT_BENCH_POINT[1])*eased];
      }
    }
  }
  if (id === 'ball' && a.hold && a.hold === b.hold) { const q = pos(D, a.hold, t), o = holdOff(D, a.hold, a.field, a.sw); return [q[0] + o[0], q[1] + o[1]]; }
  const p = get(a), q = get(b); let u = (t - a.t) / (b.t - a.t);
  u = id === 'ball' ? 1 - (1 - u) * (1 - u) : u < .5 ? 2*u*u : 1-Math.pow(-2*u+2,2)/2;
  return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
}

// ---------- drawing ----------
const cache = new Map();
const img = (src) => { if (!src) return null; let i = cache.get(src); if (!i) { i = new Image(); i.src = src; cache.set(src, i); } return i.complete && i.naturalWidth ? i : null; };
const ink = (c) => { const n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#10181d' : '#fff'; };
function face(ctx, im, x, y, r, zoom, xo, yo) {
  const s = ((2 * r) / Math.min(im.naturalWidth, im.naturalHeight)) * zoom, w = im.naturalWidth * s, h = im.naturalHeight * s;
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip(); ctx.drawImage(im, x - w / 2 + (xo / 100) * r, y - h / 2 + (yo / 100) * r, w, h); ctx.restore();
}
function tx(ctx, s, x, y, size, col, al = 'center', w = 800) { ctx.font = `${w} ${size}px ${FONT}`; ctx.fillStyle = col; ctx.textAlign = al; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y); }
function panel(ctx, x, y, w, h) { const c = 30; ctx.fillStyle = 'rgba(35,39,42,.94)'; ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(x + c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + c); ctx.closePath(); ctx.fill(); ctx.stroke(); }
function wrap(ctx, text, maxW) { const out = []; let line = ''; (text || '').split(' ').forEach((w) => { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }); if (line) out.push(line); return out.slice(0, 2); }
const EV = { info: ['\u2139\ufe0f', 'MATCH UPDATE'], pass: ['\ud83c\udfaf', 'NICE PASS'], shot: ['\ud83d\udca5', 'SHOT'], save: ['\ud83e\udde4', 'GREAT SAVE'], goal: ['\u26bd', 'GOAL'], yellow: ['\ud83d\udfe8', 'YELLOW CARD'], red: ['\ud83d\udfe5', 'RED CARD'], offside: ['\ud83d\udea9', 'OFFSIDE'], foul: ['\u26a0\ufe0f', 'FOUL'], corner: ['\ud83d\udcd0', 'CORNER'], sub: ['\ud83d\udd01', 'SUBSTITUTION'] };
export const EVENT_TYPES = Object.keys(EV);

const fit = (ctx, str, max, size, w = 700) => { let z = size; ctx.font = `${w} ${z}px ${FONT}`; while (z > 22 && ctx.measureText(str).width > max) { z -= 2; ctx.font = `${w} ${z}px ${FONT}`; } return z; };
function badge(ctx, T, cx, cy) {
  const im = img(T.badge);
  if (im) { const k = Math.min(100 / im.naturalWidth, 100 / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k; ctx.drawImage(im, cx - w / 2, cy - h / 2, w, h); }
  else { ctx.fillStyle = T.color; ctx.beginPath(); ctx.arc(cx, cy, 46, 0, 7); ctx.fill(); tx(ctx, (T.name || '').slice(0, 3).toUpperCase(), cx, cy + 2, 34, ink(T.color), 'center', 800); }
}
function ui(ctx, D, t) {
  const st = stAt(D, t), TA = D.teams.A, TB = D.teams.B, sc = st.score, s = st.stats, tot = D.kfs.at(-1).t + 1.2;
  panel(ctx, 40, 28, 1000, 416);
  tx(ctx, `${Math.floor(minuteAt(D, t))}'`, 540, 58, 30, '#00e5ff', 'center', 800);
  [[TA,150],[TB,930]].forEach(([T,bx])=>{badge(ctx,T,bx,112);const z=fit(ctx,T.name,210,26,700);tx(ctx,T.name,bx,164,z,'#fff','center',700)});
  tx(ctx, String(sc[0]), 410, 112, 86, '#fff', 'right', 800); tx(ctx, String(sc[1]), 670, 112, 86, '#fff', 'left', 800);
  ctx.fillStyle='#34424a';ctx.beginPath();ctx.roundRect(500,82,80,62,16);ctx.fill();tx(ctx,'—',540,113,44,'#9fb1ba','center',700);
  const goals=D.kfs.filter(k=>k.comment?.type==='goal'&&k.t<=t+1e-6&&k.actor);
  ['A','B'].forEach(k=>{const side=k==='A';const recent=goals.filter(g=>(g.goalFor||g.actor[0])===k).at(-1);if(!recent)return;const p=D.teams[recent.actor[0]]?.players[+recent.actor.slice(1)]||{};const label=`${p.name||'#'+p.n}${recent.og?' (OG)':''}`;
    if(side){ctx.fillStyle='#152128';ctx.beginPath();ctx.roundRect(218,92,170,42,12);ctx.fill();tx(ctx,label,378,113,22,'#eef4f6','right',700);tx(ctx,`${Math.floor(recent.minute)}'`,228,113,22,'#00e5ff','left',800)}
    else{ctx.fillStyle='#152128';ctx.beginPath();ctx.roundRect(692,92,170,42,12);ctx.fill();tx(ctx,label,702,113,22,'#eef4f6','left',700);tx(ctx,`${Math.floor(recent.minute)}'`,852,113,22,'#00e5ff','right',800)}});
  tx(ctx,'Ball possession'+({'1H':' · 1st half','2H':' · 2nd half',FT:' · Full time'}[st.sl]||''),540,226,26,'#fff','center',700);
  const bx0=75,bw=930,hp=cl(s.poss[0]/Math.max(1,s.poss[0]+s.poss[1]),.05,.95);
  ctx.fillStyle=TA.color;ctx.beginPath();ctx.roundRect(bx0,246,bw*hp-2,34,17);ctx.fill();ctx.fillStyle=TB.color;ctx.beginPath();ctx.roundRect(bx0+bw*hp+2,246,bw*(1-hp)-2,34,17);ctx.fill();
  tx(ctx,s.poss[0]+'%',bx0+22,263,26,ink(TA.color),'left',800);tx(ctx,s.poss[1]+'%',bx0+bw-22,263,26,ink(TB.color),'right',800);
  [['Total shots','shots'],['Shots on target','sot'],[D.meta.bigLabel||'Big chances','big']].forEach(([lab,key],i)=>{const y=312+i*40;ctx.fillStyle='#1a252c';ctx.beginPath();ctx.roundRect(75,y-18,930,34,17);ctx.fill();tx(ctx,lab,540,y,24,'#c3cfd5','center',700);[[TA,118],[TB,962]].forEach(([T,x],j)=>{tx(ctx,String(s[key][j]),x,y,34,j===0?ink(TA.color):ink(TB.color),j===0?'left':'right',800)});});
  panel(ctx, 40, 448, 1000, 120);
  const cm = st.comment || { type: 'info', text: '' }, ev = EV[cm.type] || EV.info;
  tx(ctx, `${ev[0]}  ${ev[1]}`, 75, 470, 24, cm.type === 'goal' ? '#f5c542' : '#00e5ff', 'left', 700);
  ctx.font = `600 30px ${FONT}`; wrap(ctx, cm.text, 900).forEach((l, i) => tx(ctx, l, 75, 500 + i * 30, 30, '#fff', 'left', 600));
  ctx.fillStyle = '#ffffff22'; ctx.fillRect(75, 548, 890, 5); ctx.fillStyle = '#22d3ee'; ctx.fillRect(75, 548, 890 * cl(t / tot, 0, 1), 5);
  D.kfs.forEach((k) => { ctx.fillStyle = k.comment?.type === 'goal' ? '#f5c542' : '#ffffffaa'; ctx.beginPath(); ctx.arc(75 + 890 * (k.t / tot), 550, k.comment?.type === 'goal' ? 7 : 4, 0, 7); ctx.fill(); });
}
function pitch(ctx, v, field) {
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0f2d33'); g.addColorStop(.5, '#0f1a21'); g.addColorStop(1, '#090d11'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.setTransform(v.a, 0, 0, v.d, v.e, v.f); const u = 1 / Math.sqrt(Math.abs(v.a * v.d));
  const y0 = field !== 'full' && v.up ? 52.5 : -3, y1 = field !== 'full' && !v.up ? 52.5 : 108; // only the half that is on screen is drawn
  ctx.beginPath(); ctx.rect(-2, y0, 72, y1 - y0); ctx.clip();
  ctx.fillStyle = 'rgba(40,120,100,.12)'; ctx.fillRect(0, Math.max(y0, 0), 68, Math.min(y1, 105) - Math.max(y0, 0));
  ctx.strokeStyle = 'rgba(255,255,255,.30)'; ctx.lineWidth = 5 * u * (v.k < 1 ? 1.4 : 1);
  ctx.strokeRect(0, 0, 68, 105); ctx.beginPath(); ctx.moveTo(0, 52.5); ctx.lineTo(68, 52.5); ctx.stroke(); ctx.beginPath(); ctx.arc(34, 52.5, 9.15, 0, 7); ctx.stroke();
  [[0, 1], [105, -1]].forEach(([y, s]) => { // penalty areas, six-yard boxes, spots, arcs, goals
    ctx.strokeRect(13.84, s > 0 ? 0 : 105 - 16.5, 40.32, 16.5); ctx.strokeRect(24.84, s > 0 ? 0 : 105 - 5.5, 18.32, 5.5);
    ctx.beginPath(); ctx.arc(34, y + s * 11, 9.15, s > 0 ? .645 : -2.497, s > 0 ? 2.497 : -.645); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.beginPath(); ctx.arc(34, y + s * 11, .4, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 6 * u; ctx.strokeRect(30.34, s > 0 ? -2.4 : 105, 7.32, 2.4); ctx.strokeStyle = 'rgba(255,255,255,.30)'; ctx.lineWidth = 5 * u * (v.k < 1 ? 1.4 : 1);
  });
  ctx.restore();
}
function dot(ctx, v, q, p, color, hi, showName, alpha = 1) {
  const [x, y] = proj(v, q), r = 27 * (p.size || 1) * v.k, im = img(p.photo); ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(x + 4, y + r * .9, r, r * .45, 0, 0, 7); ctx.fill();
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  if (im) face(ctx, im, x, y, r, p.zoom || 1, p.x || 0, p.y || 0);
  ctx.strokeStyle = hi ? '#fff' : im ? color : 'rgba(0,0,0,.55)'; ctx.lineWidth = hi ? 8 : im ? 6 : 3; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
  if (!im) { ctx.fillStyle = ink(color); ctx.font = `700 ${Math.round(28 * v.k)}px Arial,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.n, x, y + 1); }
  if (showName && p.name && v.k === 1) { ctx.font = '700 28px Arial,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 7; ctx.strokeStyle = '#0b1216'; ctx.lineJoin = 'round'; ctx.strokeText(p.name, x, y + r + 22); ctx.fillStyle = '#fff'; ctx.fillText(p.name, x, y + r + 22); }
  ctx.globalAlpha = 1;
}
const rnd = (i) => { const s = Math.sin(i * 127.1) * 43758.5453; return s - Math.floor(s); };

function subFx(ctx, D, v, t, edit, sel) { // substitution animation: green ring + ON on the player coming on, red ring + OFF on the one going off, and a card naming both
  const k = edit ? D.kfs[sel] : [...D.kfs].reverse().find((f) => f.subs?.length && t >= f.t && t < f.t + 2.4);
  if (!k?.subs?.length) return;
  const pulse = 6 * (1 + Math.sin(t * 9)), P = (id) => D.teams[id[0]].players[+id.slice(1)] || {}, tt = edit ? k.t : t;
  const bench=proj(v,RIGHT_BENCH_POINT);
  ctx.save();ctx.setLineDash([10,10]);ctx.strokeStyle='#bde8f2';ctx.lineWidth=5;ctx.beginPath();ctx.arc(bench[0],bench[1],34*v.k,0,7);ctx.stroke();ctx.setLineDash([]);ctx.restore();tx(ctx,'BENCH',bench[0],bench[1]-42*v.k,22,'#bde8f2','center',800);
  k.subs.forEach((s) => [['i','\u25b2 ON','#3ddc84'],['o','\u25bc OFF','#ff5d5d']].forEach(([key,lab,c])=>{
    const m=k.movements?.[key==='o'?s.o:s.i], duration=m?.duration||k.subDuration||2.4;
    const elapsed=edit?duration:cl(t-k.t,0,duration); const u=edit?1:elapsed/duration; const eased=u*u*(3-2*u);
    let world;
    if(m){world=[m.start[0]+(m.end[0]-m.start[0])*eased,m.start[1]+(m.end[1]-m.start[1])*eased]}
    else world=key==='o'?RIGHT_BENCH_POINT:pos(D,s.i,tt);
    const p=P(s[key]),q=proj(v,world),r=27*(p.size||1)*v.k;
    ctx.strokeStyle=c;ctx.lineWidth=7;ctx.beginPath();ctx.arc(q[0],q[1],r+10+pulse,0,7);ctx.stroke();tx(ctx,lab,q[0],q[1]-r-30,24,c,'center',800);
    ctx.save();ctx.setLineDash([14,12]);ctx.strokeStyle=c+'aa';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(q[0],q[1]);ctx.lineTo(bench[0],bench[1]);ctx.stroke();ctx.restore();
  }));
  const n = Math.min(4, k.subs.length); ctx.save(); ctx.globalAlpha = .94; panel(ctx, 140, 716, 800, 64 + 40 * n); ctx.restore();
  tx(ctx, '\ud83d\udd01  SUBSTITUTION' + (n > 1 ? 'S' : ''), 540, 742, 26, '#00e5ff', 'center', 800);
  k.subs.slice(0, 4).forEach((s, i) => { const y = 784 + i * 40; tx(ctx, `\u25b2 ${P(s.i).name || 'Player'} #${P(s.i).n}`, 175, y, 30, '#3ddc84', 'left', 700); tx(ctx, `\u25bc ${P(s.o).name || 'Player'} #${P(s.o).n}`, 560, y, 30, '#ff5d5d', 'left', 700); });
}
export function draw(ctx, D, t, edit, sel, se) {
  const cur = D.kfs[sel], s0 = edit ? cur : stAt(D, t), field = s0.field, v = view(field, D.meta.fit, s0.sw), m = D.meta, TA = D.teams.A, TB = D.teams.B, prev = edit && sel > 0 ? D.kfs[sel - 1] : null;
  pitch(ctx, v, field); ui(ctx, D, t);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 650, W, H - 650); ctx.clip(); // players never draw over the panels
  if (prev && cur.isolation!=='substitution') { // dashed lines: how far everything moves from the previous keyframe
    ctx.lineWidth = 5; ctx.setLineDash([12, 12]); ctx.globalAlpha = .55;
    const L = (a, b, c) => { const p1 = proj(v, a), p2 = proj(v, b); ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke(); };
    L(bAt(D, prev), bAt(D, cur), '#f5c542'); cur.A.forEach((p, i) => presence(D, TA.players[i], prev.t, true) && L(prev.A[i], p, TA.color)); cur.B.forEach((p, i) => presence(D, TB.players[i], prev.t, true) && L(prev.B[i], p, TB.color));
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  if (!edit) { ctx.strokeStyle = '#f5c542'; ctx.lineWidth = 7; ctx.setLineDash([18, 14]); ctx.lineCap = 'round'; ctx.beginPath();
    for (let s = 18; s >= 0; s--) { const q = proj(v, pos(D, 'ball', Math.max(0, t - s * .05))); s === 18 ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1]); } ctx.stroke(); ctx.setLineDash([]); }
  const P = (k, T) => T.players.forEach((p, i) => { const id=k+i; const activeSub=D.kfs.find(f=>f.isolation==='substitution'&&f.subs?.length&&t>=f.t&&t<=f.t+(+f.subDuration||2.4)); let al=edit&&cur.hidden?.includes(id)?0:presence(D,p,t,edit); if(activeSub?.subAfter?.outgoing===id&&t>activeSub.t+(+activeSub.subDuration||2.4))al=0; if(activeSub?.subAfter?.incoming===id&&t<activeSub.t)al=0; if(activeSub?.subs?.some(s=>s.i===id)&&t>=activeSub.t)al=1; if(al>0)dot(ctx,v,pos(D,id,t),p,T.color,edit&&se===id,m.showNames,al); });
  P('B', TB); P('A', TA);
  const bp = proj(v, pos(D, 'ball', t)), br = 15 * v.k; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bp[0], bp[1], br, 0, 7); ctx.fill();
  ctx.strokeStyle = edit && se === 'ball' ? '#00e5ff' : '#14202a'; ctx.lineWidth = edit && se === 'ball' ? 9 : 4; ctx.stroke();
  subFx(ctx, D, v, t, edit, sel);
  ctx.restore();
  if (edit) tx(ctx, `KEYFRAME ${sel + 1} \u00b7 ${cur.t}s \u00b7 ${field.toUpperCase()} FIELD${cur.hold ? ' \u00b7 ball with ' + cur.hold : ''}`, W - 30, 658, 30, '#00e5ff', 'right', 700);
  if (!edit) {
    for (let i = 1; i < D.kfs.length; i++) { const k = D.kfs[i]; if ((k.field !== D.kfs[i - 1].field || !!k.sw !== !!D.kfs[i - 1].sw) && t >= k.t && t - k.t < .25) { ctx.globalAlpha = .9 * (1 - (t - k.t) / .25); ctx.fillStyle = '#0c1115'; ctx.fillRect(0, 650, W, H - 650); ctx.globalAlpha = 1; } }
    const g = [...D.kfs].reverse().find((k) => k.comment?.type === 'goal' && t >= k.t && t < k.t + 2.4);
    if (g) {
      const k = t - g.t, sp = proj(v, g.actor ? pos(D, g.actor, t) : [34, 90]);
      ctx.strokeStyle = `rgba(255,255,255,${.5 + .4 * Math.sin(t * 8)})`; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(sp[0], sp[1], 44, 0, 7); ctx.stroke();
      for (let j = 0; j < 40; j++) { const a = rnd(j) * 6.283, vv = 150 + rnd(j + 50) * 320; ctx.globalAlpha = Math.max(0, 1 - k / 2.2); ctx.fillStyle = ['#00e5ff', '#f5c542', '#fff'][j % 3]; ctx.fillRect(sp[0] + Math.cos(a) * vv * k, sp[1] - 60 + Math.sin(a) * vv * k + 220 * k * k, 14, 14); }
      ctx.globalAlpha = Math.min(1, (2.4 - k) / .5); const s = Math.min(1, k / .3), e = 1 + .18 * Math.sin(s * 3.14);
      ctx.save(); ctx.translate(W / 2, 1060); ctx.scale(s * e, s * e); ctx.font = `900 230px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 22; ctx.strokeStyle = '#0b1216'; ctx.lineJoin = 'round'; ctx.strokeText('GOAL!', 0, 0); ctx.fillStyle = '#f5c542'; ctx.fillText('GOAL!', 0, 0); ctx.restore(); ctx.globalAlpha = 1;
    }
  }
}
