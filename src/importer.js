// Real match import (API-Football). Calls go through the Vite dev-server proxy (see vite.config.js).
import { cl } from './engine.js';

export async function api(path) {
  const r = await fetch('/api-football' + path);
  const left = r.headers.get('x-ratelimit-requests-remaining');
  const j = await r.json().catch(() => ({}));
  const errs = j.errors ? (Array.isArray(j.errors) ? j.errors : Object.values(j.errors)) : [];
  if (!r.ok || errs.length) throw new Error(errs.join(' ') || `API error ${r.status}. Is API_FOOTBALL_KEY set in .env and the dev server restarted?`);
  return { data: j.response || [], left };
}

export async function listFixtures(date) {
  const { data, left } = await api('/fixtures?date=' + date);
  const rows = data.filter((f) => ['FT', 'AET', 'PEN'].includes(f.fixture.status.short)).map((f) => ({ id: f.fixture.id, league: `${f.league.name} (${f.league.country})`, home: f.teams.home.name, away: f.teams.away.name, gh: f.goals.home, ga: f.goals.away }));
  return { rows, left };
}

export async function loadMatch(id) {
  // one statistics call with half=true: full match plus, when the API has them, first-half and second-half numbers
  const [fx, ln, ev, st] = await Promise.all(['fixtures?id=', 'fixtures/lineups?fixture=', 'fixtures/events?fixture=', 'fixtures/statistics?half=true&fixture='].map((p) => api('/' + p + id)));
  if (!fx.data[0]) throw new Error('Match not found.');
  if (ln.data.length < 2) throw new Error('No lineups for this match yet (the competition may not be covered).');
  return { D: buildMatch(fx.data[0], ln.data, ev.data, st.data), left: st.left };
}

// ---------- conversion: API data -> app project ----------
const lum = (c) => { const n = parseInt(c.slice(1), 16); return (((n >> 16) * 299) + (((n >> 8) & 255) * 587) + ((n & 255) * 114)) / 1000; };
const kit = (c, fb) => (/^[0-9a-f]{6}$/i.test(c || '') && lum('#' + c) > 70 ? '#' + c : fb);
const surname = (s) => { const p = (s || '').trim().split(/\s+/); return p.length > 1 && p[0].endsWith('.') ? p.slice(1).join(' ') : (s || '').trim(); };
const flip = (q) => [68 - q[0], 105 - q[1]];

function formation(ln) { // starting XI -> positions in world metres (first-half orientation: own goal at y=0 for Home)
  const rows = {}; ln.startXI.forEach(({ player }, i) => { const [r, c] = (player.grid || '1:1').split(':').map(Number); (rows[r] = rows[r] || []).push({ i, c }); });
  const R = Math.max(...Object.keys(rows).map(Number)), pos = [];
  Object.entries(rows).forEach(([r, list]) => { list.sort((a, b) => a.c - b.c); list.forEach((o, k) => { pos[o.i] = [(68 * (k + 1)) / (list.length + 1), 5 + ((r - 1) * 44) / Math.max(1, R - 1)]; }); });
  return pos;
}

export function buildMatch(fx, lineups, events, stats) {
  const hid = fx.teams.home.id, L = { A: lineups.find((l) => l.team.id === hid) || lineups[0], B: lineups.find((l) => l.team.id !== hid) || lineups[1] };
  const name = { A: fx.teams.home.name, B: fx.teams.away.name }, idx = { A: {}, B: {} }, teams = {}, base = {}; // base = formation spots in FIRST-half orientation
  ['A', 'B'].forEach((k) => {
    const ln = L[k], all = [...ln.startXI, ...ln.substitutes];
    teams[k] = { name: name[k], color: kit(ln.team.colors?.player?.primary, k === 'A' ? '#00e5ff' : '#f5c542'), formation: ln.formation,
      players: all.map(({ player }, i) => { idx[k][player.id] = i; return { n: player.number ?? '', name: surname(player.name), ...(i >= ln.startXI.length ? { bench: true, join: 'never' } : {}) }; }) };
    const fp = formation(ln); base[k] = all.map((_, i) => { const q = fp[i] || [34, -6]; return i < ln.startXI.length ? (k === 'A' ? q : flip(q)) : [34, -6]; });
  });

  // ---- statistics: full match, first half, second half (from the API when present, otherwise estimated) ----
  const pick = (arr) => { const g = (n) => parseFloat(String(arr?.find((x) => x.type === n)?.value ?? 0)) || 0; return { poss: g('Ball Possession'), shots: g('Total Shots'), sot: g('Shots on Goal'), big: g('Corner Kicks') }; };
  const halfArr = (t, re) => { const key = Object.keys(t || {}).find((x) => x !== 'statistics' && Array.isArray(t[x]) && re.test(x)); return key ? t[key] : null; };
  const fin = { A: {}, B: {} }; let statsSrc = 'estimated';
  ['A', 'B'].forEach((k) => {
    const t = stats.find((s) => s.team.id === L[k].team.id), full = pick(t?.statistics); let h1 = halfArr(t, /1|first/i), h2 = halfArr(t, /2|second/i);
    h1 = h1 && pick(h1); h2 = h2 && pick(h2);
    if (h1) { statsSrc = 'api'; if (!h2) h2 = { poss: full.poss, shots: full.shots - h1.shots, sot: full.sot - h1.sot, big: full.big - h1.big }; }
    else { const e = (key) => Math.round(full[key] * 0.45); h1 = { poss: full.poss, shots: e('shots'), sot: e('sot'), big: e('big') }; h2 = { poss: full.poss, shots: full.shots - h1.shots, sot: full.sot - h1.sot, big: full.big - h1.big }; }
    [h1, h2].forEach((h) => { if (!h.poss) h.poss = full.poss || 50; });
    fin[k] = { full, h1, h2 };
  });
  if (!fin.A.full.poss && !fin.B.full.poss) ['full', 'h1', 'h2'].forEach((s) => { fin.A[s].poss = fin.B[s].poss = 50; });

  const evs = events.map((e) => ({ ...e, m: e.time.elapsed + (e.time.extra || 0) })).sort((a, b) => a.m - b.m);
  const lastM = Math.max(90, ...evs.map((e) => e.m)), score = [0, 0], kfs = [], evList = [];
  let per = '1H', swapped = false, t = 0, ball = [34, 52.5], curField = null, htDone = false;
  const stat = (m, p = per) => { const s = p === 'FT' ? 1 : p === '1H' ? cl(m / 45, 0, 1) : cl((m - 45) / Math.max(1, lastM - 45), 0, 1), src = p === 'FT' ? 'full' : p === '1H' ? 'h1' : 'h2', f = (key, k) => Math.round(fin[k][src][key] * s);
    return { poss: [Math.round(fin.A[src].poss), Math.round(fin.B[src].poss)], shots: [f('shots', 'A'), f('shots', 'B')], sot: [f('sot', 'A'), f('sot', 'B')], big: [f('big', 'A'), f('big', 'B')] }; };
  const K = (dt, m, field, pos, extra) => { t += dt; const k = { id: kfs.length + 1, t: +t.toFixed(1), minute: m, score: [...score], field, sw: swapped, sl: per, actor: null, hold: null, ball: [...ball], A: pos.A.map((q) => [...q]), B: pos.B.map((q) => [...q]), stats: stat(m), comment: { type: 'info', text: '' }, ...extra }; kfs.push(k); return k; };
  const P = (k, i) => `${k}${i}`, pname = (k, i) => teams[k].players[i]?.name || '';
  const copy = () => { const p = { A: base.A.map((q) => [...q]), B: base.B.map((q) => [...q]) }; if (swapped) ['A', 'B'].forEach((k) => { p[k] = p[k].map(flip); }); return p; };
  const toBase = (q) => (swapped ? flip(q) : q);
  const dir = (atk) => ((atk === 'A') !== swapped ? 1 : -1); // +1 = attacks toward y=105
  const shift = (pos, atk, dA, dD) => { ['A','B'].forEach(k=>pos[k].forEach((q,i)=>{if(i===0||i>=L[k].startXI.length)return; const isAttacker=k===atk, targetShift=dir(atk)*(isAttacker?dA:dD); const phase=i/L[k].startXI.length, stagger=isAttacker?Math.sin(phase*Math.PI)*3:-Math.sin(phase*Math.PI)*1.5; q[0]=cl(q[0]+stagger,3,65);q[1]=cl(q[1]+targetShift,3,102)}));return pos};
  const atkOf = (f) => (f === 'away' ? 'A' : 'B'), fieldOf = (atk) => (atk === 'A' ? 'away' : 'home'); // field = whose half is on screen (the half of the team being attacked)
  const midOf = (k) => { let best = 1, bd = 1e9; base[k].forEach((q, i) => { if (i === 0 || i >= L[k].startXI.length) return; const d = Math.abs(q[1] - 52.5); if (d < bd) { bd = d; best = i; } }); return best; };
  const go = (target, m) => { // camera moves to the half where the ball is: a short bridge shows the ball coming forward from the halfway line
    if (curField === target) return;
    const atk = atkOf(target), c = midOf(atk), pos = shift(copy(), atk, 12, 4), d = dir(atk);
    pos[atk][c] = [34, d > 0 ? 55 : 50]; ball = [35.5, d > 0 ? 56.5 : 48.5];
    K(1.4, m, target, pos, { actor: P(atk, c), hold: P(atk, c), comment: { type: 'info', text: `${name[atk]} bring the ball forward` } }); curField = target; ball = [34, 52.5];
  };
  const halfTime = () => {
    htDone = true;
    const gather = copy();
    gather.A.forEach((q) => { q[0] = 60.5; q[1] = 52.5; });
    gather.B.forEach((q) => { q[0] = 60.5; q[1] = 52.5; });
    ball = [60.5,52.5];
    K(1.8,45,'full',gather,{ph:'HT',comment:{type:'info',text:`Half-time regroup on the right-center touchline: ${name.A} ${score[0]} - ${score[1]} ${name.B}`}});
    per='2H'; swapped=true; curField=null;
    const restart=copy();
    ['A','B'].forEach(k=>restart[k].forEach(q=>{q[0]=Math.max(3,Math.min(65,q[0]));q[1]=Math.max(3,Math.min(102,q[1]))}));
    ball=[34,52.5];
    K(1.8,45,'full',restart,{ph:'H2',comment:{type:'info',text:'Second half kick-off: teams swap ends and return from the right-center bench'}});
  };
  K(0, 0, 'full', copy(), { comment: { type: 'info', text: `Kick-off: ${name.A} (${L.A.formation}) v ${name.B} (${L.B.formation})` } });
  const who = (e) => { const k = e.team.id === hid ? 'A' : 'B'; return [k, idx[k][e.player?.id]]; };
  for (let g = 0; g < evs.length; g++) {
    const e = evs[g], h = per === '1H' ? 1 : 2;
    if (!htDone && e.time.elapsed > 45) halfTime();
    const [k, i] = who(e), o = k === 'A' ? 'B' : 'A', hh = per === '1H' ? 1 : 2;
    if (e.type === 'Goal' && e.detail !== 'Missed Penalty') {
      const og = /own/i.test(e.detail || ''), atk = og ? o : k, ai = e.assist?.id != null ? idx[atk][e.assist.id] : undefined;
      go(fieldOf(atk), e.m); const d=dir(atk);
      const build=shift(copy(),atk,10,4); let passer=ai!=null?ai:midOf(atk); if(passer>=L[atk].startXI.length)passer=midOf(atk); const passerId=P(atk,passer); build[atk][passer]=[34+(passer%5-2)*5,d>0?70:35]; ball=[build[atk][passer][0],build[atk][passer][1]+d*1.2];
      K(1.2,e.m-.8,fieldOf(atk),build,{actor:passerId,hold:passerId,comment:{type:'pass',text:`${name[atk]} build possession and create an opening`}});
      let receiver=i!=null&&i<L[atk].startXI.length?i:passer; if(receiver===passer&&passer>1)receiver=midOf(atk); const receiverId=P(atk,receiver); const pass1=shift(copy(),atk,18,6); pass1[atk][passer]=[26,d>0?74:31]; pass1[atk][receiver]=[42,d>0?82:23]; ball=[43,d>0?83:22];
      K(1.1,e.m-.6,fieldOf(atk),pass1,{actor:receiverId,hold:receiverId,comment:{type:'pass',text:`Pass: ${pname(atk,passer)} finds ${pname(atk,receiver)}`}});
      const support=shift(copy(),atk,24,8); if(ai!=null&&ai<L[atk].startXI.length)support[atk][ai]=[22,d>0?78:27]; if(i!=null)support[k][i]=[34+((i%3)-1)*5,d>0?94:11]; const supportId=P(atk,receiver); ball=[support[atk][receiver][0]+1,support[atk][receiver][1]+d*1.2];
      K(1.0,e.m-.35,fieldOf(atk),support,{actor:supportId,hold:supportId,comment:{type:'pass',text:`Supporting run and second pass open the final lane`}});
      const shot=shift(copy(),atk,30,12); if(i!=null)shot[k][i]=[34+((i%3)-1)*5,d>0?94:11]; if(ai!=null&&ai<L[atk].startXI.length)shot[atk][ai]=[50,d>0?84:21]; ball=[shot[k][i||receiver]?.[0]||34,d>0?98:7];
      K(.9,e.m-.1,fieldOf(atk),shot,{actor:i!=null?P(k,i):P(atk,receiver),hold:i!=null?P(k,i):P(atk,receiver),comment:{type:'shot',text:`The attack reaches the penalty area`}});
      const pos=shift(copy(),atk,32,14); if(!og&&i!=null)pos[k][i]=[34+((i%3)-1)*5,d>0?94:11]; if(ai!=null&&ai<L[atk].startXI.length)pos[atk][ai]=[50,d>0?84:21];
      score[atk==='A'?0:1]++; ball=d>0?[37,106.2]:[31,-1.2];
      K(.8,e.m,fieldOf(atk),pos,{actor:i!=null?P(k,i):P(atk,receiver),goalFor:atk,og,comment:{type:'goal',text:`GOAL! ${pname(k,i)}${og?' (own goal)':''} scores for ${name[atk]}`+(ai!=null?`. Assist: ${pname(atk,ai)}`:'')}});
      ball = [34, 52.5];
    } else if (e.type === 'Goal') { // missed penalty
      go(fieldOf(k), e.m); const d = dir(k), pos = shift(copy(), k, 20, 8); if (i != null) pos[k][i] = [34, d > 0 ? 88 : 17]; ball = [34, d > 0 ? 94 : 11];
      K(2, e.m, fieldOf(k), pos, { actor: i != null ? P(k, i) : null, comment: { type: 'shot', text: `Penalty missed by ${pname(k, i)}` } }); ball = [34, 52.5];
    } else if (e.type === 'Card') {
      if (!curField) go('away', e.m);
      const red = /red/i.test(e.detail || ''), up = (curField === 'away') !== swapped, pos = shift(copy(), atkOf(curField), 14, 8); if (i != null) pos[k][i] = [34 + ((i % 5) - 2) * 7, up ? 58 : 47];
      const id = 'c' + evList.length; evList.push({ id, kind: 'card', m: e.m, h: hh, k, i, red, text: `${pname(k, i)} (${name[k]}) is shown a ${red ? 'red' : 'yellow'} card` });
      K(1.5, e.m, curField, pos, { ev: 'card', evId: id, actor: i != null ? P(k, i) : null, comment: { type: red ? 'red' : 'yellow', text: evList.at(-1).text } });
    } else if (e.type === 'subst') {
      const swaps = [e]; while (evs[g + 1] && evs[g + 1].type === 'subst' && evs[g + 1].m === e.m) swaps.push(evs[++g]);
      const pos = copy(), made = [], text = [];
      swaps.forEach((s) => { const [sk, oi] = who(s), ni = idx[sk][s.assist?.id]; if (oi == null || ni == null) return; const bench = [60.5,52.5], outgoing = [bench[0],bench[1]+(made.length*2)];
        pos[sk][oi] = [...outgoing]; pos[sk][ni] = [58.5,58.5+(made.length*2)]; base[sk][ni] = [...base[sk][oi]]; base[sk][oi] = toBase(outgoing); made.push({ k: sk, o: oi, i: ni }); text.push(`${pname(sk, ni)} for ${pname(sk, oi)}`); });
      if (!made.length) continue;
      const id = 's' + evList.length, txt = text.join(', ').slice(0, 110); evList.push({ id, kind: 'sub', m: e.m, h: hh, swaps: made, text: txt });
      const kf = K(1.8, e.m, 'full', pos, { ev: 'sub', evId: id, subDuration: 1.8, isolation: 'substitution', subAfter: made.length?{incoming:P(made[0].k,made[0].i),outgoing:P(made[0].k,made[0].o)}:null, movements: {}, subs: made.map((s) => ({ o: P(s.k, s.o), i: P(s.k, s.i) })), actor: P(made[0].k, made[0].i), comment: { type: 'sub', text: txt } });
      kf.movements={};made.forEach(s=>{const outgoing=P(s.k,s.o),incoming=P(s.k,s.i),start=[...(copy()[s.k][s.o]||[34,52.5])];kf.movements[outgoing]={start,end:[60.5,52.5],duration:1.8,type:'benchExit',benchPoint:[60.5,52.5]};kf.movements[incoming]={start:[60.5,52.5],end:[...(pos[s.k][s.i]||[58.5,58.5])],duration:1.8,type:'benchEntry',benchPoint:[60.5,52.5]};teams[s.k].players[s.o].leave=kf.id;teams[s.k].players[s.i].join=kf.id});
    }
  }
  if (!htDone) halfTime();
  per = 'FT'; K(2.5, lastM, 'full', copy(), { ph: 'FT', comment: { type: 'info', text: `Full time: ${name.A} ${score[0]} - ${score[1]} ${name.B}` } });
  return { meta: { showNames: true, fit: 'stretch', bigLabel: 'Corners' }, evOn: { sub: true, card: true }, events: evList, match: { id: fx.fixture.id, league: fx.league.name, date: fx.fixture.date, venue: fx.fixture.venue?.name || '', statsSrc, statsKeys: Object.keys(stats[0] || {}) }, teams, kfs };
}
