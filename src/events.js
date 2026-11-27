// Switch substitutions / cards on or off: removes or re-inserts their keyframes and fixes the players and times around them.
import { benchFor } from './simulation.js';
import { MAX_SECONDS } from './importer.js';

const newId = (D) => Math.max(0, ...D.kfs.map((k) => k.id ?? 0)) + 1;
const num = (id) => +id.slice(1);
const lengthWarning = (D) => {
  const length = (D.kfs.at(-1)?.t || 0) + 1.2;
  return length > MAX_SECONDS
    ? ` Warning: replay length is ${length.toFixed(1)} s, above ${MAX_SECONDS} s. Use “Fit to ${MAX_SECONDS} s”.`
    : '';
};

export function setEvents(D, kind, on) {
  if (!D.events) return 'This project has no event list. Import the match again to use these switches.';
  D.evOn = D.evOn || { sub: true, card: true };
  const label = kind === 'sub' ? 'Substitutions' : 'Cards';
  if (!on) {
    for (let i = D.kfs.length - 1; i > 0; i--) {
      const kf = D.kfs[i]; if (kf.ev !== kind) continue;
      const dur = kf.t - D.kfs[i - 1].t;
      (kf.subs || []).forEach((s) => { // the substitute never came on: the player who was meant to go off stays where the substitute stood
        for (let j = i + 1; j < D.kfs.length; j++) { const f = D.kfs[j], T = s.o[0]; f[T][num(s.o)] = [...f[T][num(s.i)]]; f[T][num(s.i)] = [34, -6]; if (f.actor === s.i) f.actor = s.o; if (f.hold === s.i) f.hold = s.o; }
        const P = D.teams[s.o[0]].players; delete P[num(s.o)].leave; P[num(s.i)].join = 'never';
      });
      D.kfs.splice(i, 1); for (let j = i; j < D.kfs.length; j++) D.kfs[j].t = +(D.kfs[j].t - dur).toFixed(1);
    }
    D.evOn[kind] = false; return `${label} are off: their keyframes were removed.${lengthWarning(D)}`;
  }
  let added = 0;
  for (const e of D.events.filter((x) => x.kind === kind).sort((a, b) => a.m - b.m)) {
    const k = D.kfs; if (k.some((f) => f.evId === e.id)) continue;
    const iH2 = k.findIndex((f) => f.ph === 'H2'), iHT = k.findIndex((f) => f.ph === 'HT'), iFT = k.findIndex((f) => f.ph === 'FT'), end = iFT > 0 ? iFT : k.length;
    const lo = e.h === 1 ? 1 : (iH2 > 0 ? iH2 + 1 : 1), hi = e.h === 1 ? (iHT > 0 ? iHT : end) : end;
    let at = hi; for (let j = lo; j < hi; j++) if (k[j].minute > e.m) { at = j; break; }
    const prev = k[at - 1], kf = structuredClone(prev), dur = kind === 'sub' ? 1.8 : 1.5;
    ['subs', 'ph', 'goalFor', 'og', 'htSubs', 'instant'].forEach((x) => delete kf[x]);
    Object.assign(kf, { id: newId(D), t: +(prev.t + dur).toFixed(1), minute: e.m, hold: null, ev: kind, evId: e.id });
    if (kind === 'sub') {
      kf.field = new Set(e.swaps.map((s) => s.k)).size > 1 ? 'full' : (e.swaps[0].k === 'A' ? 'home' : 'away');
      e.swaps.forEach((s) => {
        const T=s.k,oi=s.o,ni=s.i,bench=benchFor(T,kf.sw,kf.subs.length),spot=[...(prev[T]?.[oi]||[34,52.5])];
        kf[T][oi]=[...bench];kf[T][ni]=[...spot];
        kf.movements[T+oi]={start:[...spot],end:[...bench],duration:1.8,type:'benchExit',benchPoint:[...bench]};
        kf.movements[T+ni]={start:[...bench],end:[...spot],duration:1.8,type:'benchEntry',benchPoint:[...bench]};
        const P=D.teams[T].players;P[oi].leave=kf.id;P[ni].join=kf.id;kf.subs.push({o:T+oi,i:T+ni,k:T});
      });
      kf.actor=kf.subs[0].i;kf.comment={type:'sub',text:e.text};
    } else {
      kf.field = prev.field === 'full' ? 'away' : prev.field; const up = (kf.field === 'away') !== !!kf.sw;
      kf[e.k][e.i] = [34 + ((e.i % 5) - 2) * 7, up ? 58 : 47]; kf.actor = e.k + e.i; kf.comment = { type: e.red ? 'red' : 'yellow', text: e.text };
    }
    k.splice(at, 0, kf); for (let j = at + 1; j < k.length; j++) k[j].t = +(k[j].t + dur).toFixed(1); added++;
  }
  D.evOn[kind] = true; return `${label} are on: ${added} keyframe${added === 1 ? '' : 's'} added.${lengthWarning(D)}`;
}
