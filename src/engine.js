// Pure logic: data model, camera views, interpolation, canvas drawing. No React in here.
// WORLD COORDINATES (metres): x 0-68 across, y 0-105 along the pitch. HOME goal is at y=0, AWAY goal is at y=105. Home attacks up (y=105), Away attacks down (y=0).
// Team keys: A = Home, B = Away.
export const W = 1080, H = 1920, HOLD_ANGLE = 45, HOLD_GAP = 3;
export const SIDE = 50;            // gap left and right of the field (px)
export const BOTTOM_GAP = 50;      // gap under the field (px). Raise it to keep the field clear of the YouTube Shorts UI
export const FIELD_TOP = 530;      // where the field starts (just under the expanded commentator box)
export const FIELD_BOTTOM = H - BOTTOM_GAP;
export const HALF_STRETCH = 1;  // half view: 1 = half field fills the whole area (width fits, nothing cropped); 0 = no stretching, but a gap is left at the bottom
export const RIGHT_BENCH_POINT = [60.5, 52.5];
export const PITCH_STYLE = {
  //        line thickness | penalty + 6-yard box width | goal frame width | centre circle + "D" arc width
  full: { line: 1.2, box: 1, goal: 1.2, circle: 1.15 },
  half: { line: 1.0, box: 1.15, goal: 1.4, circle: 1.65 },
};
export const cl = (v, a, b) => Math.max(a, Math.min(b, v));
const FONT = "'Segoe UI','Helvetica Neue',Arial,sans-serif", S0 = (W - 2 * SIDE) / 68;
const teamLineCache = new Map();

// ---------- camera: which field is on screen (goal always at the top) ----------
export const view = (field, fit = 'stretch', sw = false) => {
  const T = FIELD_TOP, B = FIELD_BOTTOM, up = (field === 'away') !== !!sw, half = field !== 'full';
  let y0 = !half || !up ? -2.4 : 52.5, y1 = !half || up ? 107.4 : 52.5, sx, sy;
  if (half) { // whole half field, width fits between the 30 px gaps, height fills the area
    const fill = (B - T) / (y1 - y0);
    sx = S0; sy = S0 + (fill - S0) * HALF_STRETCH;
    const ext = (B - T) / sy;              // with HALF_STRETCH = 1 this is exactly the half field
    if (up) y0 = y1 - ext; else y1 = y0 + ext;
  } else {
    const syFill = (B - T) / (y1 - y0);
    sx = fit === 'crop' ? Math.min(S0, syFill) : S0; sy = fit === 'crop' ? sx : syFill;
  }
  return { a: sx, d: -sy, e: (W - 68 * sx) / 2, f: T + y1 * sy, k: field === 'full' ? 0.8 : 1, up, top: T, bot: half ? B : T + (y1 - y0) * sy, y0, y1 };
};
export const proj = (v, q) => [v.a * q[0] + v.e, v.d * q[1] + v.f];
export const unproj = (v, x, y) => [(x - v.e) / v.a, (y - v.f) / v.d];

// ---------- data model ----------
export const dflt = (k, i) => [10 + (i % 4) * 16, (k === 'A' ? 25 : 85) + Math.floor(i / 4) * (k === 'A' ? 14 : -14)];
const STAT0 = () => ({ poss: [50, 50], shots: [0, 0], sot: [0, 0], big: [0, 0] });
export const mk = (t, nA, nB, id = 1, field = 'away') => {
  const a = dflt('A', 0);
  return {
    id, t, sw: false, sl: '1H', minute: 0, score: [0, 0], field,
    actor: null, hold: null, ball: [a[0] + 3, a[1] + 2],
    A: Array.from({ length: nA }, (_, i) => dflt('A', i)),
    B: Array.from({ length: nB }, (_, i) => dflt('B', i)),
    stats: STAT0(), comment: { type: 'info', text: '' }
  };
};

const RAW = [
  [0, [[34,60],[34,60],[30,68],[52,74],[36,84],[22,82],[28,72],[40,74],[24,80],[44,80],[34,104]]],
  [1, [[24,74],[34,64],[24,74],[50,80],[36,88],[20,86],[28,76],[38,80],[24,84],[44,84],[34,104]]],
  [2, [[47,86],[38,66],[26,78],[47,86],[37,92],[24,92],[30,80],[40,86],[26,88],[44,88],[34,104]]],
  [2.7, [[45,90],[40,68],[28,80],[45,90],[37,94],[26,96],[32,84],[40,90],[28,92],[42,92],[34,104]]],
  [3.4, [[36,95],[40,70],[30,82],[46,92],[36,95],[30,98],[34,90],[40,92],[30,96],[44,94],[34,104]]],
  [3.9, [[37.5,105.4],[40,70],[30,82],[46,92],[36,95],[30,98],[34,90],[40,92],[30,96],[44,94],[32,104.4]]],
  [4.6, [[37.5,105.4],[40,80],[31,88],[44,96],[36,95],[30,98],[34,90],[40,92],[30,96],[44,94],[32,104.4]]],
  [5.6, [[37.5,105.4],[40,92],[32,92],[41,97],[36,95],[31,98],[34,90],[40,92],[30,96],[44,94],[32,104.4]]]
];

const MOM = [
  [72, [1, 1], 'A0', 'A0', [54, 8, 3, 1], ['info', 'Home keep the ball in midfield']],
  [72.3, [1, 1], 'A1', null, [54, 8, 3, 1], ['pass', 'Nice pass to the number 10']],
  [72.6, [1, 1], 'A2', null, [55, 8, 3, 1], ['pass', 'Through ball for the winger']],
  [72.8, [1, 1], 'A2', 'A2', [55, 8, 3, 1], ['info', 'The winger races down the right']],
  [73, [1, 1], 'A3', null, [55, 8, 3, 1], ['pass', 'Cut back to the striker']],
  [73.2, [2, 1], 'A3', null, [55, 9, 4, 2], ['goal', 'GOAL! The striker finishes low']],
  [73.4, [2, 1], 'A3', null, [56, 9, 4, 2], ['info', 'Celebrations in the box']],
  [73.6, [2, 1], 'A3', null, [56, 9, 4, 2], ['info', 'Home lead 2-1']]
];

export const demo = () => ({
  meta: { showNames: true },
  teams: {
    A: { name: 'HOME', color: '#00e5ff', players: [8, 10, 7, 9, 11].map((n, i) => ({ n, name: ['Midfielder', 'Playmaker', 'Winger', 'Striker', ''][i], role: ['MID', 'MID', 'FWD', 'FWD', 'MID'][i] })) },
    B: { name: 'AWAY', color: '#f5c542', players: [4, 5, 3, 2, 1].map((n) => ({ n, name: n === 1 ? 'Keeper' : '', role: n === 1 ? 'GK' : 'DEF' })) }
  },
  kfs: RAW.map((r, i) => {
    const m = MOM[i];
    return {
      id: i + 1, t: r[0], minute: m[0], score: m[1], field: 'away',
      actor: m[2], hold: m[3], ball: r[1][0],
      A: r[1].slice(1, 6), B: r[1].slice(6, 11),
      stats: {
        poss: [m[4][0], 100 - m[4][0]],
        shots: [m[4][1], 6],
        sot: [m[4][2], 2],
        big: [m[4][3], 1]
      },
      comment: { type: m[5][0], text: m[5][1] }
    };
  })
});

// Accepts AI-written JSON: anything missing is carried forward from the previous keyframe,
// and `mv` lets a keyframe list only the entities that moved.
export function normalize(n) {
  n.meta = n.meta || { showNames: true };

  ['A', 'B'].forEach((k) => {
    const T = (n.teams[k] = n.teams[k] || {});
    T.name = T.name || (k === 'A' ? 'HOME' : 'AWAY');
    T.color = T.color || (k === 'A' ? '#00e5ff' : '#f5c542');
    if (!T.players?.length) T.players = [{ n: 1, name: '' }];
  });

  const nA = n.teams.A.players.length, nB = n.teams.B.players.length;
  let prev = null;

  n.kfs = n.kfs.map((f, i) => {
    const base = prev || mk(0, nA, nB);
    const g = { ...structuredClone(base), ...structuredClone(f) };

    if (g.subs?.length || g.ev === 'sub' || g.comment?.type === 'sub') {
      g.isolation = 'substitution';
      g.movements = {};
      delete g.ballMovement;
      g.hold = null;
    }

    g.id = f.id ?? i + 1;
    g.hold = f.hold ?? null;
    g.comment = f.comment || { type: 'info', text: '' };
    g.stats = { ...structuredClone(base.stats), ...(f.stats || {}) };

    if (f.mv) {
      Object.entries(f.mv).forEach(([id, q]) => {
        if (id === 'ball') g.ball = q;
        else if (g[id[0]]) g[id[0]][+id.slice(1)] = q;
      });
    }

    delete g.mv;

    // Do not carry event-specific data into later keyframes.
    ['subs', 'ev', 'evId', 'goalFor', 'og', 'pen', 'ph', 'htSubs', 'instant'].forEach((x) => {
      if (f[x] === undefined) delete g[x];
    });

    ['A', 'B'].forEach((k) => {
      const N = n.teams[k].players.length;
      while (g[k].length < N) g[k].push(dflt(k, g[k].length));
      g[k].length = N;
    });

    prev = g;
    return g;
  });

  return n;
}

// ---------- state at a moment ----------
export const stAt = (D, t) => {
  let r = D.kfs[0];
  for (const k of D.kfs) if (k.t <= t + 1e-6) r = k;
  return r;
};

export const minuteAt = (D, t) => {
  const k = D.kfs;
  let j = 0;
  while (j < k.length - 1 && t >= k[j + 1].t) j++;
  const a = k[j], b = k[j + 1];
  return b ? a.minute + (b.minute - a.minute) * cl((t - a.t) / (b.t - a.t), 0, 1) : a.minute;
};

// Player visibility:
// - join: player enters at the referenced keyframe.
// - leave: player exits at the referenced keyframe.
// - instant: no fade animation; useful for half-time substitutions.
export const presence = (D, p, t, edit) => {
  if (p.join === 'never') return 0;

  let al = 1;

  const jf = p.join != null && D.kfs.find((k) => k.id === p.join);
  const lf = p.leave != null && D.kfs.find((k) => k.id === p.leave);

  if (jf) {
    al = edit || jf.instant
      ? (t >= jf.t - 1e-6 ? 1 : 0)
      : Math.min(1, Math.max(0, (t - jf.t) / 0.4));
  }

  if (lf) {
    al *= edit || lf.instant
      ? (t >= lf.t - 1e-6 ? 0 : 1)
      : Math.min(1, Math.max(0, 1 - (t - lf.t) / 1.2));
  }

  return al;
};

const gp = (f, id) => (id === 'ball' ? f.ball : f[id[0]][+id.slice(1)]);

export const holdOff = (D, id, field, sw) => {
  const v = view(field, D.meta?.fit, sw);
  const p = D.teams[id[0]].players[+id.slice(1)] || {};
  const d = (27 * (p.size || 1) + 15 + HOLD_GAP) * v.k;
  const a = (HOLD_ANGLE * Math.PI) / 180;
  return [(Math.cos(a) * d) / Math.abs(v.a), (Math.sin(a) * d) / Math.abs(v.d)];
};

export const bAt = (D, f) => {
  if (!f.hold) return f.ball;
  const q = gp(f, f.hold), o = holdOff(D, f.hold, f.field, f.sw);
  return [q[0] + o[0], q[1] + o[1]];
};

export function pos(D, id, t) {
  const k = D.kfs, L = k[k.length - 1];
  const get = id === 'ball' ? (f) => bAt(D, f) : (f) => gp(f, id);

  const activeSub = k.find((f) =>
    f.isolation === 'substitution' &&
    f.subs?.length &&
    t >= f.t &&
    t <= f.t + (+f.subDuration || 2.4)
  );

  if (activeSub) {
    const sub = activeSub.subs.find((s) => s.o === id || s.i === id);

    if (sub) {
      const movement = activeSub.movements?.[id];
      const duration = +activeSub.subDuration || movement?.duration || 2.4;
      const u = cl((t - activeSub.t) / duration, 0, 1);
      const eased = u * u * (3 - 2 * u);

      if (movement?.start && movement?.end) {
        return [
          movement.start[0] + (movement.end[0] - movement.start[0]) * eased,
          movement.start[1] + (movement.end[1] - movement.start[1]) * eased
        ];
      }

      if (sub.o === id) return RIGHT_BENCH_POINT;
      if (sub.i === id) return gp(activeSub, id);
    }
  }

  if (t >= L.t) return get(L);
  if (t <= 0) return get(k[0]);

  let j = 0;
  while (t >= k[j + 1].t) j++;

  const a = k[j], b = k[j + 1];

  if (b.isolation === 'substitution' && b.subs?.length) {
    const sub = b.subs.find((s) => s.o === id || s.i === id);

    if (sub) {
      const duration = +b.subDuration || (+b.movements?.[id]?.duration) || 2.4;
      const elapsed = t - b.t;
      const u = cl(elapsed / duration, 0, 1);
      const eased = u * u * (3 - 2 * u);
      const movement = b.movements?.[id];

      if (sub.o === id) {
        if (movement?.start && movement?.end) {
          return [
            movement.start[0] + (movement.end[0] - movement.start[0]) * eased,
            movement.start[1] + (movement.end[1] - movement.start[1]) * eased
          ];
        }

        const start = a[id[0]]?.[+id.slice(1)] || gp(a, id);
        return [
          start[0] + (RIGHT_BENCH_POINT[0] - start[0]) * eased,
          start[1] + (RIGHT_BENCH_POINT[1] - start[1]) * eased
        ];
      }

      if (sub.i === id) {
        if (movement?.start && movement?.end) {
          return [
            movement.start[0] + (movement.end[0] - movement.start[0]) * eased,
            movement.start[1] + (movement.end[1] - movement.start[1]) * eased
          ];
        }

        const end = gp(b, id);
        return [
          RIGHT_BENCH_POINT[0] + (end[0] - RIGHT_BENCH_POINT[0]) * eased,
          RIGHT_BENCH_POINT[1] + (end[1] - RIGHT_BENCH_POINT[1]) * eased
        ];
      }
    }
  }

  if (id === 'ball' && a.hold && a.hold === b.hold) {
    const q = pos(D, a.hold, t), o = holdOff(D, a.hold, a.field, a.sw);
    return [q[0] + o[0], q[1] + o[1]];
  }

  const p = get(a), q = get(b);
  let u = (t - a.t) / (b.t - a.t);

  u = id === 'ball'
    ? 1 - (1 - u) * (1 - u)
    : u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;

  return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
}
// ---------- drawing ----------
const cache = new Map();

const img = (src) => {
  if (!src) return null;
  let i = cache.get(src);
  if (!i) {
    i = new Image();
    i.src = src;
    cache.set(src, i);
  }
  return i.complete && i.naturalWidth ? i : null;
};

const ink = (c) => {
  const n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#10181d' : '#fff';
};

function face(ctx, im, x, y, r, zoom, xo, yo) {
  const s = ((2 * r) / Math.min(im.naturalWidth, im.naturalHeight)) * zoom;
  const w = im.naturalWidth * s, h = im.naturalHeight * s;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.clip();
  ctx.drawImage(im, x - w / 2 + (xo / 100) * r, y - h / 2 + (yo / 100) * r, w, h);
  ctx.restore();
}

function tx(ctx, s, x, y, size, col, al = 'center', w = 800, maxWidth) {
  ctx.font = `${w} ${size}px ${FONT}`;
  ctx.fillStyle = col;
  ctx.textAlign = al;
  ctx.textBaseline = 'middle';
  maxWidth ? ctx.fillText(s, x, y, maxWidth) : ctx.fillText(s, x, y);
}

function panel(ctx, x, y, w, h, accent = '#22d3ee') {
  const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(32,46,56,.97)'); g.addColorStop(1, 'rgba(13,20,25,.97)');
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 8; ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x, y, w, h, 34); ctx.fill(); ctx.restore();
  ctx.strokeStyle = accent + '99'; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(x, y, w, h, 34); ctx.stroke();
  ctx.fillStyle = accent; ctx.beginPath(); ctx.roundRect(x + w / 2 - 70, y - 2, 140, 6, 3); ctx.fill();
}

function ui(ctx, D, t) {
  const st = stAt(D, t), TA = D.teams.A, TB = D.teams.B, sc = st.score, s = st.stats, tot = D.kfs.at(-1).t + 1.2;
  panel(ctx, 40, 20, 1000, 380);

  const minute = `${Math.floor(minuteAt(D, t))}'`;
  ctx.fillStyle = '#0a1115'; ctx.beginPath(); ctx.roundRect(494, 108, 92, 36, 18); ctx.fill();
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.stroke();
  tx(ctx, minute, 540, 126, 23, '#00e5ff', 'center', 800);
  ctx.fillStyle = '#0a1115'; ctx.beginPath(); ctx.roundRect(450, 151, 180, 59, 18); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 2; ctx.stroke();
  tx(ctx, `${sc[0]} : ${sc[1]}`, 540, 180, fit(ctx, `${sc[0]} : ${sc[1]}`, 165, 46, 800), '#fff', 'center', 800);

  badge(ctx, TA, 110, 153, 82);
  badge(ctx, TB, 970, 153, 82);
  const homeLines = teamLines(ctx, TA.name || 'HOME'), awayLines = teamLines(ctx, TB.name || 'AWAY');
  [[homeLines, 48, 110, TA.color], [awayLines, 908, 970, TB.color]].forEach(([lines, x, cx, color]) => {
    const height = lines.length > 1 ? 13 * lines.length + 5 : 29, top = 197;
    ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, top, 124, height, 8); ctx.fill();
    const size = fit(ctx, lines.length > 1 ? 'International' : lines[0], 118, lines.length > 1 ? 15 : 21, 700, 11);
    lines.forEach((line, i) => tx(ctx, line, cx, lines.length > 1 ? top + 8 + i * 13 : top + 15, fit(ctx, line, 118, size, 700, 11), ink(color), 'center', 700, 118));
  });

  const goals = D.kfs.filter((k) => k.comment?.type === 'goal' && k.t <= t + 1e-6 && k.actor);
  const goalRows = (team) => goals.filter((g) => (g.goalFor || g.actor[0]) === team).map((g) => {
    const p = D.teams[g.actor[0]]?.players[+g.actor.slice(1)] || {};
    const name = p.name?.trim().split(/\s+/).filter(Boolean).at(-1) || '#' + p.n;
    return `\u26bd ${name} ${Math.floor(g.minute)}'${g.og ? ' (OG)' : g.pen ? ' (P)' : ''}`;
  });
  [['A', 448, 'right'], ['B', 632, 'left']].forEach(([team, x, align]) => {
    const list = goalRows(team), maxLines = 5, crowded = list.length > maxLines;
    const rows = crowded ? [...list.slice(0, maxLines - 1), `+${list.length - maxLines + 1} more`] : list;
    const baseSize = list.length > 4 ? 17 : list.length > 2 ? 19 : 21;
    rows.forEach((text, i) => tx(ctx, text, x, 120 + i * 18, fit(ctx, text, 260, baseSize, 700, 13), '#e7f0f3', align, 700, 260));
  });

  const period = { '1H': '1st half', '2H': '2nd half', FT: 'Full time' }[st.sl] || '';
  const stats = [
    { key: 'poss', label: `Ball possession${period ? ` · ${period}` : ''}`, suffix: '%' },
    { key: 'shots', label: 'Total shots', suffix: '' },
    { key: 'sot', label: 'Shots on target', suffix: '' },
    { key: 'big', label: D.meta?.bigLabel || 'Corners', suffix: '' }
  ];
  stats.forEach(({ key, label, suffix }, i) => {
    const y = 242 + i * 30, a = +s[key][0] || 0, b = +s[key][1] || 0, sum = a + b;
    const ratio = sum ? cl(a / sum, 0, 1) : 0.5, barX = 196, barW = 688;
    ctx.fillStyle = '#0b1318'; ctx.beginPath(); ctx.roundRect(barX, y + 20, barW, 8, 4); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.roundRect(barX, y + 20, barW, 8, 4); ctx.clip();
    ctx.fillStyle = TA.color; ctx.fillRect(barX, y + 20, barW * ratio, 8);
    ctx.fillStyle = TB.color; ctx.fillRect(barX + barW * ratio, y + 20, barW * (1 - ratio), 8);
    ctx.restore();
    ctx.fillStyle = TA.color; ctx.beginPath(); ctx.roundRect(78, y, 80, 27, 10); ctx.fill();
    ctx.fillStyle = TB.color; ctx.beginPath(); ctx.roundRect(922, y, 80, 27, 10); ctx.fill();
    tx(ctx, `${a}${suffix}`, 118, y + 13, 17, ink(TA.color), 'center', 800);
    tx(ctx, `${b}${suffix}`, 962, y + 13, 17, ink(TB.color), 'center', 800);
    tx(ctx, label, 540, y + 9, fit(ctx, label, 430, 19, 700, 13), '#e1eaee', 'center', 700);
  });

  // ---- commentator box: title and text centred ----
  const cm = st.comment || { type: 'info', text: '' }, ev = EV[cm.type] || EV.info, goal = cm.type === 'goal', ac = goal ? '#f5c542' : '#22d3ee';
  panel(ctx, 40, 414, 1000, 104, ac);
  const head = `${ev[0]}  ${ev[1]}`; ctx.font = `800 22px ${FONT}`; const hw = ctx.measureText(head).width + 48;
  ctx.fillStyle = ac + '22'; ctx.beginPath(); ctx.roundRect(540 - hw / 2, 422, hw, 28, 14); ctx.fill(); ctx.strokeStyle = ac + '88'; ctx.lineWidth = 2; ctx.stroke();
  tx(ctx, head, 540, 436, 22, goal ? '#f5c542' : '#00e5ff', 'center', 800);
  ctx.font = `600 23px ${FONT}`; const lines = wrap(ctx, cm.text, 900);
  lines.forEach((l, i) => tx(ctx, l, 540, (lines.length > 1 ? 466 : 479) + i * 25, 23, '#fff', 'center', 600));
  ctx.fillStyle = '#ffffff22'; ctx.fillRect(95, 504, 890, 4); ctx.fillStyle = ac; ctx.fillRect(95, 504, 890 * cl(t / tot, 0, 1), 4);
  D.kfs.forEach((k) => { ctx.fillStyle = k.comment?.type === 'goal' ? '#f5c542' : '#ffffffaa'; ctx.beginPath(); ctx.arc(95 + 890 * (k.t / tot), 506, k.comment?.type === 'goal' ? 5 : 3, 0, 7); ctx.fill(); });
}

function wrap(ctx, text, maxW) {
  const out = [];
  let line = '';

  (text || '').split(' ').forEach((w) => {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) {
      out.push(line);
      line = w;
    } else {
      line = t;
    }
  });

  if (line) out.push(line);
  return out.slice(0, 2);
}

const EV = {
  info: ['\u2139\ufe0f', 'MATCH UPDATE'],
  pass: ['\ud83c\udfaf', 'NICE PASS'],
  shot: ['\ud83d\udca5', 'SHOT'],
  save: ['\ud83e\udde4', 'GREAT SAVE'],
  goal: ['\u26bd', 'GOAL'],
  yellow: ['\ud83d\udfe8', 'YELLOW CARD'],
  red: ['\ud83d\udfe5', 'RED CARD'],
  offside: ['\ud83d\udea9', 'OFFSIDE'],
  foul: ['\u26a0\ufe0f', 'FOUL'],
  corner: ['\ud83d\udcd0', 'CORNER'],
  sub: ['\ud83d\udd01', 'SUBSTITUTION']
};

export const EVENT_TYPES = Object.keys(EV);

const fit = (ctx, str, max, size, w = 700, min = 12) => {
  let z = size;
  ctx.font = `${w} ${z}px ${FONT}`;
  while (z > min && ctx.measureText(str).width > max) {
    z -= 2;
    ctx.font = `${w} ${z}px ${FONT}`;
  }
  return z;
};

function teamLines(ctx, value) {
  const text = String(value).trim();
  if (teamLineCache.has(text)) return teamLineCache.get(text);
  ctx.font = `600 16px ${FONT}`;
  const lines = [''];
  let truncated = false;
  for (const word of text.split(/\s+/)) {
    const i = lines.length - 1, candidate = lines[i] ? `${lines[i]} ${word}` : word;
    if (ctx.measureText(candidate).width <= 118 || !lines[i]) {
      lines[i] = candidate;
    } else if (lines.length < 3) {
      lines.push(word);
    } else {
      truncated = true;
      break;
    }
  }
  if (truncated) {
    let tail = lines[2];
    while (tail && ctx.measureText(`${tail}…`).width > 118) tail = tail.slice(0, -1);
    lines[2] = `${tail.trimEnd()}…`;
  }
  teamLineCache.set(text, lines);
  return lines;
}

function badge(ctx, T, cx, cy, size = 100) {
  const im = img(T.badge);

  if (im) {
    const k = Math.min(size / im.naturalWidth, size / im.naturalHeight);
    const w = im.naturalWidth * k, h = im.naturalHeight * k;
    ctx.drawImage(im, cx - w / 2, cy - h / 2, w, h);
  } else {
    ctx.fillStyle = T.color;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.44, 0, 7);
    ctx.fill();
    tx(ctx, (T.name || '').slice(0, 3).toUpperCase(), cx, cy + 2, Math.max(14, size * 0.34), ink(T.color), 'center', 800);
  }
}

function pitch(ctx, v, field) {
  const S = field === 'full' ? PITCH_STYLE.full : PITCH_STYLE.half;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0f2d33');
  g.addColorStop(.5, '#0f1a21');
  g.addColorStop(1, '#090d11');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.beginPath(); ctx.rect(SIDE, 0, W - 2 * SIDE, H); ctx.clip(); // nothing outside the 30 px side gaps
  ctx.setTransform(v.a, 0, 0, v.d, v.e, v.f);
  const u = 1 / Math.sqrt(Math.abs(v.a * v.d));
  const y0 = field === 'full' ? -3 : v.y0, y1 = field === 'full' ? 108 : v.y1;

  ctx.beginPath();
  ctx.rect(-2, y0, 72, y1 - y0);
  ctx.clip();

  ctx.fillStyle = 'rgba(40,120,100,.12)';
  ctx.fillRect(0, Math.max(y0, 0), 68, Math.min(y1, 105) - Math.max(y0, 0));

  ctx.strokeStyle = 'rgba(255,255,255,.30)';
  ctx.lineWidth = 5 * u * S.line;
  ctx.strokeRect(0, 0, 68, 105);

  // halfway line
  ctx.beginPath();
  ctx.moveTo(0, 52.5);
  ctx.lineTo(68, 52.5);
  ctx.stroke();

  // centre circle
  ctx.beginPath();
  ctx.ellipse(34, 52.5, 9.15 * S.circle, 9.15, 0, 0, 7);
  ctx.stroke();

  [[0, 1], [105, -1]].forEach(([y, s]) => {
    // penalty box and 6-yard box
    ctx.strokeRect(34 - 20.16 * S.box, s > 0 ? 0 : 105 - 16.5, 40.32 * S.box, 16.5);
    ctx.strokeRect(34 - 9.16 * S.box, s > 0 ? 0 : 105 - 5.5, 18.32 * S.box, 5.5);

    // penalty "D" arc
    ctx.beginPath();
    ctx.ellipse(34, y + s * 11, 9.15 * S.circle, 9.15, 0, s > 0 ? .645 : -2.497, s > 0 ? 2.497 : -.645);
    ctx.stroke();

    // penalty spot
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.beginPath();
    ctx.arc(34, y + s * 11, .4, 0, 7);
    ctx.fill();

    // goal frame
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 6 * u * S.line;
    ctx.strokeRect(34 - 3.66 * S.goal, s > 0 ? -2.4 : 105, 7.32 * S.goal, 2.4);

    // restore line style for the next side
    ctx.strokeStyle = 'rgba(255,255,255,.30)';
    ctx.lineWidth = 5 * u * S.line;
  });

  ctx.restore();
}
function dot(ctx, v, q, p, color, hi, showName, alpha = 1) {
  const [x, y] = proj(v, q);
  const r = 27 * (p.size || 1) * v.k, im = img(p.photo);
  ctx.globalAlpha = alpha;

  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath();
  ctx.ellipse(x + 4, y + r * .9, r, r * .45, 0, 0, 7);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.fill();

  if (im) face(ctx, im, x, y, r, p.zoom || 1, p.x || 0, p.y || 0);

  ctx.strokeStyle = hi ? '#fff' : im ? color : 'rgba(0,0,0,.55)';
  ctx.lineWidth = hi ? 8 : im ? 6 : 3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.stroke();

  if (!im) {
    ctx.fillStyle = ink(color);
    ctx.font = `700 ${Math.round(28 * v.k)}px Arial,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.n, x, y + 1);
  }

  if (showName && p.name && v.k === 1) {
    ctx.font = '700 28px Arial,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#0b1216';
    ctx.lineJoin = 'round';
    ctx.strokeText(p.name, x, y + r + 22);
    ctx.fillStyle = '#fff';
    ctx.fillText(p.name, x, y + r + 22);
  }

  ctx.globalAlpha = 1;
}

const rnd = (i) => {
  const s = Math.sin(i * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

// Draw a substitution notification card.
// Used by both normal substitutions and half-time substitutions.
function subCard(ctx, D, subs, y0 = FIELD_TOP + 60) {
  if (!subs?.length) return;
  const P = (id) => (!id || !D.teams[id[0]] ? {} : D.teams[id[0]].players[+id.slice(1)] || {});
  const n = Math.min(4, subs.length);
  ctx.save(); ctx.globalAlpha = .96; panel(ctx, 140, y0, 800, 64 + 40 * n); ctx.restore();
  tx(ctx, '\ud83d\udd01  SUBSTITUTION' + (n > 1 ? 'S' : ''), 540, y0 + 26, 26, '#00e5ff', 'center', 800);
  subs.slice(0, 4).forEach((s, i) => {
    const inc = P(s.i), out = P(s.o), y = y0 + 68 + i * 40;
    tx(ctx, `\u25b2 ${inc.name || 'Player'} #${inc.n ?? ''}`, 175, y, 30, '#3ddc84', 'left', 700);
    tx(ctx, `\u25bc ${out.name || 'Player'} #${out.n ?? ''}`, 560, y, 30, '#ff5d5d', 'left', 700);
  });
}

function subFx(ctx, D, v, t, edit, sel) {
  // Half-time substitutions: only the notification card, no bench and no movement.
  const hk = edit
    ? (D.kfs[sel]?.htSubs?.length ? D.kfs[sel] : null)
    : [...D.kfs].reverse().find((f) => f.htSubs?.length && t >= f.t && t < f.t + 3);
  if (hk) { subCard(ctx, D, hk.htSubs); return; }

  const k = edit ? D.kfs[sel] : [...D.kfs].reverse().find((f) => f.subs?.length && t >= f.t && t < f.t + 2.4);
  if (!k?.subs?.length) return;

  const pulse = 6 * (1 + Math.sin(t * 9)), tt = edit ? k.t : t;
  const P = (id) => (!id || !D.teams[id[0]] ? {} : D.teams[id[0]].players[+id.slice(1)] || {});

  k.subs.forEach((s) => {
    const bw = k.movements?.[s.o]?.benchPoint || RIGHT_BENCH_POINT, bench = proj(v, bw);
    ctx.save(); ctx.setLineDash([10, 10]); ctx.strokeStyle = '#bde8f2'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(bench[0], bench[1], 34 * v.k, 0, 7); ctx.stroke(); ctx.restore();
    tx(ctx, 'BENCH', bench[0], bench[1] - 42 * v.k, 22, '#bde8f2', 'center', 800);

    [['i', '\u25b2 ON', '#3ddc84'], ['o', '\u25bc OFF', '#ff5d5d']].forEach(([key, lab, c]) => {
      const playerId = key === 'o' ? s.o : s.i, m = k.movements?.[playerId], duration = m?.duration || k.subDuration || 2.4;
      const u = edit ? 1 : cl(t - k.t, 0, duration) / duration, eased = u * u * (3 - 2 * u);
      const world = m?.start && m?.end
        ? [m.start[0] + (m.end[0] - m.start[0]) * eased, m.start[1] + (m.end[1] - m.start[1]) * eased]
        : (key === 'o' ? bw : pos(D, s.i, tt));
      const p = P(playerId), q = proj(v, world), r = 27 * (p.size || 1) * v.k;

      ctx.strokeStyle = c; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(q[0], q[1], r + 10 + pulse, 0, 7); ctx.stroke();
      tx(ctx, lab, q[0], q[1] - r - 30, 24, c, 'center', 800);

      if (m?.start && m?.end) { // the path: OFF = spot -> bench, ON = bench -> spot
        const a = proj(v, m.start), b = proj(v, m.end);
        ctx.save(); ctx.setLineDash([14, 12]); ctx.strokeStyle = c + 'aa'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.restore();
      }
    });
  });

  subCard(ctx, D, k.subs, FIELD_TOP + 60);
}

export function draw(ctx, D, t, edit, sel, se) {
  const cur = D.kfs[sel];
  const s0 = edit ? cur : stAt(D, t);
  const field = s0.field;
  const v = view(field, D.meta.fit, s0.sw);
  const m = D.meta, TA = D.teams.A, TB = D.teams.B;
  const prev = edit && sel > 0 ? D.kfs[sel - 1] : null;
  const celebration = edit ? null : [...D.kfs].reverse().find((k) =>
    k.comment?.type === 'goal' && t >= k.t && t < k.t + 2.4
  );
  const scoringTeam = celebration && (celebration.goalFor || celebration.actor?.[0]);
  const attacksUp = !!scoringTeam && ((scoringTeam === 'A') !== !!celebration.sw);
  const celebrationPosition = (id) => {
    const player = D.teams[id[0]]?.players[+id.slice(1)];
    if (!celebration || !player || presence(D, player, celebration.t, false) <= 0) return pos(D, id, t);
    const start = pos(D, id, celebration.t);
    const inDefendingHalf = attacksUp ? start[1] > 52.5 : start[1] < 52.5;
    if (id[0] !== scoringTeam || !inDefendingHalf) return start;

    const cornerX = rnd((celebration.id || 1) * 31) < 0.5 ? 3 : 65;
    const goalY = attacksUp ? 103 : 2;
    const seed = (celebration.id || 1) * 101 + (id[0] === 'A' ? 37 : 73) + (+id.slice(1) * 17);
    const inward = Math.atan2(goalY > 52 ? -1 : 1, cornerX < 34 ? 1 : -1);
    const angle = inward + (rnd(seed) - 0.5) * Math.PI / 2, radius = 5 + rnd(seed + 11) * 7;
    const target = [
      cl(cornerX + Math.cos(angle) * radius, 2, 66),
      cl(goalY + Math.sin(angle) * radius, 1, 104)
    ];
    const u = cl((t - celebration.t) / 0.7, 0, 1);
    const eased = u * u * (3 - 2 * u);
    return [start[0] + (target[0] - start[0]) * eased, start[1] + (target[1] - start[1]) * eased];
  };

  pitch(ctx, v, field);
  ui(ctx, D, t);

  ctx.save();
  ctx.beginPath();
  ctx.rect(SIDE, v.top, W - 2 * SIDE, v.bot - v.top);
  ctx.clip();

  if (prev && cur.isolation !== 'substitution') {
    // Dashed lines: how far everything moves from the previous keyframe.
    ctx.lineWidth = 5;
    ctx.setLineDash([12, 12]);
    ctx.globalAlpha = .55;

    const L = (a, b, c) => {
      const p1 = proj(v, a), p2 = proj(v, b);
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.stroke();
    };

    L(bAt(D, prev), bAt(D, cur), '#f5c542');

    cur.A.forEach((p, i) => {
      if (presence(D, TA.players[i], prev.t, true)) L(prev.A[i], p, TA.color);
    });

    cur.B.forEach((p, i) => {
      if (presence(D, TB.players[i], prev.t, true)) L(prev.B[i], p, TB.color);
    });

    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  if (!edit) {
    ctx.strokeStyle = '#f5c542';
    ctx.lineWidth = 7;
    ctx.setLineDash([18, 14]);
    ctx.lineCap = 'round';
    ctx.beginPath();

    for (let s = 18; s >= 0; s--) {
      const q = proj(v, pos(D, 'ball', Math.max(0, t - s * .05)));
      s === 18 ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1]);
    }

    ctx.stroke();
    ctx.setLineDash([]);
  }

  const P = (k, T) => T.players.forEach((p, i) => {
    const id = k + i;

    const activeSub = D.kfs.find((f) =>
      f.isolation === 'substitution' &&
      f.subs?.length &&
      t >= f.t &&
      t <= f.t + (+f.subDuration || 2.4)
    );

    let al = edit && cur.hidden?.includes(id) ? 0 : presence(D, p, t, edit);

    if (activeSub?.subs?.some((s) => s.i === id || s.o === id)) al = 1;   // both walk at full opacity (the outgoing no longer fades before he reaches the bench)

    if (al > 0) {
      dot(ctx, v, celebrationPosition(id), p, T.color, edit && se === id, m.showNames, al);
    }
  });

  P('B', TB);
  P('A', TA);

  const bp = proj(v, pos(D, 'ball', t)), br = 15 * v.k;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(bp[0], bp[1], br, 0, 7);
  ctx.fill();

  ctx.strokeStyle = edit && se === 'ball' ? '#00e5ff' : '#14202a';
  ctx.lineWidth = edit && se === 'ball' ? 9 : 4;
  ctx.stroke();

  subFx(ctx, D, v, t, edit, sel);

  ctx.restore();

  if (edit) {
    tx(
      ctx,
      `KEYFRAME ${sel + 1} \u00b7 ${cur.t}s \u00b7 ${field.toUpperCase()} FIELD${cur.hold ? ' \u00b7 ball with ' + cur.hold : ''}`,
      W - SIDE, FIELD_TOP + 16, 26, '#00e5ff', 'right', 700
    );
  }

  if (!edit) {
    for (let i = 1; i < D.kfs.length; i++) {
      const k = D.kfs[i];

      if (
        (k.field !== D.kfs[i - 1].field || !!k.sw !== !!D.kfs[i - 1].sw) &&
        t >= k.t &&
        t - k.t < .25
      ) {
        ctx.globalAlpha = .9 * (1 - (t - k.t) / .25);
        ctx.fillStyle = '#0c1115';
        ctx.fillRect(0, v.top, W, v.bot - v.top);
        ctx.globalAlpha = 1;
      }
    }

    const g = celebration;

    if (g) {
      const k = t - g.t;
      const sp = proj(v, g.actor ? celebrationPosition(g.actor) : [34, 90]);

      ctx.strokeStyle = `rgba(255,255,255,${.5 + .4 * Math.sin(t * 8)})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(sp[0], sp[1], 44, 0, 7);
      ctx.stroke();

      for (let j = 0; j < 40; j++) {
        const a = rnd(j) * 6.283, vv = 150 + rnd(j + 50) * 320;
        ctx.globalAlpha = Math.max(0, 1 - k / 2.2);
        ctx.fillStyle = ['#00e5ff', '#f5c542', '#fff'][j % 3];
        ctx.fillRect(
          sp[0] + Math.cos(a) * vv * k,
          sp[1] - 60 + Math.sin(a) * vv * k + 220 * k * k,
          14, 14
        );
      }

      ctx.globalAlpha = Math.min(1, (2.4 - k) / .5);
      const s = Math.min(1, k / .3), e = 1 + .18 * Math.sin(s * 3.14);

      ctx.save();
      ctx.translate(W / 2, 1060);
      ctx.scale(s * e, s * e);
      ctx.font = `900 230px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 22;
      ctx.strokeStyle = '#0b1216';
      ctx.lineJoin = 'round';
      ctx.strokeText('GOAL!', 0, 0);
      ctx.fillStyle = '#f5c542';
      ctx.fillText('GOAL!', 0, 0);
      ctx.restore();

      ctx.globalAlpha = 1;
    }
  }
}