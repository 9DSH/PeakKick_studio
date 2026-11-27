export const PITCH = Object.freeze({ width: 68, length: 105, centerX: 34, centerY: 52.5 });

export const FORMATIONS = {
  '4-3-3': [[34,8],[10,24],[25,20],[43,20],[58,24],[34,38],[20,42],[48,42],[34,58],[14,76],[54,76]],
  '4-2-3-1': [[34,8],[10,24],[25,20],[43,20],[58,24],[25,39],[43,39],[34,50],[15,58],[53,58],[34,70]],
  '4-4-2': [[34,8],[10,24],[25,20],[43,20],[58,24],[11,43],[28,43],[40,43],[57,43],[24,68],[44,68]],
  '3-5-2': [[34,8],[17,22],[34,19],[51,22],[34,36],[10,44],[24,48],[44,48],[58,44],[24,68],[44,68]],
  '3-4-3': [[34,8],[17,22],[34,19],[51,22],[12,42],[28,46],[40,46],[56,42],[34,61],[16,76],[52,76]],
  '5-3-2': [[34,8],[8,24],[21,20],[34,18],[47,20],[60,24],[24,42],[34,44],[44,42],[24,68],[44,68]]
};

const validRole = (role) => ['GK', 'DEF', 'MID', 'FWD'].includes(String(role || '').toUpperCase());
const positionRole = (player) => {
  const position = String(player.position || player.role || player.name || '').toLowerCase();
  if (/goal.?keeper|keeper|^gk$/.test(position)) return 'GK';
  if (/defen|back|^cb$|^fb$/.test(position)) return 'DEF';
  if (/forward|strik|wing|attack/.test(position)) return 'FWD';
  if (/mid/.test(position)) return 'MID';
  return null;
};
const formationRole = (index, formation) => {
  if (index === 0) return 'GK';
  const rows = String(formation || '').split('-').map(Number).filter(Boolean);
  if (!rows.length) return null;
  if (index <= rows[0]) return 'DEF';
  if (index <= rows[0] + (rows[1] || 0)) return rows.length === 2 ? 'FWD' : 'MID';
  return 'FWD';
};

function inferredRole(D, team, index, player) {
  const named = positionRole(player);
  if (named) return named;
  if (player.bench || player.join === 'never') return 'MID';
  const fromFormation = formationRole(index, D.teams[team].formation);
  if (fromFormation) return fromFormation;

  const active = D.teams[team].players.map((p, i) => ({ p, i, q: D.kfs?.[0]?.[team]?.[i] }))
    .filter(({ p, q }) => q && p.join !== 'never' && !p.bench && q[1] >= 0 && q[1] <= 105);
  if (active.length >= 10 && index === 0) return 'GK';
  const frame = D.kfs?.[0];
  if (!frame || !frame[team]?.[index]) return 'MID';
  const swapped = !!frame.sw;
  const depth = (q) => team === 'A' !== swapped ? q[1] : 105 - q[1];
  const sorted = active.filter(({ i }) => i !== 0 || active.length < 10)
    .sort((a, b) => depth(a.q) - depth(b.q));
  const rank = sorted.findIndex(({ i }) => i === index);
  const ratio = sorted.length ? rank / sorted.length : 0.5;
  return ratio < 0.4 ? 'DEF' : ratio > 0.7 ? 'FWD' : 'MID';
}

export function ensureRoles(D) {
  ['A', 'B'].forEach((team) => {
    (D.teams?.[team]?.players || []).forEach((player, index) => {
      if (!validRole(player.role)) player.role = inferredRole(D, team, index, player);
      else player.role = String(player.role).toUpperCase();
    });
  });
  return D;
}

export const clampPitch = ([x,y]) => [Math.max(3,Math.min(65,x)),Math.max(3,Math.min(102,y))];
export const RIGHT_BENCH_POINT = Object.freeze([60.5,52.5]);
export const benchPoint = () => [...RIGHT_BENCH_POINT];
// bench = on the halfway line, a few metres inside the team's OWN half (so it is visible in half view too)
export const benchFor = (team, sw, n = 0) => [RIGHT_BENCH_POINT[0], 52.5 + (((team === 'A') !== !!sw) ? -1 : 1) * (4 + 3 * n)];
export const subField = (team) => (team === 'A' ? 'home' : 'away'); // camera on the half where that team plays (also correct after the HT swap)
export const mirrorPitch = ([x,y]) => [PITCH.width-x,PITCH.length-y];

export function halfKey(t, minute) {
  return minute >= 45 || t >= 45 ? 'second' : 'first';
}

export function setTeamFormation(D, teamKey, half, formationName, mirror = false) {
  const pattern = FORMATIONS[formationName];
  if (!pattern) return false;
  const players = D.teams[teamKey].players;
  const isSecond = half === 'second';
  const attackingUp = teamKey === 'A' ? !isSecond : isSecond;
  players.forEach((p, i) => {
    const counts = formationName.split('-').map(Number);
    const role = i > counts.reduce((sum, value) => sum + value, 0)
      ? 'MID'
      : formationRole(i, formationName);
    if (role) p.role = role;
  });
  players.forEach((p, i) => {
    if (i >= pattern.length) return;
    let q = [...pattern[i]];
    if (teamKey === 'B') q = [q[0], PITCH.length-q[1]];
    if (mirror) q = mirrorPitch(q);
    if (attackingUp && isSecond) q = mirrorPitch(q);
    D.kfs.forEach((kf, ki) => {
      const kfSecond = kf.ph === 'H2' || kf.sw || (kf.minute || 0) >= 45;
      if ((half === 'second') !== kfSecond) return;
      if (kf[teamKey]?.[i]) kf[teamKey][i] = clampPitch(q);
      kf.generated = kf.generated || {};
      kf.generated.formation = kf.generated.formation || {};
      kf.generated.formation[teamKey] = formationName;
      kf.manual = kf.manual || {};
      kf.manual.modified = true;
    });
  });
  D.teams[teamKey].formation = formationName;
  return true;
}

export function movementStats(start, end, duration = 1) {
  const dx = end[0]-start[0], dy = end[1]-start[1];
  const distance = Math.hypot(dx,dy);
  const angle = (Math.atan2(dy,dx)*180/Math.PI+360)%360;
  return { distance:+distance.toFixed(1), direction:angle, duration:+duration, speed:distance/Math.max(.1,duration) };
}

export function ensureMovementMeta(kf, prev, D) {
  kf.manual = kf.manual || {};
  kf.generated = kf.generated || {};
  kf.movements = kf.movements || {};
  if (!prev) return kf;
  for (const team of ['A','B']) {
    (D.teams[team].players||[]).forEach((p,i) => {
      const id=`${team}${i}`;
      if (!kf.movements[id]) {
        kf.movements[id] = {
          start:[...(prev[team]?.[i] || kf[team]?.[i] || [34,52.5])],
          end:[...(kf[team]?.[i] || [34,52.5])],
          duration:+(kf.t-prev.t).toFixed(1),
          type:kf.comment?.type==='pass'?'support':kf.comment?.type==='goal'?'attack':'run'
        };
      }
    });
  }
  if (kf.subs?.length) {
    kf.subs.forEach((sub) => {
      if (kf.movements[sub.o]?.type === 'benchExit' && kf.movements[sub.i]?.type === 'benchEntry') return; // keep what exists
      const team = sub.o[0], oi = +sub.o.slice(1);
      const bench = benchFor(team, kf.sw), spot = [...(prev[team]?.[oi] || kf[team]?.[oi] || [34, 52.5])], d = +(kf.subDuration || 1.8);
      kf.movements[sub.o] = { start: spot, end: bench, duration: d, type: 'benchExit', benchPoint: bench };
      kf.movements[sub.i] = { start: [...bench], end: [...spot], duration: d, type: 'benchEntry', benchPoint: [...bench] };
    });
  }
  if (!kf.ballMovement) kf.ballMovement={start:[...(prev.ball||[34,52.5])],end:[...(kf.ball||[34,52.5])],type:kf.hold?'dribble':(kf.comment?.type==='pass'?'pass':'free')};
  return kf;
}

export function eventStats(D) {
  const events=D.events||[];
  return ['sub','card','goal'].map(kind=>({kind,count:events.filter(e=>e.kind===kind).length||D.kfs.filter(k=>kind==='goal'?k.comment?.type==='goal':k.ev===kind).length}));
}

// Repairs substitution keyframes saved by the old importer: ON = bench -> spot, OFF = spot -> bench, camera on the substituting team's half.
export function repairSubs(D) {
  ensureRoles(D);
  if (D.subFix === 2) return D;
  D.kfs.forEach((kf, i) => {
    if (!kf.subs?.length || kf.htSubs) return;
    const prv = D.kfs[i - 1], nxt = D.kfs[i + 1];
    kf.movements = kf.movements || {};
    kf.subs.forEach((s, n) => {
      const T = s.o[0], oi = +s.o.slice(1), ni = +s.i.slice(1);
      const bench = benchFor(T, kf.sw, kf.subs.slice(0, n).filter((x) => x.o[0] === T).length);
      const spot = [...(prv?.[T]?.[oi] || nxt?.[T]?.[ni] || [34, 52.5])]; // where the player going off really stood
      kf[T][oi] = [...bench]; kf[T][ni] = [...spot];
      const d = +(kf.subDuration || 1.8);
      kf.movements[s.o] = { start: [...spot], end: [...bench], duration: d, type: 'benchExit', benchPoint: [...bench] };
      kf.movements[s.i] = { start: [...bench], end: [...spot], duration: d, type: 'benchEntry', benchPoint: [...bench] };
    });
    kf.field = new Set(kf.subs.map((s) => s.o[0])).size > 1 ? 'full' : subField(kf.subs[0].o[0]);
  });
  D.subFix = 2;
  return D;
}
