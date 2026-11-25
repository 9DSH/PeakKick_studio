
// Real match import (API-Football). Calls go through the Vite dev-server proxy (see vite.config.js).
import { cl } from './engine.js';

// Passing simulation tuning
const PASS = {
  goalPasses: 4,
  idlePasses: 4,
  idleGap: 3,
  dt: 0.9
};

const rnd = (i) => {
  const s = Math.sin(i * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

export async function api(path) {
  const r = await fetch('/api-football' + path);
  const left = r.headers.get('x-ratelimit-requests-remaining');
  const j = await r.json().catch(() => ({}));
  const errs = j.errors
    ? (Array.isArray(j.errors) ? j.errors : Object.values(j.errors))
    : [];

  if (!r.ok || errs.length) {
    throw new Error(
      errs.join(' ') ||
      `API error ${r.status}. Is API_FOOTBALL_KEY set in .env and the dev server restarted?`
    );
  }

  return { data: j.response || [], left };
}

export async function listFixtures(date) {
  const { data, left } = await api('/fixtures?date=' + date);

  const rows = data
    .filter((f) => ['FT', 'AET', 'PEN'].includes(f.fixture.status.short))
    .map((f) => ({
      id: f.fixture.id,
      league: `${f.league.name} (${f.league.country})`,
      home: f.teams.home.name,
      away: f.teams.away.name,
      gh: f.goals.home,
      ga: f.goals.away
    }));

  return { rows, left };
}

export async function loadMatch(id) {
  // Full match statistics plus first-half and second-half numbers when available.
  const [fx, ln, ev, st] = await Promise.all([
    'fixtures?id=',
    'fixtures/lineups?fixture=',
    'fixtures/events?fixture=',
    'fixtures/statistics?half=true&fixture='
  ].map((p) => api('/' + p + id)));

  if (!fx.data[0]) throw new Error('Match not found.');

  if (ln.data.length < 2) {
    throw new Error('No lineups for this match yet (the competition may not be covered).');
  }

  return {
    D: buildMatch(fx.data[0], ln.data, ev.data, st.data),
    left: st.left
  };
}

// ---------- conversion: API data -> app project ----------

const lum = (c) => {
  const n = parseInt(c.slice(1), 16);
  return (
    ((n >> 16) * 299) +
    (((n >> 8) & 255) * 587) +
    ((n & 255) * 114)
  ) / 1000;
};

const kit = (c, fb) =>
  (/^[0-9a-f]{6}$/i.test(c || '') && lum('#' + c) > 70 ? '#' + c : fb);

const surname = (s) => {
  const p = (s || '').trim().split(/\s+/);
  return p.length > 1 && p[0].endsWith('.')
    ? p.slice(1).join(' ')
    : (s || '').trim();
};

const flip = (q) => [68 - q[0], 105 - q[1]];

function formation(ln) {
  // Starting XI -> positions in world metres.
  // First-half orientation: own goal at y=0 for Home.
  const rows = {};

  ln.startXI.forEach(({ player }, i) => {
    const [r, c] = (player.grid || '1:1').split(':').map(Number);
    (rows[r] = rows[r] || []).push({ i, c });
  });

  const R = Math.max(...Object.keys(rows).map(Number));
  const pos = [];

  Object.entries(rows).forEach(([r, list]) => {
    list.sort((a, b) => a.c - b.c);

    list.forEach((o, k) => {
      pos[o.i] = [
        (68 * (k + 1)) / (list.length + 1),
        5 + ((r - 1) * 44) / Math.max(1, R - 1)
      ];
    });
  });

  return pos;
}

export function buildMatch(fx, lineups, events, stats) {
  const hid = fx.teams.home.id;

  const L = {
    A: lineups.find((l) => l.team.id === hid) || lineups[0],
    B: lineups.find((l) => l.team.id !== hid) || lineups[1]
  };

  const name = {
    A: fx.teams.home.name,
    B: fx.teams.away.name
  };

  const idx = { A: {}, B: {} };
  const teams = {};
  const base = {}; // Formation spots in FIRST-half orientation.

  ['A', 'B'].forEach((k) => {
    const ln = L[k];
    const all = [...ln.startXI, ...ln.substitutes];

    teams[k] = {
      name: name[k],
      color: kit(
        ln.team.colors?.player?.primary,
        k === 'A' ? '#00e5ff' : '#f5c542'
      ),
      formation: ln.formation,

      players: all.map(({ player }, i) => {
        idx[k][player.id] = i;

        return {
          n: player.number ?? '',
          name: surname(player.name),
          ...(i >= ln.startXI.length
            ? { bench: true, join: 'never' }
            : {})
        };
      })
    };

    const fp = formation(ln);

    base[k] = all.map((_, i) => {
      const q = fp[i] || [34, -6];

      return i < ln.startXI.length
        ? (k === 'A' ? q : flip(q))
        : [34, -6];
    });
  });

  // ---- Statistics: full match, first half, second half ----
  // First/second-half statistics are taken from API when present.
  // Otherwise, they are estimated from full-match statistics.

  const pick = (arr) => {
    const g = (n) =>
      parseFloat(String(arr?.find((x) => x.type === n)?.value ?? 0)) || 0;

    return {
      poss: g('Ball Possession'),
      shots: g('Total Shots'),
      sot: g('Shots on Goal'),
      big: g('Corner Kicks')
    };
  };

  const halfArr = (t, re) => {
    const key = Object.keys(t || {}).find(
      (x) => x !== 'statistics' && Array.isArray(t[x]) && re.test(x)
    );

    return key ? t[key] : null;
  };

  const fin = { A: {}, B: {} };
  let statsSrc = 'estimated';

  ['A', 'B'].forEach((k) => {
    const t = stats.find((s) => s.team.id === L[k].team.id);
    const full = pick(t?.statistics);

    let h1 = halfArr(t, /1|first/i);
    let h2 = halfArr(t, /2|second/i);

    h1 = h1 && pick(h1);
    h2 = h2 && pick(h2);

    if (h1) {
      statsSrc = 'api';

      if (!h2) {
        h2 = {
          poss: full.poss,
          shots: full.shots - h1.shots,
          sot: full.sot - h1.sot,
          big: full.big - h1.big
        };
      }
    } else {
      const e = (key) => Math.round(full[key] * 0.45);

      h1 = {
        poss: full.poss,
        shots: e('shots'),
        sot: e('sot'),
        big: e('big')
      };

      h2 = {
        poss: full.poss,
        shots: full.shots - h1.shots,
        sot: full.sot - h1.sot,
        big: full.big - h1.big
      };
    }

    [h1, h2].forEach((h) => {
      if (!h.poss) h.poss = full.poss || 50;
    });

    fin[k] = { full, h1, h2 };
  });

  if (!fin.A.full.poss && !fin.B.full.poss) {
    ['full', 'h1', 'h2'].forEach((s) => {
      fin.A[s].poss = fin.B[s].poss = 50;
    });
  }

  // ---------- Match events and simulation state ----------

  const evs = events
    .map((e) => ({
      ...e,
      m: e.time.elapsed + (e.time.extra || 0)
    }))
    .sort((a, b) => a.m - b.m);

  // Half-time substitutions are silent:
  // no bench walk, only a notification at the second-half kick-off.
  const htEvs = evs.filter(
    (e) =>
      e.type === 'subst' &&
      !e.time.extra &&
      (e.time.elapsed === 45 || e.time.elapsed === 46)
  );

  const lastM = Math.max(90, ...evs.map((e) => e.m));

  const score = [0, 0];
  const kfs = [];
  const evList = [];

  let per = '1H';
  let swapped = false;
  let t = 0;
  let ball = [34, 52.5];
  let curField = null;
  let htDone = false;
  let curMin = 0;
  let prevM = 0;

  // Players currently on the pitch.
  const active = {
    A: [...L.A.startXI.keys()],
    B: [...L.B.startXI.keys()]
  };

  // Goalkeeper index.
  const gk = { A: 0, B: 0 };

  const stat = (m, p = per) => {
    const s =
      p === 'FT'
        ? 1
        : p === '1H'
          ? cl(m / 45, 0, 1)
          : cl((m - 45) / Math.max(1, lastM - 45), 0, 1);

    const src =
      p === 'FT'
        ? 'full'
        : p === '1H'
          ? 'h1'
          : 'h2';

    const f = (key, k) => Math.round(fin[k][src][key] * s);

    return {
      poss: [
        Math.round(fin.A[src].poss),
        Math.round(fin.B[src].poss)
      ],
      shots: [
        f('shots', 'A'),
        f('shots', 'B')
      ],
      sot: [
        f('sot', 'A'),
        f('sot', 'B')
      ],
      big: [
        f('big', 'A'),
        f('big', 'B')
      ]
    };
  };

  const K = (dt, m, field, pos, extra) => {
    t += dt;
    curMin = m;

    const k = {
      id: kfs.length + 1,
      t: +t.toFixed(1),
      minute: m,
      score: [...score],
      field,
      sw: swapped,
      sl: per,
      actor: null,
      hold: null,
      ball: [...ball],
      A: pos.A.map((q) => [...q]),
      B: pos.B.map((q) => [...q]),
      stats: stat(m),
      comment: {
        type: 'info',
        text: ''
      },
      ...extra
    };

    kfs.push(k);
    return k;
  };

  const P = (k, i) => `${k}${i}`;

  const pname = (k, i) =>
    teams[k].players[i]?.name || '';

  const nm = (k, i) =>
    pname(k, i) || '#' + (teams[k].players[i]?.n ?? '');

  const copy = () => {
    const p = {
      A: base.A.map((q) => [...q]),
      B: base.B.map((q) => [...q])
    };

    if (swapped) {
      ['A', 'B'].forEach((k) => {
        p[k] = p[k].map(flip);
      });
    }

    return p;
  };

  const toBase = (q) => (swapped ? flip(q) : q);

  // +1 = attacks toward y=105.
  const dir = (atk) => ((atk === 'A') !== swapped ? 1 : -1);

  const shift = (pos, atk, dA, dD) => {
    ['A', 'B'].forEach((k) => {
      const n = L[k].startXI.length;

      pos[k].forEach((q, i) => {
        if (i === gk[k] || !active[k].includes(i)) return;

        const isAtt = k === atk;
        const ts = dir(atk) * (isAtt ? dA : dD);
        const ph = (i % n) / n;

        const st = isAtt
          ? Math.sin(ph * Math.PI) * 3
          : -Math.sin(ph * Math.PI) * 1.5;

        q[0] = cl(q[0] + st, 3, 65);
        q[1] = cl(q[1] + ts, 3, 102);
      });
    });

    return pos;
  };

  const atkOf = (f) => (f === 'away' ? 'A' : 'B');
  const fieldOf = (atk) => (atk === 'A' ? 'away' : 'home');

  const midOf = (k) => {
    let best = 1;
    let bd = 1e9;

    base[k].forEach((q, i) => {
      if (i === 0 || i >= L[k].startXI.length) return;

      const d = Math.abs(q[1] - 52.5);

      if (d < bd) {
        bd = d;
        best = i;
      }
    });

    return best;
  };

  const go = (target, m) => {
    // Camera moves to the half where the ball is.
    // A short bridge shows the ball coming forward from halfway.

    if (curField === target) return;

    const atk = atkOf(target);
    const c = midOf(atk);
    const pos = shift(copy(), atk, 12, 4);
    const d = dir(atk);

    pos[atk][c] = [34, d > 0 ? 55 : 50];
    ball = [35.5, d > 0 ? 56.5 : 48.5];

    K(1.4, m, target, pos, {
      actor: P(atk, c),
      hold: P(atk, c),
      comment: {
        type: 'info',
        text: `${name[atk]} bring the ball forward`
      }
    });

    curField = target;
    ball = [34, 52.5];
  };

  // ---------- Realistic passing sequences ----------

  const fwd = (atk, i) =>
    atk === 'A'
      ? base.A[i][1]
      : 105 - base.B[i][1];

  const pickChain = (atk, n, seed, last, avoid) => {
    // Select players from deeper midfield to the front.
    // Pass between different players.

    const pool = active[atk]
      .filter((x) => x !== gk[atk])
      .sort(
        (a, b) =>
          fwd(atk, a) - fwd(atk, b) ||
          base[atk][a][0] - base[atk][b][0]
      );

    const cand = pool.slice(-7);
    const out = [];

    for (let j = 0; j < n; j++) {
      const r = cl(
        Math.round(
          (cand.length - 1) *
          (n > 1 ? j / (n - 1) : 1) +
          (rnd(seed + j) - 0.5) * 2
        ),
        0,
        cand.length - 1
      );

      let c = cand[r];

      if (c === out.at(-1)) {
        c = cand[(r + 1) % cand.length];
      }

      out.push(c);
    }

    if (last != null) {
      out[out.length - 1] = last;
    } else if (out.at(-1) === avoid) {
      out[out.length - 1] =
        cand.find(
          (c) =>
            c !== avoid &&
            c !== out.at(-2)
        ) ?? out.at(-1);
    }

    if (
      out.length > 1 &&
      out.at(-1) === out.at(-2)
    ) {
      out[out.length - 2] =
        cand.find(
          (c) =>
            c !== out.at(-1) &&
            c !== out.at(-3)
        ) ?? out.at(-2);
    }

    return out;
  };

  const vis = (atk, q, h) => {
    const o = (h % 4) * 2.5;

    return dir(atk) > 0
      ? [q[0], Math.max(q[1], 58 + o)]
      : [q[0], Math.min(q[1], 47 - o)];
  };

  const emitChain = (
    atk,
    ids,
    mA,
    mB,
    dA0,
    dA1,
    first
  ) => {
    // One keyframe per pass.
    // The ball changes owner with every pass.

    const d = dir(atk);

    ids.forEach((h, j) => {
      const u =
        ids.length > 1
          ? j / (ids.length - 1)
          : 1;

      const pos = shift(
        copy(),
        atk,
        dA0 + (dA1 - dA0) * u,
        4 + 4 * u
      );

      const id = P(atk, h);

      pos[atk][h] = vis(atk, pos[atk][h], h);

      ball = [
        pos[atk][h][0] + 1,
        pos[atk][h][1] + d * 1.2
      ];

      K(
        PASS.dt,
        Math.max(curMin, mA + (mB - mA) * u),
        fieldOf(atk),
        pos,
        {
          actor: id,
          hold: id,
          comment: {
            type: j ? 'pass' : 'info',
            text: j
              ? `Pass: ${nm(atk, ids[j - 1])} finds ${nm(atk, h)}`
              : first
          }
        }
      );
    });
  };

  const idleTo = (m1) => {
    // During quiet periods, the team in possession keeps passing.

    const gap = m1 - prevM;

    if (gap >= PASS.idleGap) {
      const m0 = prevM + 0.6;

      const atk = curField
        ? atkOf(curField)
        : (
            rnd(m0 * 13) * 100 <
            (fin.A.full.poss || 50)
              ? 'A'
              : 'B'
          );

      go(fieldOf(atk), m0);

      emitChain(
        atk,
        pickChain(
          atk,
          cl(Math.round(gap / 4) + 2, 3, PASS.idlePasses),
          Math.floor(m0 * 7)
        ),
        m0,
        Math.max(m0, m1 - 1.6),
        6,
        16,
        `${name[atk]} keep the ball and look for an opening`
      );
    }

    prevM = Math.max(prevM, m1);
  };

  const who = (e) => {
    const k = e.team.id === hid ? 'A' : 'B';
    return [k, idx[k][e.player?.id]];
  };

  // ---------- Half-time ----------

  const halfTime = () => {
    htDone = true;

    const gather = copy();

    gather.A.forEach((q) => {
      q[0] = 60.5;
      q[1] = 52.5;
    });

    gather.B.forEach((q) => {
      q[0] = 60.5;
      q[1] = 52.5;
    });

    ball = [60.5, 52.5];

    const hk = K(1.8, 45, 'full', gather, {
      ph: 'HT',
      instant: true,
      comment: {
        type: 'info',
        text: `Half-time: ${name.A} ${score[0]} - ${score[1]} ${name.B}`
      }
    });

    per = '2H';
    swapped = true;
    curField = null;
    prevM = 45;

    const made = [];

    // Half-time substitutions:
    // Swap the shirts silently, without bench animations.

    htEvs.forEach((s) => {
      const [sk, oi] = who(s);
      const ni = idx[sk][s.assist?.id];

      if (oi == null || ni == null) return;

      base[sk][ni] = [...base[sk][oi]];
      base[sk][oi] = [34, -6];

      made.push({
        k: sk,
        o: oi,
        i: ni
      });

      active[sk] = active[sk].map(
        (x) => (x === oi ? ni : x)
      );

      if (gk[sk] === oi) gk[sk] = ni;
    });

    const restart = copy();

    ['A', 'B'].forEach((k) => {
      restart[k].forEach((q) => {
        q[0] = cl(q[0], 3, 65);
        q[1] = cl(q[1], 3, 102);
      });
    });

    ball = [34, 52.5];

    const txt = made
      .map((s) => `${nm(s.k, s.i)} for ${nm(s.k, s.o)}`)
      .join(', ')
      .slice(0, 110);

    const rk = K(1.8, 45, 'full', restart, {
      ph: 'H2',

      instant: true,

      ...(made.length
        ? {
            htSubs: made.map((s) => ({
              o: P(s.k, s.o),
              i: P(s.k, s.i),
              k: s.k
            })),
            actor: P(made[0].k, made[0].i)
          }
        : {}),

      comment: made.length
        ? {
            type: 'sub',
            text: txt
          }
        : {
            type: 'info',
            text: 'Second half kick-off: teams swap ends'
          }
    });

    made.forEach((s) => {
      teams[s.k].players[s.o].leave = hk.id;
      teams[s.k].players[s.i].join = rk.id;
    });
  };

  // ---------- Match simulation ----------

  K(0, 0, 'full', copy(), {
    comment: {
      type: 'info',
      text: `Kick-off: ${name.A} (${L.A.formation}) v ${name.B} (${L.B.formation})`
    }
  });

  for (let g = 0; g < evs.length; g++) {
    const e = evs[g];

    if (htEvs.includes(e)) continue;

    if (!htDone && e.time.elapsed > 45) {
      idleTo(45);
      halfTime();
    }

    idleTo(e.m);

    const [k, i] = who(e);
    const o = k === 'A' ? 'B' : 'A';
    const hh = per === '1H' ? 1 : 2;

    // ---------- GOAL ----------

    if (e.type === 'Goal' && e.detail !== 'Missed Penalty') {
      const og = /own/i.test(e.detail || '');
      const atk = og ? o : k;

      const ai =
        e.assist?.id != null
          ? idx[atk][e.assist.id]
          : undefined;

      go(fieldOf(atk), e.m);

      const d = dir(atk);

      const assister =
        ai != null &&
        active[atk].includes(ai) &&
        ai !== gk[atk] &&
        !(k === atk && ai === i)
          ? ai
          : null;

      const chain = pickChain(
        atk,
        PASS.goalPasses,
        Math.floor(e.m * 5),
        assister,
        k === atk ? i : null
      );

      // Several passes between different players before the goal.
      emitChain(
        atk,
        chain,
        e.m - 1.6,
        e.m - 0.8,
        10,
        24,
        `${name[atk]} build from the back`
      );

      const lastP = chain.at(-1);

      const sId =
        i != null
          ? P(k, i)
          : P(atk, lastP);

      const rec = shift(copy(), atk, 26, 10);

      if (i != null) {
        rec[k][i] = [
          34 + ((i % 3) - 1) * 5,
          d > 0 ? 88 : 17
        ];
      }

      if (assister != null) {
        rec[atk][assister] = [
          50,
          d > 0 ? 80 : 25
        ];
      }

      K(1.0, e.m - 0.35, fieldOf(atk), rec, {
        actor: sId,
        hold: sId,
        comment: {
          type: 'pass',
          text: `Pass: ${nm(atk, lastP)} finds ${i != null ? nm(k, i) : nm(atk, lastP)} in the box`
        }
      });

      const sh = shift(copy(), atk, 32, 12);

      if (i != null) {
        sh[k][i] = [
          34 + ((i % 3) - 1) * 5,
          d > 0 ? 94 : 11
        ];
      }

      if (assister != null) {
        sh[atk][assister] = [
          50,
          d > 0 ? 84 : 21
        ];
      }

      K(0.9, e.m - 0.1, fieldOf(atk), sh, {
        actor: sId,
        hold: sId,
        comment: {
          type: 'shot',
          text: 'The attack reaches the penalty area'
        }
      });

      const pos = shift(copy(), atk, 34, 14);

      if (!og && i != null) {
        pos[k][i] = [
          34 + ((i % 3) - 1) * 5,
          d > 0 ? 94 : 11
        ];
      }

      if (assister != null) {
        pos[atk][assister] = [
          50,
          d > 0 ? 84 : 21
        ];
      }

      score[atk === 'A' ? 0 : 1]++;

      ball = d > 0
        ? [37, 106.2]
        : [31, -1.2];

      K(0.8, e.m, fieldOf(atk), pos, {
        actor: sId,
        goalFor: atk,
        og,

        comment: {
          type: 'goal',
          text:
            `GOAL! ${pname(k, i)}${og ? ' (own goal)' : ''} scores for ${name[atk]}` +
            (ai != null ? `. Assist: ${pname(atk, ai)}` : '')
        }
      });

      ball = [34, 52.5];

    // ---------- MISSED PENALTY ----------

    } else if (e.type === 'Goal') {
      go(fieldOf(k), e.m);

      const d = dir(k);
      const pos = shift(copy(), k, 20, 8);

      if (i != null) {
        pos[k][i] = [
          34,
          d > 0 ? 88 : 17
        ];
      }

      ball = [
        34,
        d > 0 ? 94 : 11
      ];

      K(2, e.m, fieldOf(k), pos, {
        actor: i != null ? P(k, i) : null,
        comment: {
          type: 'shot',
          text: `Penalty missed by ${pname(k, i)}`
        }
      });

      ball = [34, 52.5];

    // ---------- CARDS ----------

    } else if (e.type === 'Card') {
      if (!curField) go('away', e.m);

      const red = /red/i.test(e.detail || '');
      const up = (curField === 'away') !== swapped;

      const pos = shift(
        copy(),
        atkOf(curField),
        14,
        8
      );

      if (i != null) {
        pos[k][i] = [
          34 + ((i % 5) - 2) * 7,
          up ? 58 : 47
        ];
      }

      const id = 'c' + evList.length;

      evList.push({
        id,
        kind: 'card',
        m: e.m,
        h: hh,
        k,
        i,
        red,
        text: `${pname(k, i)} (${name[k]}) is shown a ${red ? 'red' : 'yellow'} card`
      });

      K(1.5, e.m, curField, pos, {
        ev: 'card',
        evId: id,
        actor: i != null ? P(k, i) : null,

        comment: {
          type: red ? 'red' : 'yellow',
          text: evList.at(-1).text
        }
      });

    // ---------- SUBSTITUTIONS ----------

    } else if (e.type === 'subst') {
      const swaps = [e];

      while (
        evs[g + 1] &&
        evs[g + 1].type === 'subst' &&
        evs[g + 1].m === e.m &&
        !htEvs.includes(evs[g + 1])
      ) {
        swaps.push(evs[++g]);
      }

      const pos = copy();
      const made = [];
      const text = [];

      swaps.forEach((s) => {
        const [sk, oi] = who(s);
        const ni = idx[sk][s.assist?.id];

        if (oi == null || ni == null) return;

        const bench = [60.5, 52.5];

        const outgoing = [
          bench[0],
          bench[1] + (made.length * 2)
        ];

        pos[sk][oi] = [...outgoing];

        pos[sk][ni] = [
          58.5,
          58.5 + (made.length * 2)
        ];

        base[sk][ni] = [...base[sk][oi]];
        base[sk][oi] = toBase(outgoing);

        made.push({
          k: sk,
          o: oi,
          i: ni
        });

        text.push(
          `${pname(sk, ni)} for ${pname(sk, oi)}`
        );
      });

      if (!made.length) continue;

      made.forEach((s) => {
        active[s.k] = active[s.k].map(
          (x) => (x === s.o ? s.i : x)
        );

        if (gk[s.k] === s.o) {
          gk[s.k] = s.i;
        }
      });

      const id = 's' + evList.length;

      const txt = text.join(', ').slice(0, 110);

      evList.push({
        id,
        kind: 'sub',
        m: e.m,
        h: hh,
        swaps: made,
        text: txt
      });

      const kf = K(1.8, e.m, 'full', pos, {
        ev: 'sub',
        evId: id,
        subDuration: 1.8,
        isolation: 'substitution',

        subAfter: made.length
          ? {
              incoming: P(made[0].k, made[0].i),
              outgoing: P(made[0].k, made[0].o)
            }
          : null,

        movements: {},

        subs: made.map((s) => ({
          o: P(s.k, s.o),
          i: P(s.k, s.i)
        })),

        actor: P(made[0].k, made[0].i),

        comment: {
          type: 'sub',
          text: txt
        }
      });

      kf.movements = {};

      made.forEach((s) => {
        const outgoing = P(s.k, s.o);
        const incoming = P(s.k, s.i);

        const start = [
          ...(copy()[s.k][s.o] || [34, 52.5])
        ];

        kf.movements[outgoing] = {
          start,
          end: [60.5, 52.5],
          duration: 1.8,
          type: 'benchExit',
          benchPoint: [60.5, 52.5]
        };

        kf.movements[incoming] = {
          start: [60.5, 52.5],
          end: [
            ...(pos[s.k][s.i] || [58.5, 58.5])
          ],
          duration: 1.8,
          type: 'benchEntry',
          benchPoint: [60.5, 52.5]
        };

        teams[s.k].players[s.o].leave = kf.id;
        teams[s.k].players[s.i].join = kf.id;
      });
    }
  }

  // ---------- End of match ----------

  if (!htDone) {
    idleTo(45);
    halfTime();
  }

  idleTo(lastM - 1);

  per = 'FT';

  K(2.5, lastM, 'full', copy(), {
    ph: 'FT',
    comment: {
      type: 'info',
      text: `Full time: ${name.A} ${score[0]} - ${score[1]} ${name.B}`
    }
  });

  return {
    meta: {
      showNames: true,
      fit: 'stretch',
      bigLabel: 'Corners'
    },

    evOn: {
      sub: true,
      card: true
    },

    events: evList,

    match: {
      id: fx.fixture.id,
      league: fx.league.name,
      date: fx.fixture.date,
      venue: fx.fixture.venue?.name || '',
      statsSrc,
      statsKeys: Object.keys(stats[0] || {})
    },

    teams,
    kfs
  };
}
