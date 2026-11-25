import { useState } from 'react';
import { cl, dflt, normalize, EVENT_TYPES } from './engine.js';
import { listFixtures, loadMatch } from './importer.js';
import { setEvents } from './events.js';
import { FORMATIONS, setTeamFormation, mirrorPitch, movementStats, ensureMovementMeta, benchFor, subField } from './simulation.js';
// Resize an uploaded photo to max 256px and return a small data URL.
const readPhoto = (file, png) => new Promise((res) => {
  const im = new Image(), u = URL.createObjectURL(file);
  im.onload = () => { const s = Math.min(1, 256 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = im.width * s; c.height = im.height * s; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u); res(c.toDataURL(png ? 'image/png' : 'image/jpeg', .88)); };
  im.src = u;
});

function PhotoControls({ obj, onChange }) {
  const set = (patch) => onChange({ ...obj, ...patch });
  const up = async (e) => { const f = e.target.files[0]; if (f) set({ src: await readPhoto(f), size: obj?.size || 1, zoom: obj?.zoom || 0.8, x: obj?.x || 0, y: obj?.y || 0 }); e.target.value = ''; };
  const sl = (label, key, a, b, st, def) => <label className="sl">{label}<input type="range" min={a} max={b} step={st} value={obj?.[key] ?? def} onChange={(e) => set({ [key]: +e.target.value })} /></label>;
  return (
    <div className="photo">
      <div className="r" style={{ justifyContent: 'flex-start' }}>
        <label className="up">📷 {obj?.src ? 'Change photo' : 'Upload photo'}<input type="file" accept="image/*" hidden onChange={up} /></label>
        {obj?.src && <button onClick={() => onChange(null)}>Remove</button>}
      </div>
      {obj?.src && <>{sl('Size', 'size', .6, 2.2, .05, 1)}{sl('Zoom', 'zoom', .3, 3, .05, 1)}{sl('Move left/right', 'x', -100, 100, 1, 0)}{sl('Move up/down', 'y', -100, 100, 1, 0)}</>}
    </div>
  );
}

const STATS = [['poss', 'Possession %'], ['shots', 'Total shots'], ['sot', 'On target'], ['big', 'Big chances']];

function Section({ title, children }) {
  return <section className="editor-section"><div className="section-title">{title}</div><div className="section-body">{children}</div></section>;
}

function SubTabs({ items, value, onChange }) {
  return <div className="subtabs">{items.map(([key,label]) => <button key={key} className={value===key?'on':''} onClick={()=>onChange(key)}>{label}</button>)}</div>;
}

export default function SidePanel({ D, upd, sel, se, setSe, setMsg, delPlayer, onField, onImport, onSelectKeyframe }) {
  const [tab, setTab] = useState('kf'), [json, setJson] = useState(null), [formationHalf, setFormationHalf] = useState('first'), [bulk, setBulk] = useState([]), [kfSub, setKfSub] = useState('moment'), [formationSub, setFormationSub] = useState('team'), [playerSub, setPlayerSub] = useState('active'), [eventSub, setEventSub] = useState('types'), [matchSub, setMatchSub] = useState('teams'), [subTeam, setSubTeam] = useState('A'), [subOut, setSubOut] = useState(0), [subIn, setSubIn] = useState(0), kf = D.kfs[sel];
  const [date, setDate] = useState(() => new Date(Date.now() - 864e5).toISOString().slice(0, 10)), [q, setQ] = useState(''), [rows, setRows] = useState([]), [fid, setFid] = useState(''), [ist, setIst] = useState('');
  const find = async () => { setIst('Searching…'); try { const r = await listFixtures(date); setRows(r.rows); setIst(`${r.rows.length} finished matches. Requests left today: ${r.left ?? '?'}`); } catch (e) { setIst(e.message); } };
  const load = async (id) => { if (!id) return; setIst('Loading match…'); try { const r = await loadMatch(id); setIst(`Loaded. ${r.D.match.statsSrc === 'api' ? 'First-half and second-half stats came from the API.' : 'The API sent no half-by-half stats, so the halves are estimated from the full-match totals.'} Requests left today: ${r.left ?? '?'}`); onImport(r.D); } catch (e) { setIst(e.message); } };
  const setN = (k, n) => upd((d) => {
    const P = d.teams[k].players; n = cl(n, 1, 26);
    while (P.length < n) { P.push({ n: Math.max(0, ...P.map((p) => +p.n || 0)) + 1, name: '' }); d.kfs.forEach((f) => f[k].push(dflt(k, P.length - 1))); }
    while (P.length > n) { P.pop(); d.kfs.forEach((f) => { f[k].pop(); if (f.hold && f.hold[0] === k && +f.hold.slice(1) >= P.length) f.hold = null; if (f.actor && f.actor[0] === k && +f.actor.slice(1) >= P.length) f.actor = null; }); }
  });
  const player = (k, i, patch) => upd((d) => Object.assign(d.teams[k].players[i], patch));
  const K = (fn) => upd((d) => fn(d.kfs[sel]));
  const noPhotos = (d) => JSON.stringify(d, (key, v) => (key === 'photo' || key === 'badge' ? undefined : v));
  const copy = (txt, m) => navigator.clipboard.writeText(txt).then(() => setMsg(m));
  const apply = () => { try {
    const n = JSON.parse(json); if (!n.kfs?.length) throw 0;
    n.teams = n.teams || {}; ['A', 'B'].forEach((k) => { if (!n.teams[k]?.players?.length) n.teams[k] = { ...(n.teams[k] || {}), players: D.teams[k].players, name: n.teams[k]?.name || D.teams[k].name, color: n.teams[k]?.color || D.teams[k].color }; });
    normalize(n); ['A', 'B'].forEach((k) => { if (!n.teams[k].badge) n.teams[k].badge = D.teams[k].badge; });
    ['A', 'B'].forEach((k) => n.teams[k].players.forEach((p, i) => { const o = D.teams[k].players[i]; if (o && !p.photo) { p.photo = o.photo; p.size = o.size; p.zoom = o.zoom; p.x = o.x; p.y = o.y; } })); // keep faces
    upd((d) => { Object.keys(d).forEach((x) => delete d[x]); Object.assign(d, n); }); setJson(null); setMsg('JSON applied. Press Play to watch it.'); } catch { alert('That JSON is not valid.'); } };
  const prompt = () => `You are building a football match replay for PeakKick Replay Studio. I will describe a match. Return ONLY valid JSON in the format below.

PITCH: world coordinates in metres, x 0-68 (left to right), y 0-105. The HOME team (key A) defends the goal at y=0 and attacks toward y=105. The AWAY team (key B) defends y=105 and attacks toward y=0. Players are numbered by their position in each list: A0 = first home player, B3 = fourth away player.
FIELD: "field" is which half the camera shows: "away" = camera on the Away half, Away goal at the TOP (use while Home attack upward), "home" = camera on the Home half, Home goal at the BOTTOM (use while Away attack downward), "full" = whole pitch, use it ONLY at kick-off, half-time, the second-half restart, full time and substitutions. During play always use "away" or "home" (whichever half the ball is in) and switch when the ball crosses halfway, with a short keyframe showing the ball at the halfway line.

FORMAT:
{"teams":{"A":{"name":"","color":"#00e5ff","players":[{"n":9,"name":"Name"}]},"B":{"name":"","color":"#f5c542","players":[{"n":1,"name":"Name"}]}},
"kfs":[{"t":0,"minute":10,"score":[0,0],"field":"away","actor":"A3","hold":"A3","ball":[34,60],"mv":{"A3":[36,70],"B2":[30,80]},"stats":{"poss":[55,45],"shots":[3,1],"sot":[1,0],"big":[0,0]},"comment":{"type":"pass","text":"Short commentary line"}}]}

RULES:
- In the second half the teams swap ends: from the second-half kick-off on set "sw":true on every keyframe. Then HOME attacks toward y=0 and AWAY toward y=105, and "away"/"home" still mean the Away/Home team's half, wherever it is.
- "sl" says which numbers the scoreboard shows: "1H" in the first half, "2H" in the second half (second-half numbers only), "FT" at full time.
- t = seconds in the video, starting at 0. A pass takes 0.6-1.2 s, a shot 0.4-0.8 s, a run 0.8-2 s. One keyframe per moment.
- The first keyframe must place everyone with full arrays "A":[[x,y],...] and "B":[[x,y],...]. In later keyframes list in "mv" only the players (and "ball") that moved; everyone else stays where they were.
- "hold" = id of the player with the ball (the ball is glued to him), otherwise null and give "ball":[x,y]. A pass = a keyframe where hold changes to the receiver.
- "actor" = the player this moment is about. For a goal, actor MUST be the scorer: the scoreboard lists scorers and minutes from the goal keyframes.
- "minute" = match minute at that moment. "score" = [home, away] so far. "stats" are totals so far, each [home, away]: poss = possession %, shots, sot = shots on target, big = big chances.
- comment.type is one of: ${EVENT_TYPES.join(', ')}. For a goal, use type "goal", the new score, and put the ball about 1 m behind the goal line (y about 106 for Home goals, y about -1 for Away goals).
- Keep my player names and numbers unless I give new ones. If the JSON came from a real match import, KEEP every real fact (lineups, substitutions, goals, cards, minutes, score, stats) and keep each player's join, leave and bench fields, every keyframe id, and goalFor / og on goals. Only improve the movement: add extra keyframes between the real events for build-up play, passes (hold changes) and shots, following my description below.

MY MATCH DESCRIPTION: [WRITE WHAT HAPPENED HERE: teams, lineups, then moment by moment with minutes]

CURRENT JSON:
${noPhotos(D)}`;
  const tabs = [['kf', 'Keyframe'], ['fo', 'Formation'], ['pl', 'Players'], ['ev', 'Events'], ['im', 'Import'], ['ma', 'Match'], ['js', 'AI / JSON']];
  return (
    <aside className="side">
      <nav>{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
      {tab === 'im' && <>
        <p className="hint">Needs a free API-Football key in the .env file (see README). One match costs about 3 of your 100 daily requests. Importing replaces the current project.</p>
        <div className="f"><label>Match date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><label>Filter (team or league)<input value={q} onChange={(e) => setQ(e.target.value)} /></label></div>
        <button className="pri" onClick={find}>Find finished matches</button>
        <div className="mlist">{rows.filter((r) => (r.home + r.away + r.league).toLowerCase().includes(q.toLowerCase())).map((r) => <button key={r.id} className="mrow" onClick={() => load(r.id)}><small>{r.league}</small><br />{r.home} {r.gh}-{r.ga} {r.away}</button>)}</div>
        <div className="r"><input placeholder="or fixture ID" value={fid} onChange={(e) => setFid(e.target.value)} style={{ width: 130 }} /><button onClick={() => load(fid)}>Load</button></div>
        <p className="hint">{ist}</p>
      </>}
      {tab === 'kf' && <>
        <div className="panel-heading"><div><small>Selected keyframe</small><b>{sel + 1} · {kf.t.toFixed(1)} s</b></div><span className="source-badge">{kf.manual?.modified?'Modified':'Generated'}</span></div>
        <SubTabs items={[['moment','Moment'],['movements','Movements'],['players','Players'],['stats','Stats']]} value={kfSub} onChange={setKfSub}/>
        {kfSub==='moment'&&<><Section title="Timing & view"><div className="f"><label>Match minute<input type="number" step="0.1" value={kf.minute??0} onChange={(e)=>K(f=>{f.minute=+e.target.value;f.manual.modified=true})}/></label><label>View<select value={kf.field} onChange={(e)=>onField(e.target.value)}><option value="full">Full pitch</option><option value="away">Away half</option><option value="home">Home half</option></select></label></div></Section>
        <Section title="Event"><label className="hint">Type<select value={kf.comment?.type||'info'} onChange={(e)=>K(f=>{f.comment={...f.comment,type:e.target.value};f.manual.modified=true})}>{EVENT_TYPES.map(t=> <option key={t}>{t}</option>)}</select></label><label className="hint">Description<textarea className="cm" value={kf.comment?.text||''} onChange={(e)=>K(f=>{f.comment={...f.comment,text:e.target.value};f.manual.modified=true})}/></label><label className="hint">Player involved<select value={kf.actor||''} onChange={(e)=>K(f=>{f.actor=e.target.value||null;f.manual.modified=true})}><option value="">None</option>{['A','B'].flatMap(k=>D.teams[k].players.map((p,i)=> <option key={k+i} value={k+i}>{D.teams[k].name} #{p.n} {p.name}</option>))}</select></label></Section></>}
        {kfSub==='movements'&&<><Section title="Movement inspector"><small className="hint">{kf.generated?'API / generated':'Manual keyframe'}{kf.manual?.modified?' · manually modified':''}</small>{kf.movements?Object.entries(kf.movements).map(([id,m])=>{const p=D.teams[id[0]]?.players[+id.slice(1)];if(!p)return null;const s=movementStats(m.start,m.end,m.duration);return <button className={'mrow '+(se===id?'on':'')} key={id} onClick={()=>setSe(id)}><b>{p.name||`#${p.n}`}</b><small>{id} · {s.distance} m · {s.duration}s · {m.type}</small></button>}):<p className="hint">Movement metadata will appear after editing or playback.</p>}<div className="r"><button onClick={()=>upd(d=>d.kfs.forEach((f,i)=>ensureMovementMeta(f,i?d.kfs[i-1]:null,d)))}>Refresh</button><button onClick={()=>K(f=>{delete f.manual;f.generated={source:'api'}})}>Reset edits</button></div></Section></>}
        {kfSub==='players'&&<><Section title="Manual substitution"><div className="f"><label>Team<select value={subTeam} onChange={(e)=>{setSubTeam(e.target.value);setSubOut(0);setSubIn(0)}}><option value="A">Home</option><option value="B">Away</option></select></label><label>Outgoing player<select value={subOut} onChange={(e)=>setSubOut(+e.target.value)}>{D.teams[subTeam].players.map((p,i)=> <option key={i} value={i}>OUT · #{p.n||i+1} {p.name||`Player ${i+1}`}</option>)}</select></label><label>Incoming player<select value={subIn} onChange={(e)=>setSubIn(+e.target.value)}>{D.teams[subTeam].players.map((p,i)=> <option key={i} value={i}>IN · #{p.n||i+1} {p.name||`Player ${i+1}`}</option>)}</select></label></div><label className="hint">Substitution duration (seconds)<input type="range" min="0.6" max="5" step="0.1" value={kf.subDuration||2.4} onChange={(e)=>K(f=>{const duration=+e.target.value;f.subDuration=duration;if(f.movements)Object.values(f.movements).forEach(m=>m.duration=duration)})}/><small>{(kf.subDuration||2.4).toFixed(1)} s</small></label>
<button className="pri" onClick={()=>K(f=>{
  const out=subTeam+subOut, inPlayer=subTeam+subIn, prev=D.kfs[sel-1];
  const bench=benchFor(subTeam,f.sw), spot=[...(prev?.[subTeam]?.[subOut]||f[subTeam][subOut])];
  f.subs=[{o:out,i:inPlayer,k:subTeam}]; f.ev='sub'; f.isolation='substitution'; f.actor=inPlayer; f.subDuration=f.subDuration||2.4;
  f.field=subField(subTeam); f.hold=null; delete f.ballMovement;   // camera on the half where this team plays
  f[subTeam][subOut]=[...bench]; f[subTeam][subIn]=[...spot];
  f.movements={
    [out]:{start:[...spot],end:[...bench],duration:f.subDuration,type:'benchExit',benchPoint:[...bench]},
    [inPlayer]:{start:[...bench],end:[...spot],duration:f.subDuration,type:'benchEntry',benchPoint:[...bench]}
  };
  f.comment={type:'sub',text:`Substitution: ${D.teams[subTeam].players[subIn]?.name||'#'+D.teams[subTeam].players[subIn]?.n||'Player'} enters for ${D.teams[subTeam].players[subOut]?.name||'#'+D.teams[subTeam].players[subOut]?.n||'Player'}`};
  f.hidden=[...new Set([...(f.hidden||[]).filter(id=>id!==inPlayer&&id!==out),out])];
  f.subAfter={incoming:inPlayer,outgoing:out};
  f.manual={modified:true,source:'manual'};
})}>Generate substitution paths</button></Section><Section title="Players in this keyframe">{['A','B'].map(team=><div key={team}><small className="hint">{team==='A'?D.teams.A.name:D.teams.B.name}</small>{D.teams[team].players.map((p,i)=>{const id=team+i;const present=kf.hidden?.includes(id)?false:(p.join==='never'?false:true);return <label className="prow row" key={id}><input type="checkbox" checked={present} onChange={(e)=>K(f=>{f.hidden=f.hidden||[];if(e.target.checked)f.hidden=f.hidden.filter(x=>x!==id);else f.hidden=[...new Set([...f.hidden,id])];f.manual={modified:true,source:'manual'}})}/><b>#{p.n}</b><span className="nm">{p.name||`Player ${i+1}`}</span><button onClick={()=>setSe(id)}>Edit</button></label>})}</div>)}<p className="hint">Checked = in this keyframe only. Uncheck a player to remove him from this event/scene. Use Edit to place him, and use the checkbox again to restore him.</p><div className="r"><button onClick={()=>K(f=>{delete f.hidden;f.manual={modified:true,source:'manual'}})}>Show all players</button></div></Section></>}
        {kfSub==='stats'&&<Section title="Score, possession & match statistics"><div className="g4"><span/><span>{D.teams.A.name}</span><span>{D.teams.B.name}</span>{STATS.map(([key,label])=>[<span key={key}>{key==='big'?D.meta.bigLabel||label:label}</span>,<input key={key+'a'} type="number" value={kf.stats?.[key]?.[0]??0} onChange={(e)=>K(f=>{f.stats[key][0]=+e.target.value})}/>,<input key={key+'b'} type="number" value={kf.stats?.[key]?.[1]??0} onChange={(e)=>K(f=>{f.stats[key][1]=+e.target.value})}/>])}</div></Section>}
      </>}
      {tab === 'fo' && <>
        <SubTabs items={[['team','Team layout'],['halves','Half setup']]} value={formationSub} onChange={setFormationSub}/>
        <div className="r"><span className="seg2">{[['first','1st half'],['second','2nd half']].map(([h,l])=><button key={h} className={formationHalf===h?'pri':''} onClick={()=>setFormationHalf(h)}>{l}</button>)}</span></div>
        {formationSub==='team'?['A','B'].map(k=> <Section key={k} title={`${k==='A'?'Home':'Away'} · ${D.teams[k].name}`}><label className="hint">Preset<select value={D.teams[k].formation||'4-3-3'} onChange={(e)=>upd(d=>setTeamFormation(d,k,formationHalf,e.target.value))}>{Object.keys(FORMATIONS).map(x=> <option key={x}>{x}</option>)}</select></label><div className="r"><button onClick={()=>upd(d=>setTeamFormation(d,k,formationHalf,D.teams[k].formation||'4-3-3'))}>Apply preset</button><button onClick={()=>upd(d=>d.kfs.forEach(kf=>{const isSecond=(kf.minute||0)>=45||!!kf.sw;if((formationHalf==='second')!==isSecond)return;(kf[k]||[]).forEach((q,i)=>kf[k][i]=mirrorPitch(q))}))}>Mirror</button><button onClick={()=>upd(d=>setTeamFormation(d,k,formationHalf,D.teams[k].formation||'4-3-3',true))}>Mirror & apply</button></div></Section>):<Section title="Copy & reset"><p className="hint">Choose a team and preset to update only the selected half. Dragging a player on the pitch edits the current keyframe without replacing unrelated positions.</p></Section>}
      </>}
      {tab === 'pl' && <>
        <SubTabs items={[['active','Active / bench'],['roster','Full roster']]} value={playerSub} onChange={setPlayerSub}/>
        {playerSub==='active'&&['A','B'].map(k=>{const active=D.teams[k].players.map((p,i)=>({p,i,id:k+i})).filter(({p})=>p.join!== 'never'&&!p.bench);const bench=D.teams[k].players.map((p,i)=>({p,i,id:k+i})).filter(({p})=>p.join==='never'||p.bench);return <Section key={k} title={`${k==='A'?'Home':'Away'} · ${D.teams[k].name}`}><div className="r"><button onClick={()=>setBulk(active.map(x=>x.id))}>Select active</button><button onClick={()=>setBulk(bench.map(x=>x.id))}>Select bench</button><button onClick={()=>setBulk([])}>Clear</button></div><small className="hint">On pitch ({active.length})</small>{active.map(({p,i,id})=><label className="prow row" key={id}><input type="checkbox" checked={bulk.includes(id)} onChange={()=>setBulk(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id])}/><i style={{background:D.teams[k].color}}/><b>#{p.n}</b><span className="nm" onClick={()=>setSe(id)}>{p.name||'Unnamed'}</span></label>)}<small className="hint">Substitution bench ({bench.length})</small>{bench.map(({p,i,id})=><label className="prow row" key={id}><input type="checkbox" checked={bulk.includes(id)} onChange={()=>setBulk(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id])}/><i style={{background:D.teams[k].color}}/><b>#{p.n}</b><span className="nm" onClick={()=>setSe(id)}>{p.name||'Unnamed'}</span></label>)}</Section>})}
        {playerSub==='active'&&<Section title="Bulk actions"><div className="r"><button className="pri" disabled={!bulk.length} onClick={()=>upd(d=>bulk.forEach(id=>{const p=d.teams[id[0]].players[+id.slice(1)];delete p.join;d.kfs.forEach(f=>{if(!f[id[0]][+id.slice(1)])f[id[0]][+id.slice(1)]=[34,52.5]})}))}>Add to pitch</button><button className="dng" disabled={!bulk.length} onClick={()=>upd(d=>bulk.forEach(id=>d.teams[id[0]].players[+id.slice(1)].join='never'))}>Move to bench</button></div></Section>}
        {playerSub==='roster'&&<>
        {['A', 'B'].map((k) => { const T = D.teams[k]; return (
          <div className="team" key={k}>
            <div className="th"><b>{k === 'A' ? 'Home' : 'Away'}: {T.name}</b>
              <input type="color" value={T.color} onChange={(e) => upd((d) => { d.teams[k].color = e.target.value; })} />
              <span className="cnt"><button onClick={() => setN(k, T.players.length - 1)}>−</button><span>{T.players.length}</span><button onClick={() => setN(k, T.players.length + 1)}>+</button></span></div>
            {T.players.map((p, i) => { const id = k + i, on = se === id; return (
              <div key={id} className={'prow' + (on ? ' on' : '')}>
                <div className="row" onClick={(e) => (!on ? setSe(id) : e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON' && setSe(null))}><i style={{ background: T.color }} />
                  <input className="n" type="number" min="0" max="99" value={p.n} title="Shirt number" onChange={(e) => player(k, i, { n: e.target.value })} />
                  <input className="nm" placeholder="Name (optional)" value={p.name || ''} onChange={(e) => player(k, i, { name: e.target.value })} /></div>
                {on && <div className="photo"><div className="r" style={{ justifyContent: 'flex-start' }}><button className="dng" onClick={() => delPlayer(id)}>Delete player (Del)</button>{p.join != null && <span className="hint">joins at keyframe {D.kfs.findIndex((x) => x.id === p.join) + 1}</span>}</div></div>}
                {on && <PhotoControls obj={p.photo ? { src: p.photo, size: p.size, zoom: p.zoom, x: p.x, y: p.y } : null} onChange={(o) => player(k, i, o ? { photo: o.src, size: o.size, zoom: o.zoom, x: o.x, y: o.y } : { photo: null, size: 1, zoom: 1, x: 0, y: 0 })} />}
              </div>); })}
          </div>); })}
        {['A','B'].map(k=>{const active=D.teams[k].players.map((p,i)=>({p,i,id:k+i})).filter(({p})=>p.join!== 'never'&&!p.bench);const bench=D.teams[k].players.map((p,i)=>({p,i,id:k+i})).filter(({p})=>p.join==='never'||p.bench);return <div className="team" key={'mg'+k}><b>{k==='A'?'Home':'Away'} players</b>
          <div className="r"><button onClick={()=>setBulk(active.map(x=>x.id))}>Select all active</button><button onClick={()=>setBulk(bench.map(x=>x.id))}>Select bench</button><button onClick={()=>setBulk([])}>Clear</button></div>
          <small className="hint">On pitch ({active.length})</small>{active.map(({p,i,id})=><label className="prow row" key={id}><input type="checkbox" checked={bulk.includes(id)} onChange={()=>setBulk(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id])}/><i style={{background:D.teams[k].color}}/><b>#{p.n}</b><span className="nm" onClick={()=>setSe(id)}>{p.name||'Unnamed'}</span></label>)}
          <small className="hint">Substitution bench ({bench.length})</small>{bench.map(({p,i,id})=><label className="prow row" key={id}><input type="checkbox" checked={bulk.includes(id)} onChange={()=>setBulk(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id])}/><i style={{background:D.teams[k].color}}/><b>#{p.n}</b><span className="nm" onClick={()=>setSe(id)}>{p.name||'Unnamed'}</span></label>)}
        </div>})}
        <div className="r"><button className="pri" disabled={!bulk.length} onClick={()=>upd(d=>bulk.forEach(id=>{const p=d.teams[id[0]].players[+id.slice(1)];delete p.join;d.kfs.forEach(f=>{if(!f[id[0]][+id.slice(1)])f[id[0]][+id.slice(1)]=[34,52.5]})}))}>Add selected to pitch</button><button className="dng" disabled={!bulk.length} onClick={()=>upd(d=>bulk.forEach(id=>{d.teams[id[0]].players[+id.slice(1)].join='never'}))}>Move selected to bench</button></div>
        </>}
      </>}
      {tab === 'mo' && <>
        <b className="hint">Keyframe {sel + 1} at {kf.t}s: what the screen shows from here on</b>
        <div className="f">
          <label>Match minute<input type="number" step="0.1" value={kf.minute} onChange={(e) => K((f) => { f.minute = +e.target.value; })} /></label>
          <label>Field shown<select value={kf.field} onChange={(e) => onField(e.target.value)}><option value="away">Away field (the Away team's half)</option><option value="home">Home field (the Home team's half)</option><option value="full">Full pitch</option></select></label>
          <label>{D.teams.A.name} goals<input type="number" min="0" value={kf.score[0]} onChange={(e) => K((f) => { f.score[0] = +e.target.value; })} /></label>
          <label>{D.teams.B.name} goals<input type="number" min="0" value={kf.score[1]} onChange={(e) => K((f) => { f.score[1] = +e.target.value; })} /></label>
        </div>
        <label className="hint">Player this moment is about (the scorer on goals)<select value={kf.actor || ''} onChange={(e) => K((f) => { f.actor = e.target.value || null; })}>
          <option value="">None</option>{['A', 'B'].flatMap((k) => D.teams[k].players.map((p, i) => <option key={k + i} value={k + i}>{D.teams[k].name} #{p.n} {p.name}</option>))}</select></label>
        <div className="f"><label>Stats shown<select value={kf.sl || ''} onChange={(e) => K((f) => { f.sl = e.target.value; })}><option value="">none</option><option value="1H">1st half</option><option value="2H">2nd half</option><option value="FT">Full time</option></select></label>
          <label className="hint"><input type="checkbox" checked={!!kf.sw} onChange={(e) => upd((d) => { for (let j = sel; j < d.kfs.length; j++) d.kfs[j].sw = e.target.checked; })} /> Teams swapped ends (2nd half), from here on</label></div>
        <div className="f"><label>Commentary type<select value={kf.comment.type} onChange={(e) => K((f) => { f.comment.type = e.target.value; })}>{EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label></div>
        <label className="hint">Commentary text<textarea className="cm" value={kf.comment.text} onChange={(e) => K((f) => { f.comment.text = e.target.value; })} /></label>
        <div className="g4"><span /><span>{D.teams.A.name}</span><span>{D.teams.B.name}</span>
          {STATS.map(([key, label]) => [<span key={key}>{key === 'big' ? (D.meta.bigLabel || label) : label}</span>, <input key={key + 0} type="number" min="0" value={kf.stats[key][0]} onChange={(e) => K((f) => { f.stats[key][0] = +e.target.value; })} />, <input key={key + 1} type="number" min="0" value={kf.stats[key][1]} onChange={(e) => K((f) => { f.stats[key][1] = +e.target.value; })} />])}</div>
        <p className="hint">Each keyframe keeps its own score, stats and comment. The clock runs smoothly between keyframe minutes.</p>
      </>}
      {tab === 'ev' && <>
        <SubTabs items={[['types','Event types'],['inventory','Event list']]} value={eventSub} onChange={setEventSub}/>
        {eventSub==='types'?['sub','yellow','red'].map(kind=>{const list=(D.events||[]).filter(e=>kind==='sub'?e.kind==='sub':e.kind==='card'&&(kind==='red'?e.red:!e.red));const on=D.evOn?.[kind]!==false&&!(kind==='yellow'||kind==='red'&&D.evOn?.card===false);const key=kind==='sub'?'sub':'card';return <Section key={kind} title={kind==='sub'?'Substitutions':kind==='yellow'?'Yellow cards':'Red cards'}><label className="hint toggle-row"><input type="checkbox" checked={on} onChange={(e)=>{const m=setEvents(structuredClone(D),key,e.target.checked);upd(d=>setEvents(d,key,e.target.checked));setMsg(m)}}/>Enabled</label><small className="hint">{list.length} event(s) · {D.kfs.filter(f=>kind==='sub'?f.ev==='sub':kind==='yellow'?f.comment?.type==='yellow':f.comment?.type==='red').length} generated keyframes</small></Section>}):<Section title="Match events"><div className="mlist">{(D.events||[]).map((e,i)=>{const names=(e.swaps||[]).map(s=>{const p=D.teams[s.k]?.players[s.i];const o=D.teams[s.k]?.players[s.o];return `${p?.name||'#'+p?.n||'IN'} ↔ ${o?.name||'#'+o?.n||'OUT'}`}).join(', ')||e.text||'Card event';return <button className="mrow" key={e.id||i} onClick={()=>{const i=D.kfs.findIndex(k=>k.evId===e.id||(e.kind==='goal'&&k.comment?.type==='goal'&&k.minute===e.m));if(i>=0&&onSelectKeyframe)onSelectKeyframe(i);else setMsg(`Event at ${e.m}' has no matching keyframe`)}}><b>{e.m}'</b><small>{names}</small></button>})}</div></Section>}
      </>}
      {tab === 'ma' && <>
        <SubTabs items={[['teams','Teams'],['display','Display']]} value={matchSub} onChange={setMatchSub}/>
        {matchSub==='teams'?<><Section title="Team names"><div className="f"><label>Home team name<input value={D.teams.A.name} onChange={(e)=>upd(d=>{d.teams.A.name=e.target.value})}/></label><label>Away team name<input value={D.teams.B.name} onChange={(e)=>upd(d=>{d.teams.B.name=e.target.value})}/></label></div></Section>{['A','B'].map(k=><Section key={k} title={`${k==='A'?'Home':'Away'} badge`}><div className="th">{D.teams[k].badge&&<img src={D.teams[k].badge} alt="" style={{height:34}}/>}<label className="up">Upload<input type="file" accept="image/*" hidden onChange={async(e)=>{const f=e.target.files[0];if(f){const src=await readPhoto(f,true);upd(d=>{d.teams[k].badge=src})}e.target.value=''}}/></label>{D.teams[k].badge&&<button onClick={()=>upd(d=>{d.teams[k].badge=null})}>Remove</button>}</div></Section>)}</>:<><Section title="Pitch display"><label className="hint">Pitch fit<select value={D.meta.fit||'stretch'} onChange={(e)=>upd(d=>{d.meta.fit=e.target.value})}><option value="stretch">Stretch to fill the board</option><option value="crop">Keep proportions</option></select></label><label className="hint toggle-row"><input type="checkbox" checked={!!D.meta.showNames} onChange={(e)=>upd(d=>{d.meta.showNames=e.target.checked})}/>Show player names</label></Section></>}
      </>}
      {tab === 'js' && <>
        <textarea value={json ?? noPhotos(D)} onChange={(e) => setJson(e.target.value)} />
        <div className="r"><button className="pri" onClick={apply} disabled={json === null}>Apply JSON</button><button onClick={() => copy(noPhotos(D), 'JSON copied.')}>Copy JSON</button><button onClick={() => copy(prompt(), 'AI prompt copied. Paste it into Claude, fill in your match description, then paste the JSON it returns here.')}>Copy AI prompt</button></div>
        <p className="hint">Photos are not included in the JSON, they stay in the app.</p>
      </>}
    </aside>
  );
}
