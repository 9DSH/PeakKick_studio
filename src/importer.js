// Real match import (PitchAPI). Calls go through the Vite dev-server proxy (see vite.config.js).
import { cl } from './engine.js';
import { benchFor, subField } from './simulation.js';

// Passing simulation tuning
export const MAX_SECONDS = 60;
export const MAX_PLAYER_SPEED = 8;
export const PRESS_DISTANCE = 0.65;
const REPLAY_LIMIT = MAX_SECONDS - 1.2;
const PASS_DEFAULTS = { goalPasses: 5, idlePasses: 4, idleGap: 3, dt: 0.9 };

function replayBudget(evs, htEvs, lastM) {
  const matchEvents = evs.filter((e) => !htEvs.includes(e));
  const goals = matchEvents.filter((e) => e.type === 'Goal' && e.detail !== 'Missed Penalty').length;
  const missed = matchEvents.filter((e) => e.type === 'Goal' && e.detail === 'Missed Penalty').length;
  const reds = matchEvents.filter((e) => e.type === 'Card' && /red/i.test(e.detail || '')).length;
  const yellows = matchEvents.filter((e) => e.type === 'Card' && !/red/i.test(e.detail || '')).length;
  const subs = matchEvents.filter((e) => e.type === 'subst');
  const fixed = 3.6 + 2.5;
  let plan = { ...PASS_DEFAULTS };

  const idleCost = (enabled, dt) => {
    if (!enabled) return 0;
    let prev = 0, count = 0, cost = 0;
    matchEvents.forEach((e) => {
      if (e.m - prev >= plan.idleGap) {
        count = Math.min(plan.idlePasses, Math.max(3, Math.round((e.m - prev) / 4) + 2));
        cost += 1.4 + count * dt;
      }
      if (e.m > 45 && prev < 45) {
        if (45 - prev >= plan.idleGap) cost += 1.4 + Math.min(plan.idlePasses, Math.max(3, Math.round((45 - prev) / 4) + 2)) * dt;
        prev = 45;
      }
      prev = Math.max(prev, e.m);
    });
    const tail = Math.max(0, lastM - 1 - prev);
    if (tail >= plan.idleGap) cost += 1.4 + Math.min(plan.idlePasses, Math.max(3, Math.round(tail / 4) + 2)) * dt;
    return cost;
  };

  const groupedSubs = (gap) => {
    let groups = 0, prev = null;
    matchEvents.forEach((e) => {
      if (e.type !== 'subst') {
        prev = null;
        return;
      }
      if (prev == null || e.m - prev > gap) groups++;
      prev = e.m;
    });
    return groups;
  };

  const eventCost = (p, dt, gap) =>
    goals * (1.4 + 1.7 + (p + 1) * dt) +
    missed * 3.4 +
    reds * 2.9 +
    yellows * 2.2 +
    groupedSubs(gap) * 3.2;

  const total = (p, dt, gap, idle) =>
    fixed + eventCost(p, dt, gap) + idleCost(idle, dt);

  if (total(plan.goalPasses, plan.dt, 0, true) > REPLAY_LIMIT) {
    plan.idlePasses = 0;
    plan.idleGap = Infinity;
  }
  while (total(plan.goalPasses, plan.dt, 0, false) > REPLAY_LIMIT && plan.goalPasses > 4) {
    plan.goalPasses--;
  }
  while (total(plan.goalPasses, plan.dt, 0, false) > REPLAY_LIMIT && plan.dt > 0.6) {
    plan.dt = Math.max(0.6, +(plan.dt - 0.1).toFixed(1));
  }
  if (total(plan.goalPasses, plan.dt, 0, false) > REPLAY_LIMIT) {
    for (const gap of [1, 2, 3, 5, 10, Infinity]) {
      if (total(plan.goalPasses, plan.dt, gap, false) <= REPLAY_LIMIT) {
        plan.mergeSubGap = gap;
        break;
      }
    }
  } else {
    plan.mergeSubGap = 0;
  }
  return plan;
}

const rnd = (i) => {
  const s = Math.sin(i * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

export async function api(path) {
  const r = await fetch('/pitchapi/v1' + path);
  const j = await r.json().catch(() => ({}));

  if (!r.ok || j.error) {
    throw new Error(
      j.error
        ? `${j.error.code}: ${j.error.message}`
        : `API error ${r.status}. Is PITCHAPI_KEY set in .env and the dev server restarted?`
    );
  }

  return j.data;
}

export async function listFixtures(date) {
  const d = await api('/date/' + date);

  const rows = (d.matches || []).map((m) => ({
    id: m.id,
    date: m.date || (m.time_utc || date).slice(0, 10),
    time: m.time_utc || '',
    league: m.league?.name || '',
    home: m.home_team.name,
    away: m.away_team.name,
    gh: m.score_home,
    ga: m.score_away
  }));

  return { rows };
}

// All played matches of the last `days` days, newest first. The API has no team search,
// so the days are loaded a few at a time and the app filters the list by team name.
export async function listRecent(days, onProgress) {
  const day = (i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
  const dates = Array.from({ length: days }, (_, i) => day(i));
  const all = [];
  let next = 0, done = 0, failed = 0;

  const one = async (d) => {
    for (let a = 0; a < 3; a++) {
      try {
        return (await listFixtures(d)).rows;
      } catch (e) {
        if (!/RATE_LIMIT/.test(e.message)) break;          // too many requests: wait and try again
        await new Promise((r) => setTimeout(r, 1500 * (a + 1)));
      }
    }
    failed++;
    return [];
  };

  const worker = async () => {
    while (next < dates.length) {
      const d = dates[next++];
      all.push(...(await one(d)));
      onProgress?.(++done, dates.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(5, days) }, worker));
  all.sort((a, b) => (b.time || b.date).localeCompare(a.time || a.date));
  return { rows: all, failed };
}

// ---------- PitchAPI -> the shape buildMatch reads ----------

const num = (s) =>
  parseFloat(String(s ?? '').replace(',', '.')) || 0;

function toLineup(team, ln) {
  const st = [...(ln.starters || [])].sort(
    (a, b) => (a.pitch_y ?? 0) - (b.pitch_y ?? 0)
  );

  const counts = (ln.formation || '')
    .split('-')
    .map(Number)
    .filter(Boolean);

  const sizes =
    counts.reduce((a, b) => a + b, 0) === st.length - 1
      ? [1, ...counts]
      : null;

  const rowOf = [];

  if (sizes) {
    let i = 0;

    sizes.forEach((n, r) => {
      for (let j = 0; j < n; j++) {
        rowOf[i++] = r + 1;
      }
    });
  } else {
    let r = 1;

    st.forEach((p, i) => {
      if (
        i &&
        p.pitch_y - st[i - 1].pitch_y > 0.07
      ) {
        r++;
      }

      rowOf[i] = r;
    });
  }

  const cols = {};
  const grid = [];

  st.map((_, i) => i)
    .sort(
      (a, b) =>
        rowOf[a] - rowOf[b] ||
        (st[a].pitch_x ?? 0) - (st[b].pitch_x ?? 0)
    )
    .forEach((i) => {
      cols[rowOf[i]] = (cols[rowOf[i]] || 0) + 1;
      grid[i] = `${rowOf[i]}:${cols[rowOf[i]]}`;
    });

  const mkP = (p, g) => ({
    player: {
      id: p.player_id,
      number: p.shirt_number,
      name: p.name,
      position: p.position,
      grid: g
    }
  });

  return {
    team: { id: team.id },
    formation: ln.formation,
    startXI: st.map((p, i) => mkP(p, grid[i])),
    substitutes: (ln.subs || []).map((p) => mkP(p))
  };
}

function toStats(statsData, home, away) {
  const periods = statsData?.periods || [];

  const find = (re) =>
    periods.find((p) => re.test(p.period || ''));

  const all = find(/^all$/i) || periods[0];
  const p1 = find(/first/i);
  const p2 = find(/second/i);

  const pick = (period, side) => {
    const items = (period?.groups || []).flatMap(
      (g) => g.items || []
    );

    const v = (keys, titles) =>
      num(
        items.find(
          (i) =>
            keys.test(i.key || '') ||
            titles.test(i.title || '')
        )?.[side]
      );

    return [
      {
        type: 'Ball Possession',
        value: v(/possess?ion/i, /^ball possession$/i)
      },
      {
        type: 'Total Shots',
        value: v(/^total_?shots$/i, /^total shots$/i)
      },
      {
        type: 'Shots on Goal',
        value: v(/^shots_?on_?target$/i, /^shots on target$/i)
      },
      {
        type: 'Corner Kicks',
        value: v(/^corners?$/i, /^corners?$/i)
      }
    ];
  };

  return [
    [home, 'home'],
    [away, 'away']
  ].map(([team, side]) => ({
    team: { id: team.id },
    statistics: pick(all, side),
    ...(p1 ? { firstHalf: pick(p1, side) } : {}),
    ...(p2 ? { secondHalf: pick(p2, side) } : {})
  }));
}

function toEvents(evData, lineups, home, away, live) {
  const side = {};

  lineups.forEach((l, k) =>
    [...l.startXI, ...l.substitutes].forEach(({ player }) => {
      side[player.id] = k ? away.id : home.id;
    })
  );

  const assistOf = (e) =>
    live?.events?.find(
      (x) =>
        String(x.type).toLowerCase() === 'goal' &&
        x.minute === e.minute &&
        x.player?.player_id === e.player?.id
    )?.assist?.player_id;

  const out = [];

  (evData.events || []).forEach((e) => {
    const t = String(e.event_type || '').toLowerCase();

    const team = {
      id: side[e.player?.id] ?? e.team_id
    };

    const base = {
      time: {
        elapsed: e.minute,
        extra: e.minute_added || 0
      },
      team,
      player: { id: e.player?.id }
    };

    if (t === 'goal') {
      out.push({
        ...base,
        type: 'Goal',
        detail: e.is_own_goal
          ? 'Own Goal'
          : e.is_penalty
            ? 'Penalty'
            : 'Normal Goal',
        assist: { id: assistOf(e) }
      });
    } else if (t === 'substitution') {
      out.push({
        ...base,
        type: 'subst',
        assist: { id: e.sub_in_player?.id }
      });
    } else if (t === 'yellowcard') {
      out.push({
        ...base,
        type: 'Card',
        detail: 'Yellow Card'
      });
    } else if (t === 'redcard') {
      out.push({
        ...base,
        type: 'Card',
        detail: 'Red Card'
      });
    }
  });

  return out;
}

export async function loadMatch(id) {
  const [m, ln, ev, st, live] = await Promise.all([
    api(`/matches/${id}`),
    api(`/matches/${id}/lineups`),
    api(`/matches/${id}/events`),
    api(`/matches/${id}/stats`).catch(() => null),
    api(`/matches/${id}/live`).catch(() => null)
  ]);

  if (
    !ln.home?.starters?.length ||
    !ln.away?.starters?.length
  ) {
    throw new Error('No lineups for this match.');
  }

  if (
    ln.home.confirmed === false ||
    ln.away.confirmed === false
  ) {
    throw new Error(
      'Only a predicted lineup exists: the match has not been played yet.'
    );
  }

  console.info(
    'PitchAPI stat keys:',
    (st?.periods?.[0]?.groups || []).flatMap(
      (g) =>
        (g.items || []).map(
          (i) => `${i.key} = ${i.title}`
        )
    )
  );

  const fx = {
    fixture: {
      id: m.id,
      date: m.time_utc || m.date,
      venue: { name: m.stadium || '' }
    },
    league: {
      name: m.league?.name || ''
    },
    teams: {
      home: {
        id: m.home_team.id,
        name: m.home_team.name
      },
      away: {
        id: m.away_team.id,
        name: m.away_team.name
      }
    }
  };

  const lineups = [
    toLineup(fx.teams.home, ln.home),
    toLineup(fx.teams.away, ln.away)
  ];

  const stats = st
    ? toStats(st, fx.teams.home, fx.teams.away)
    : [];

  return {
    D: buildMatch(
      fx,
      lineups,
      toEvents(
        ev,
        lineups,
        fx.teams.home,
        fx.teams.away,
        live
      ),
      stats
    )
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

const roleFromLineup = (player, ln, index) => {
  const position = String(player.position || '').toLowerCase();
  if (/goal|keeper|^gk$/.test(position)) return 'GK';
  if (/defen|back|^cb$|^fb$/.test(position)) return 'DEF';
  if (/forward|strik|wing|^att/.test(position)) return 'FWD';
  if (/mid/.test(position)) return 'MID';

  const row = +(player.grid || '').split(':')[0];
  if (row === 1 || index === 0) return 'GK';
  const lastRow = Math.max(1, ...ln.startXI.map(({ player: p }) => +((p.grid || '').split(':')[0]) || 1));
  if (row > 1) return row === 2 ? 'DEF' : row === lastRow ? 'FWD' : 'MID';

  const counts = (ln.formation || '').split('-').map(Number).filter(Boolean);
  if (index <= (counts[0] || 4)) return 'DEF';
  if (index <= (counts[0] || 4) + (counts[1] || 3)) return 'MID';
  return index < ln.startXI.length ? 'FWD' : 'MID';
};

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
          role: roleFromLineup(player, ln, i),
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
  const passPlan = replayBudget(evs, htEvs, lastM);

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

  const playerRole = (k, i) => teams[k].players[i]?.role || (i === gk[k] ? 'GK' : 'MID');
  const depthOf = (k, q) => dir(k) > 0 ? q[1] : 105 - q[1];
  const yAtDepth = (k, depth) => dir(k) > 0 ? depth : 105 - depth;
  const shapeBase = (k, i) => swapped ? flip(base[k][i]) : base[k][i];

  const shift = (pos, atk, dA, dD, ballPos = ball) => {
    const def = atk === 'A' ? 'B' : 'A';
    const attackDepth = dir(atk) > 0 ? ballPos[1] : 105 - ballPos[1];
    const defendDepth = 105 - attackDepth;
    const attackShift = cl((attackDepth - 52.5) * 0.25, -8, 10) * cl(dA / 14, 0.35, 1);
    const defendShift = cl((defendDepth - 52.5) * 0.15, -7, 4) * cl(dD / 8, 0.35, 1);
    const fullback = active[atk]
      .filter((i) => playerRole(atk, i) === 'DEF' && i !== gk[atk])
      .sort((a, b) => Math.abs(shapeBase(atk, b)[0] - 34) - Math.abs(shapeBase(atk, a)[0] - 34))[0];
    const mids = { A: [], B: [] };
    ['A', 'B'].forEach((k) => {
      mids[k] = active[k].filter((i) => playerRole(k, i) === 'MID')
        .sort((a, b) => depthOf(k, shapeBase(k, a)) - depthOf(k, shapeBase(k, b)));
    });

    ['A', 'B'].forEach((k) => {
      pos[k].forEach((q, i) => {
        if (!active[k].includes(i)) return;
        const role = playerRole(k, i);
        const home = shapeBase(k, i);
        const ownDepth = depthOf(k, home);
        const towardBall = (ballPos[0] - 34) * (k === atk ? 0.22 : 0.34);
        let depth = ownDepth;

        if (k === atk) {
          if (role === 'GK') depth = cl(ownDepth, 5, 12);
          else if (role === 'DEF') {
            const joins = i === fullback && attackDepth > 64;
            depth = cl(48 + attackShift * 0.35 + (joins ? 8 : 0), 40, joins ? 60 : 52);
          } else if (role === 'MID') {
            depth = cl(ownDepth + attackShift + 7, 54, 78);
          } else {
            depth = cl(ownDepth + attackShift + 8, 59, 91);
          }
        } else {
          if (role === 'GK') depth = cl(ownDepth + cl((52.5 - defendDepth) * 0.025, 0, 2), 4, 12);
          else if (role === 'DEF') depth = cl(ownDepth + defendShift, 12, 50.5);
          else if (role === 'MID') {
            const rank = mids[k].indexOf(i);
            const deep = rank >= 0 && rank < Math.ceil(mids[k].length / 2);
            depth = deep
              ? cl(ownDepth + defendShift, 24, 51.5)
              : cl(Math.max(53, ownDepth + defendShift), 53, 68);
          } else depth = cl(Math.max(53.5, ownDepth + defendShift), 53.5, 88);
        }

        const stretch = k === atk ? 1 + cl(dA / 28, 0, 1) * 0.06 : 0.94;
        q[0] = cl(34 + (home[0] - 34) * stretch + towardBall, 4, 64);
        q[1] = yAtDepth(k, depth);
      });
    });
    return pos;
  };

  const pressureMoves = (pos, atk, carrierId, receiverId) => {
    if (!carrierId) return {};
    const def = atk === 'A' ? 'B' : 'A';
    const carrier = pos[atk][+carrierId.slice(1)];
    if (!carrier) return {};
    const previous = kfs.at(-1);
    const defenders = active[def].filter((i) => i !== gk[def])
      .sort((a, b) => Math.hypot(pos[def][a][0] - carrier[0], pos[def][a][1] - carrier[1]) -
        Math.hypot(pos[def][b][0] - carrier[0], pos[def][b][1] - carrier[1]));
    const moves = {};
    const roleDepth = (i, depth) => {
      const role = playerRole(def, i);
      if (role === 'FWD') return cl(depth, 53.5, 90);
      if (role === 'MID') return cl(depth, 20, 80);
      return cl(depth, 4, 51);
    };
    const moveToward = (i, target, type) => {
      const current = pos[def][i];
      const start = [...(previous?.[def]?.[i] || current)];
      const end = [
        start[0] + (target[0] - start[0]) * PRESS_DISTANCE,
        start[1] + (target[1] - start[1]) * PRESS_DISTANCE
      ];
      end[1] = yAtDepth(def, roleDepth(i, depthOf(def, end)));
      if (Math.hypot(end[0] - target[0], end[1] - target[1]) >
        Math.hypot(start[0] - target[0], start[1] - target[1])) {
        end[0] = start[0];
        end[1] = start[1];
      }
      pos[def][i] = end;
      moves[P(def, i)] = {
        start,
        end: [...end],
        duration: passPlan.dt,
        type
      };
    };

    if (defenders[0] != null) moveToward(defenders[0], carrier, 'press');
    if (defenders[1] != null) {
      const receiver = receiverId && pos[atk][+receiverId.slice(1)] || carrier;
      moveToward(defenders[1], [(carrier[0] + receiver[0]) / 2, (carrier[1] + receiver[1]) / 2], 'cover');
    }
    defenders.slice(2).forEach((i) => {
      const q = pos[def][i], start = previous?.[def]?.[i] || q;
      q[0] += (carrier[0] - q[0]) * 0.22;
      q[1] += (carrier[1] - q[1]) * 0.12;
      q[1] = yAtDepth(def, roleDepth(i, depthOf(def, q)));
      moves[P(def, i)] = {
        start: [...start],
        end: [...q],
        duration: passPlan.dt,
        type: 'compact'
      };
    });
    const keeper = pos[def][gk[def]];
    if (keeper) keeper[0] = cl(keeper[0] + (carrier[0] - keeper[0]) * 0.18, 27, 41);
    return moves;
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
    const d = dir(atk);
    const bridgeBall = [35.5, d > 0 ? 56.5 : 48.5];
    const pos = shift(copy(), atk, 12, 4, bridgeBall);

    pos[atk][c] = [34, d > 0 ? 55 : 50];
    ball = bridgeBall;

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

    const pool = active[atk].filter((x) => x !== gk[atk] && x !== avoid &&
      playerRole(atk, x) !== 'DEF').sort((a, b) => fwd(atk, a) - fwd(atk, b) || base[atk][a][0] - base[atk][b][0]), cand = pool.slice(-7), out = [];

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

      if (j > 0 && kfs.at(-1)?.[atk]?.[h]) pos[atk][h] = [...kfs.at(-1)[atk][h]];
      pos[atk][h] = vis(atk, pos[atk][h], h);
      const progress = ids.length > 1 ? j / (ids.length - 1) : 1;
      const next = ids[j + 1];
      if (next != null) {
        const q = pos[atk][next];
        const depth = cl(depthOf(atk, q) + 4, 54, 86);
        q[1] = yAtDepth(atk, depth);
        q[0] = cl(q[0] + (pos[atk][h][0] - q[0]) * 0.12, 4, 64);
      }
      active[atk].filter((i) => i !== gk[atk] && i !== h && i !== next &&
        (playerRole(atk, i) === 'MID' || playerRole(atk, i) === 'FWD'))
        .slice(0, 2).forEach((i) => {
          const q = pos[atk][i];
          q[1] = yAtDepth(atk, cl(depthOf(atk, q) + 3 + progress * 3, 54, 89));
        });
      const movements = pressureMoves(pos, atk, id, next == null ? null : P(atk, next));

      ball = [
        pos[atk][h][0] + 1,
        pos[atk][h][1] + d * 1.2
      ];

      K(
        passPlan.dt,
        Math.max(curMin, mA + (mB - mA) * u),
        fieldOf(atk),
        pos,
        {
          actor: id,
          hold: id,
          movements,
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

    if (gap >= passPlan.idleGap && passPlan.idlePasses > 0) {
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
          cl(Math.round(gap / 4) + 2, 3, passPlan.idlePasses),
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

  // ---------- goal build-up: several passes, runners join in the opponent half ----------

  const lerp = (a, b, u) => a + (b - a) * u;
  const gy = (atk, p) => (dir(atk) > 0 ? p : 105 - p);

  const attackFrame = (atk, o, j, u) => {
    const def = atk === 'A' ? 'B' : 'A';
    const uu = Math.min(1, u);
    const pos = shift(
      copy(),
      atk,
      lerp(10, 28, uu),
      lerp(4, 12, uu)
    );

    const put = (id, p, x) => {
      pos[atk][id] = [cl(x, 6, 62), gy(atk, cl(p, 3, 98))];
    };

    // Every chain player is on the move:
    // runs to receiving spot, receives ball, then keeps supporting.
    o.chain.forEach((c, q) =>
      put(
        c,
        Math.max(
          54,
          j < q
            ? o.ph[q] - 9 * (q - j)
            : o.ph[q] + 3 * (j - q)
        ),
        o.xs[q]
      )
    );

    // Two extra attackers join in the opponent half (one each side).
    o.joiners.forEach((x, q) =>
      put(x, lerp(54, 86, uu), q ? 52 : 16)
    );

    // The scorer makes his run into the box.
    if (o.S != null) {
      put(
        o.S,
        j < o.nh - 1
          ? lerp(56, 82, j / Math.max(1, o.nh - 1))
          : [86, 92, 94][Math.min(2, j - (o.nh - 1))],
        o.sx
      );
    } else if (j >= o.nh) {
      put(
        o.chain.at(-1),
        86 + 4 * (j - o.nh),
        o.xs.at(-1)
      );
    }

    // The defending team squeezes toward the ball; keeper follows it.
    const h = j < o.holders.length
      ? o.holders[j]
      : (o.S ?? o.chain.at(-1));

    const bx = pos[atk][h][0];

    pos[def].forEach((q, i) => {
      if (!active[def].includes(i)) return;

      q[0] = i === gk[def]
        ? 34 + cl((bx - 34) * 0.3, -6, 6)
        : cl(q[0] + (bx - q[0]) * 0.25, 3, 65);
    });

    return { pos };
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
      const ai = e.assist?.id != null
        ? idx[atk][e.assist.id]
        : undefined;

      go(fieldOf(atk), e.m);
      const d = dir(atk);

      const S = !og && i != null && active[atk].includes(i) && i !== gk[atk]
        ? i
        : null;

      const assister = ai != null &&
        active[atk].includes(ai) &&
        ai !== gk[atk] &&
        ai !== S
          ? ai
          : null;

      const chain = pickChain(
        atk,
        passPlan.goalPasses,
        Math.floor(e.m * 5),
        assister,
        S
      );

      const nC = chain.length;
      const cp = copy();
      const lane = [30, 20, 46, 54, 36, 26];
      const holders = S != null ? [...chain, S] : chain;

      const o2 = {
        chain,
        S,
        holders,
        nh: holders.length,
        sx: S != null ? 34 + ((S % 3) - 1) * 6 : 34,
        joiners: active[atk]
          .filter((x) => x !== gk[atk] && x !== S && !chain.includes(x) &&
            (playerRole(atk, x) === 'MID' || playerRole(atk, x) === 'FWD'))
          .sort((a, b) => fwd(atk, b) - fwd(atk, a))
          .slice(0, 2),
        ph: chain.map((_, q) =>
          lerp(58, 78, nC > 1 ? q / (nC - 1) : 1)
        ),
        xs: chain.map((c, q) =>
          cl(cp[atk][c][0] * 0.35 + lane[(q + c) % lane.length] * 0.65, 8, 60)
        )
      };

      const mA = Math.max(curMin, e.m - 2.4);
      const mB = e.m - 0.5;

      holders.forEach((h, j) => {
        // One keyframe per pass; ball changes owner every time.
        const fr = attackFrame(
          atk,
          o2,
          j,
          j / Math.max(1, o2.nh - 1)
        );

        ball = [...fr.pos[atk][h]];
        const movements = pressureMoves(
          fr.pos,
          atk,
          P(atk, h),
          j + 1 < holders.length ? P(atk, holders[j + 1]) : null
        );

        K(
          passPlan.dt,
          lerp(mA, mB, j / Math.max(1, o2.nh - 1)),
          fieldOf(atk),
          fr.pos,
          {
            actor: P(atk, h),
            hold: P(atk, h),
            movements,
            comment: {
              type: j ? 'pass' : 'info',
              text: j
                ? `Pass: ${nm(atk, holders[j - 1])} finds ${nm(atk, h)}${S != null && j === holders.length - 1 ? ' in the box' : ''}`
                : `${name[atk]} build from the back`
            }
          }
        );
      });

      const sId = og
        ? (i != null ? P(k, i) : P(atk, chain.at(-1)))
        : P(atk, S ?? chain.at(-1));

      const stage = (j) => {
        const fr = attackFrame(atk, o2, j, 1);

        if (og && i != null) {
          fr.pos[k][i] = [
            34 + ((i % 3) - 1) * 5,
            d > 0 ? 94 : 11
          ];
        }

        return fr.pos;
      };

      ball = [34, d > 0 ? 94 : 11];

      const shotPos = stage(o2.nh);
      const liveCarrier = sId[0] === atk ? sId : P(atk, chain.at(-1));
      const shotMoves = pressureMoves(shotPos, atk, liveCarrier, null);
      K(0.9, e.m - 0.1, fieldOf(atk), shotPos, {
        actor: sId,
        hold: sId,
        movements: shotMoves,
        comment: {
          type: 'shot',
          text: 'Shot on goal!'
        }
      });

      score[atk === 'A' ? 0 : 1]++;
      ball = d > 0 ? [37, 106.2] : [31, -1.2];

      const goalPos = stage(o2.nh + 1);
      const goalMoves = pressureMoves(goalPos, atk, liveCarrier, null);
      K(0.8, e.m, fieldOf(atk), goalPos, {
        actor: sId,
        goalFor: atk,
        og,
        pen: /pen/i.test(e.detail || ''),
        movements: goalMoves,
        comment: {
          type: 'goal',
          text: `GOAL! ${pname(k, i)}${og ? ' (own goal)' : ''} scores for ${name[atk]}` +
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

      K(red ? 1.5 : 0.8, e.m, curField, pos, {
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
        (evs[g + 1].m === e.m ||
          (passPlan.mergeSubGap > 0 && evs[g + 1].m - e.m <= passPlan.mergeSubGap)) &&
        !htEvs.includes(evs[g + 1])
      ) {
        swaps.push(evs[++g]);
      }

      const pos = copy();
      const made = [];
      const text = [];
      const mv = [];

      swaps.forEach((s) => {
        const [sk, oi] = who(s);
        const ni = idx[sk][s.assist?.id];

        if (oi == null || ni == null) return;

        const spot = [...pos[sk][oi]];
        const bench = benchFor(
          sk,
          swapped,
          made.filter((m) => m.k === sk).length
        );

        pos[sk][oi] = [...bench];
        pos[sk][ni] = [...spot];

        base[sk][ni] = toBase(spot);
        base[sk][oi] = toBase(bench);

        made.push({ k: sk, o: oi, i: ni, m: s.m });
        mv.push({ spot, bench });

        text.push(`${pname(sk, ni)} for ${pname(sk, oi)}`);
      });

      if (!made.length) continue;

      made.forEach((s) => {
        active[s.k] = active[s.k].map((x) => (x === s.o ? s.i : x));

        if (gk[s.k] === s.o) gk[s.k] = s.i;
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

      const oneTeam = new Set(made.map((s) => s.k)).size === 1;

      const kf = K(
        1.8,
        e.m,
        oneTeam ? subField(made[0].k) : 'full',
        pos,
        {
          ev: 'sub',
          evId: id,
          subDuration: 1.8,
          isolation: 'substitution',
          subAfter: {
            incoming: P(made[0].k, made[0].i),
            outgoing: P(made[0].k, made[0].o)
          },
          movements: {},
          subs: made.map((s) => ({
            o: P(s.k, s.o),
            i: P(s.k, s.i),
            m: s.m
          })),
          actor: P(made[0].k, made[0].i),
          comment: {
            type: 'sub',
            text: txt
          }
        }
      );

      made.forEach((s, n) => {
        const { spot, bench } = mv[n];

        kf.movements[P(s.k, s.o)] = {
          start: [...spot],
          end: [...bench],
          duration: 1.8,
          type: 'benchExit',
          benchPoint: [...bench]
        };

        kf.movements[P(s.k, s.i)] = {
          start: [...bench],
          end: [...spot],
          duration: 1.8,
          type: 'benchEntry',
          benchPoint: [...bench]
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

  if (kfs.at(-1).t > REPLAY_LIMIT) {
    const gaps = kfs.slice(1).map((kf, i) => kf.t - kfs[i].t);
    const minimum = gaps.length * 0.1;
    if (minimum > REPLAY_LIMIT) {
      throw new Error(`Replay has ${kfs.length} keyframes; the 60 s limit cannot preserve 0.1 s gaps.`);
    }
    const flexible = Math.max(0.1, gaps.reduce((sum, gap) => sum + gap - 0.1, 0));
    const factor = Math.max(0, (REPLAY_LIMIT - minimum) / flexible);
    let t = 0;
    kfs[0].t = 0;
    gaps.forEach((gap, i) => {
      t += Math.max(0.1, +(0.1 + Math.max(0, gap - 0.1) * factor).toFixed(1));
      kfs[i + 1].t = +t.toFixed(1);
    });
    while (kfs.at(-1).t > REPLAY_LIMIT) {
      const i = gaps.findIndex((_, n) => kfs[n + 1].t - kfs[n].t > 0.1);
      if (i < 0) break;
      for (let j = i + 1; j < kfs.length; j++) kfs[j].t = +(kfs[j].t - 0.1).toFixed(1);
    }
  }

  const keyframeIndex = new Map(kfs.map((kf, i) => [kf.id, i]));
  const activeAt = (team, index, frameIndex) => {
    const player = teams[team].players[index];
    if (!player || player.join === 'never') return false;
    const joined = keyframeIndex.get(player.join);
    const left = keyframeIndex.get(player.leave);
    return (joined == null || frameIndex > joined) && (left == null || frameIndex < left);
  };

  for (let n = 1; n < kfs.length; n++) {
    const prev = kfs[n - 1], kf = kfs[n], duration = kf.t - prev.t;
    if (duration <= 0 || kf.instant || kf.manual?.modified || kf.isolation === 'substitution' ||
      kf.ph === 'HT' || kf.ph === 'H2') continue;
    ['A', 'B'].forEach((team) => {
      teams[team].players.forEach((player, i) => {
        if (!activeAt(team, i, n)) return;
        if (player.role === 'GK' && ['shot', 'goal', 'save'].includes(kf.comment?.type)) return;
        const start = prev[team][i], end = kf[team][i];
        if (!start || !end) return;
        const dx = end[0] - start[0], dy = end[1] - start[1], distance = Math.hypot(dx, dy);
        const maxDistance = Math.max(0, MAX_PLAYER_SPEED * duration - 0.01);
        if (distance <= maxDistance) return;
        const ratio = maxDistance / distance;
        end[0] = start[0] + dx * ratio;
        end[1] = start[1] + dy * ratio;
        const movement = kf.movements?.[`${team}${i}`];
        if (movement) movement.end = [...end];
      });
    });

    if (kf.comment?.type === 'pass' && kf.hold) {
      const atk = kf.hold[0], def = atk === 'A' ? 'B' : 'A';
      const direction = (team) => (team === 'A') !== !!kf.sw ? 1 : -1;
      const depthAt = (team, q) => direction(team) > 0 ? q[1] : 105 - q[1];
      const yAt = (team, depth) => direction(team) > 0 ? depth : 105 - depth;
      const carrier = kf[atk][+kf.hold.slice(1)];
      const candidates = teams[def].players.map((_, i) => i).filter((i) => i !== gk[def] && activeAt(def, i, n))
        .sort((a, b) => Math.hypot(prev[def][a][0] - carrier[0], prev[def][a][1] - carrier[1]) -
          Math.hypot(prev[def][b][0] - carrier[0], prev[def][b][1] - carrier[1]));
      Object.entries(kf.movements || {}).forEach(([id, movement]) => {
        if (movement.type === 'press' || movement.type === 'cover') delete kf.movements[id];
      });
      const retarget = (i, target, type) => {
        if (i == null) return;
        const start = [...prev[def][i]], dx = target[0] - start[0], dy = target[1] - start[1];
        const distance = Math.hypot(dx, dy), max = Math.max(0, MAX_PLAYER_SPEED * duration - 0.01);
        const ratio = Math.min(PRESS_DISTANCE, max / Math.max(0.001, distance));
        const end = [start[0] + dx * ratio, start[1] + dy * ratio];
        const role = playerRole(def, i), depth = depthAt(def, end);
        const bounded = role === 'FWD' ? cl(depth, 53.5, 90) : role === 'DEF' ? cl(depth, 4, 51) : cl(depth, 20, 80);
        end[1] = yAt(def, bounded);
        if (Math.hypot(end[0] - target[0], end[1] - target[1]) >
          Math.hypot(start[0] - target[0], start[1] - target[1])) {
          end[0] = start[0];
          end[1] = start[1];
        }
        kf[def][i] = end;
        kf.movements = kf.movements || {};
        kf.movements[`${def}${i}`] = { start, end: [...end], duration, type };
      };
      const oldCarrier = prev.hold && prev[prev.hold[0]]?.[+prev.hold.slice(1)];
      const lane = oldCarrier ? [(oldCarrier[0] + carrier[0]) / 2, (oldCarrier[1] + carrier[1]) / 2] : carrier;
      retarget(candidates[0], carrier, 'press');
      retarget(candidates[1], lane, 'cover');
    }
  }

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