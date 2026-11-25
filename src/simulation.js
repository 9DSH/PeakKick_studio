export const PITCH = Object.freeze({ width: 68, length: 105, centerX: 34, centerY: 52.5 });

export const FORMATIONS = {
  '4-3-3': [[34,8],[10,24],[25,20],[43,20],[58,24],[34,38],[20,42],[48,42],[34,58],[14,76],[54,76]],
  '4-2-3-1': [[34,8],[10,24],[25,20],[43,20],[58,24],[25,39],[43,39],[34,50],[15,58],[53,58],[34,70]],
  '4-4-2': [[34,8],[10,24],[25,20],[43,20],[58,24],[11,43],[28,43],[40,43],[57,43],[24,68],[44,68]],
  '3-5-2': [[34,8],[17,22],[34,19],[51,22],[34,36],[10,44],[24,48],[44,48],[58,44],[24,68],[44,68]],
  '3-4-3': [[34,8],[17,22],[34,19],[51,22],[12,42],[28,46],[40,46],[56,42],[34,61],[16,76],[52,76]],
  '5-3-2': [[34,8],[8,24],[21,20],[34,18],[47,20],[60,24],[24,42],[34,44],[44,42],[24,68],[44,68]]
};

export const clampPitch = ([x,y]) => [Math.max(3,Math.min(65,x)),Math.max(3,Math.min(102,y))];
export const RIGHT_BENCH_POINT = Object.freeze([60.5,52.5]);
export const benchPoint = () => [...RIGHT_BENCH_POINT];
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
      const outgoing = sub.o;
      const team = outgoing[0], index = +outgoing.slice(1);
      const start = prev[team]?.[index] ? [...prev[team][index]] : [...(kf[team]?.[index] || RIGHT_BENCH_POINT)];
      kf.movements[outgoing] = { start, end: benchPoint(), duration:+(kf.t-prev.t).toFixed(1), type:'benchExit', benchPoint:benchPoint() };
      kf.manual = kf.manual || {};
      kf.manual.modified = true;
    });
  }
  if (!kf.ballMovement) kf.ballMovement={start:[...(prev.ball||[34,52.5])],end:[...(kf.ball||[34,52.5])],type:kf.hold?'dribble':(kf.comment?.type==='pass'?'pass':'free')};
  return kf;
}

export function eventStats(D) {
  const events=D.events||[];
  return ['sub','card','goal'].map(kind=>({kind,count:events.filter(e=>e.kind===kind).length||D.kfs.filter(k=>kind==='goal'?k.comment?.type==='goal':k.ev===kind).length}));
}
