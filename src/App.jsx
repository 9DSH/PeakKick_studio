
import { useEffect, useRef, useState } from 'react';
import Board from './Board.jsx';
import Timeline from './Timeline.jsx';
import SidePanel from './SidePanel.jsx';
import { demo, mk, bAt, cl, presence, W, H } from './engine.js';
import { ensureMovementMeta, ensureRoles, repairSubs } from './simulation.js';
import { MAX_SECONDS } from './importer.js';

const LS = 'peakkick-studio-v3';
const newId = (d) => Math.max(0, ...d.kfs.map((k) => k.id ?? 0)) + 1;

export default function App() {
  const [D, setD] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS));
      return s?.kfs?.[0]?.field ? repairSubs(s) : ensureRoles(demo());
    } catch {
      return demo();
    }
  });

  const [sel, setSel] = useState(0);
  const [se, setSe] = useState('ball');
  const [mode, setMode] = useState('kf');
  const [scrubT, setScrubT] = useState(0);
  const [playing, setPlaying] = useState(false);

  const [msg, setMsg] = useState(
    'Click a dot, then click the pitch to move it. To give the ball to a player: click the ball, then click the player. Right-click or Esc deselects.'
  );

  const cv = useRef();
  const ph = useRef();
  const pb = useRef({ on: false, t0: 0, hold: 0, cb: null });

  const tot = D.kfs.at(-1).t + 1.2;

  useEffect(() => {
    // Esc = deselect, Delete = remove the selected player
    const h = (e) => {
      if (e.target.matches('input,textarea,select')) return;

      if (e.key === 'Escape') {
        setSe(null);
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        se &&
        se !== 'ball'
      ) {
        e.preventDefault();
        delPlayer(se);
      }
    };

    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [se, D]);

  useEffect(() => {
    try {
      localStorage.setItem(LS, JSON.stringify(D));
    } catch {
      // Photos too big: ignore.
    }
  }, [D]);

  const upd = (fn) =>
    setD((d) => {
      const n = structuredClone(d);
      fn(n);

      ensureRoles(n);
      n.kfs.forEach((kf, i) => {
        ensureMovementMeta(kf, i ? n.kfs[i - 1] : null, n);
      });

      return n;
    });

  const play = (cb) => {
    pb.current = {
      on: true,
      t0: performance.now(),
      hold: 0,
      cb: cb || null
    };

    setPlaying(true);
  };

  const stop = () => {
    pb.current.on = false;
    pb.current.cb = null;
    setPlaying(false);
  };

  const onEnd = () => {
    setPlaying(false);

    const f = pb.current.cb;
    pb.current.cb = null;

    if (f) f();
  };

  const record = () => {
    if (!window.MediaRecorder) {
      return alert('Use Chrome or Edge to record.');
    }

    const mt = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mt) {
      return setMsg('This browser does not support WebM recording. Use Chrome or Edge.');
    }

    const canvas = cv.current;
    if (!canvas || canvas.width !== W || canvas.height !== H) {
      return setMsg(`Recording requires a ${W}x${H} canvas.`);
    }

    const stream = canvas.captureStream(30);
    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings();
    if (!track || settings?.width !== W || settings?.height !== H) {
      stream.getTracks().forEach((t) => t.stop());
      return setMsg(`Recording requires a ${W}x${H} capture stream.`);
    }

    const ch = [];

    const r = new MediaRecorder(stream, {
      mimeType: mt,
      videoBitsPerSecond: 10e6
    });

    r.ondataavailable = (e) => e.data.size && ch.push(e.data);

    r.onstop = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(
        new Blob(ch, { type: r.mimeType || 'video/webm' })
      );
      a.download = `goal_replay_${W}x${H}.webm`;
      a.click();
      stream.getTracks().forEach((t) => t.stop());

      setMsg(`Saved ${W}x${H} YouTube Shorts video.`);
    };

    setMsg(`Recording ${W}x${H} at 30 fps… please wait`);
    r.start();
    setMode('kf');
    play(() => setTimeout(() => r.stop(), 400));
  };

  const pick = (i) => {
    setSel(i);
    setMode('kf');
  };

  const setTime = (i, t) =>
    i > 0 &&
    upd((d) => {
      const k = d.kfs;

      k[i].t = cl(
        t,
        k[i - 1].t + 0.1,
        i < k.length - 1 ? k[i + 1].t - 0.1 : 30
      );
    });

  const add = () => {
    const c = D.kfs[sel];
    const n = D.kfs[sel + 1];

    const t =
      Math.round((n ? (c.t + n.t) / 2 : c.t + 1) * 10) / 10;

    if (n && (t <= c.t || t >= n.t)) {
      return setMsg('No room here. Drag markers apart first.');
    }
    if (!n && t + 1.2 > MAX_SECONDS &&
      !window.confirm(`This keyframe will make the replay ${ (t + 1.2).toFixed(1) } s, above the ${MAX_SECONDS} s limit. Add it anyway?`)) {
      return;
    }

    upd((d) => {
      const nk = {
        ...structuredClone(d.kfs[sel]),
        t,
        id: newId(d),
        manual: {
          modified: true,
          source: 'manual'
        },
        movements: {},
        generated: {
          source: 'manual'
        }
      };

      // A duplicated keyframe must not repeat half-time notifications.
      delete nk.htSubs;
      delete nk.instant;

      d.kfs.splice(sel + 1, 0, nk);
    });

    setSel(sel + 1);
    setMode('kf');
    if (!n && t + 1.2 > MAX_SECONDS) setMsg(`Warning: replay is now ${(t + 1.2).toFixed(1)} s. Use “Fit to ${MAX_SECONDS} s”.`);
  };

  const fitToLimit = () => {
    const last = D.kfs.at(-1).t;
    if (last + 1.2 <= MAX_SECONDS) return setMsg(`Replay already fits within ${MAX_SECONDS} s.`);
    const gaps = D.kfs.slice(1).map((kf, i) => kf.t - D.kfs[i].t);
    const minimum = gaps.length * 0.1;
    const target = MAX_SECONDS - 1.2;
    if (minimum > target) {
      return setMsg(`Cannot fit ${D.kfs.length} keyframes within ${MAX_SECONDS} s while keeping 0.1 s minimum gaps.`);
    }
    const flexible = Math.max(0, gaps.reduce((sum, gap) => sum + Math.max(0, gap - 0.1), 0));
    const factor = flexible ? (target - minimum) / flexible : 0;
    upd((d) => {
      let t = 0;
      d.kfs[0].t = 0;
      gaps.forEach((gap, i) => {
        const nextGap = Math.max(0.1, Math.floor((0.1 + Math.max(0, gap - 0.1) * factor) * 10 + 1e-7) / 10);
        t += nextGap;
        d.kfs[i + 1].t = +t.toFixed(1);
      });
    });
    setMsg(`Keyframe times fitted to ${MAX_SECONDS} s. Half-time and full-time markers remain in sequence.`);
  };

  const del = () => {
    if (D.kfs.length <= 2) {
      return setMsg('Keep at least two keyframes.');
    }

    const gone = D.kfs[sel].id;
    const next = (D.kfs[sel + 1] || D.kfs[sel - 1]).id;

    upd((d) => {
      ['A', 'B'].forEach((k) =>
        d.teams[k].players.forEach((p) => {
          if (p.join === gone) p.join = next;
          if (p.leave === gone) p.leave = next;
        })
      );

      d.kfs.splice(sel, 1);
    });

    setSel(Math.max(0, sel - 1));
  };

  const reset = () => {
    if (
      !confirm(
        'Reset ALL keyframes? Positions and timing will be cleared (players, colors, photos and text are kept).'
      )
    ) {
      return;
    }

    upd((d) => {
      const a = d.teams.A.players.length;
      const b = d.teams.B.players.length;
      const f0 = d.kfs[0].field;

      d.kfs = [
        mk(0, a, b, 1, f0),
        mk(3, a, b, 2, f0)
      ];

      ['A', 'B'].forEach((k) =>
        d.teams[k].players.forEach((p) => {
          if (p.bench && p.join != null) {
            p.join = 'never';
          } else {
            delete p.join;
          }

          delete p.leave;
        })
      );
    });

    setSel(0);
    setSe('ball');
    setMode('kf');
    setMsg('Keyframes reset.');
  };

  const loadDemo = () => {
    if (confirm('Replace everything with the demo goal?')) {
      setD(demo());
      setSel(0);
      setSe('ball');
      setMode('kf');
    }
  };

  const move = (id, q) =>
    upd((d) => {
      const k = d.kfs[sel];

      if (id === 'ball') {
        k.ball = q;
        k.hold = null;
      } else {
        k[id[0]][+id.slice(1)] = q;
      }
    });

  const delPlayer = (id) => {
    const k = id[0];
    const i = +id.slice(1);

    if (D.teams[k].players.length <= 1) {
      return setMsg('A team needs at least one player.');
    }

    upd((d) => {
      d.kfs.forEach((f) => {
        if (f.hold === id) {
          f.ball = bAt(d, f);
          f.hold = null;
        }
      });

      d.teams[k].players.splice(i, 1);

      d.kfs.forEach((f) => {
        f[k].splice(i, 1);

        if (f.hold && f.hold[0] === k) {
          const j = +f.hold.slice(1);

          if (j > i) {
            f.hold = k + (j - 1);
          }
        }

        if (f.actor && f.actor[0] === k) {
          const j = +f.actor.slice(1);

          f.actor =
            j === i
              ? null
              : j > i
                ? k + (j - 1)
                : f.actor;
        }
      });
    });

    setSe(null);
    setMsg('Player deleted.');
  };

  const join = (k, exactIndex) => {
    const P = D.teams[k].players;

    if (Number.isInteger(exactIndex) && P[exactIndex]) {
      const id = k + exactIndex, f0 = D.kfs[sel], label = P[exactIndex].name || '#' + P[exactIndex].n;
      if (presence(D, P[exactIndex], f0.t, true) > 0 && !f0.hidden?.includes(id)) {
        setSe(id);
        return setMsg(`${label} is already on the pitch in this keyframe. Click the pitch to move him.`);
      }
      upd((d) => {
        const p = d.teams[k].players[exactIndex], f = d.kfs[sel], b = bAt(d, f);
        const half = f.field !== 'full', up = (f.field === 'away') !== !!f.sw;
        let y = b[1] + (b[1] > 52.5 ? -6 : 6);
        if (half) y = up ? Math.max(y, 56) : Math.min(y, 49);   // inside the visible half
        const spot = [+cl(b[0] + 7, 6, 62).toFixed(1), +cl(y, 4, 101).toFixed(1)];
        const off = (q) => !q || q[1] < 0 || q[1] > 105;        // still parked outside the pitch
        p.join = f.id; delete p.leave;
        d.kfs.forEach((x, j) => {
          x.hidden = (x.hidden || []).filter((h) => h !== id); if (!x.hidden.length) delete x.hidden;
          if (j > sel && off(x[k][exactIndex])) x[k][exactIndex] = [...spot];
        });
        f[k][exactIndex] = spot;
        f.manual = { modified: true, source: 'manual' };
      });
      setSe(id); setMode('kf');
      setMsg(`${label} joins from this keyframe. Click the pitch to place him, then move him in the next keyframes.`);
      return;
    }

    if (P.length >= 26) {
      return setMsg('Max 26 players per team.');
    }

    upd((d) => {
      const fld = d.kfs[sel].field;
      const up = (fld === 'away') !== !!d.kfs[sel].sw;

      const n =
        Math.max(
          0,
          ...d.teams[k].players.map((p) => +p.n || 0)
        ) + 1;

      const q = [
        10 + ((d.teams[k].players.length * 13) % 48),
        fld === 'full' ? 6 : up ? 55 : 50
      ];

      d.teams[k].players.push({
        n,
        name: '',
        role: 'MID',
        join: d.kfs[sel].id
      });

      d.kfs.forEach((f) => f[k].push([...q]));
    });

    setSe(k + P.length);
    setMode('kf');

    setMsg(
      `New ${k} player joins at keyframe ${sel + 1}. Click the pitch to place him, then move him in the next keyframes.`
    );
  };

  const leavePitch = (id) => {
    const k = id[0], i = +id.slice(1), p0 = D.teams[k].players[i], f0 = D.kfs[sel];
    if (!p0) return;
    if (!(presence(D, p0, f0.t, true) > 0)) return setMsg('He is not on the pitch in this keyframe.');
    if (sel === 0 && p0.join == null) return setMsg('He is on the pitch from the start. Pick a later keyframe to remove him from there, or use Delete player to remove him completely.');
    upd((d) => {
      const p = d.teams[k].players[i], f = d.kfs[sel];
      if (p.join === f.id) p.join = 'never'; else p.leave = f.id;   // added here -> back to the bench; otherwise he leaves from here
      d.kfs.forEach((x, j) => { if (j >= sel && x.hold === id) { x.ball = bAt(d, x); x.hold = null; } }); // the ball is let go
    });
    setSe(null);
    setMsg(`${p0.name || '#' + p0.n} is removed from the pitch from this keyframe.`);
  };

  const importMatch = (nd) => {
    if (
      !confirm(
        `Replace the current project with ${nd.teams.A.name} v ${nd.teams.B.name}?`
      )
    ) {
      return;
    }

    nd.subFix = 2;

    setD(nd);
    setSel(0);
    setSe(null);
    setMode('kf');

    setMsg(
      `Imported ${nd.teams.A.name} v ${nd.teams.B.name}: real lineups, subs, goals and cards. Press Play for the draft, then refine it. In-play stats are estimates; the full-time numbers are real.`
    );
  };

  const setField = (f) => {
    upd((d) => {
      const old = d.kfs[sel].field;

      for (
        let j = sel;
        j < d.kfs.length && d.kfs[j].field === old;
        j++
      ) {
        d.kfs[j].field = f;
      }
    });

    setMsg(
      f === 'home'
        ? 'Home field = the half where the Home team defends. Players standing in the other half are hidden: move them into view.'
        : f === 'away'
          ? 'Away field = the half where the Away team defends. Players standing in the other half are hidden: move them into view.'
          : 'Full pitch shown.'
    );
  };

  const attach = (id) => {
    upd((d) => {
      const k = d.kfs[sel];

      if (id) {
        k.hold = id;
      } else {
        k.ball = bAt(d, k);
        k.hold = null;
      }
    });

    if (id) {
      setSe(id);
      setMsg(`Ball is now with ${id}. Click the ball again to detach it.`);
    } else {
      setMsg('Ball detached.');
    }
  };

  return (
    <div id="app">
      <aside className="controls-panel">
        <h1>PeakKick Replay Studio</h1>

        <div className="header-actions">
          <button
            className="pri"
            onClick={playing ? stop : () => play()}
          >
            {playing ? '■ Stop' : '▶ Play'}
          </button>

          <button onClick={record}>● Record .webm</button>

          <button className="dng" onClick={reset}>
            Reset keyframes
          </button>

          <button onClick={loadDemo}>Load demo</button>
        </div>
        <span className="hint status-line">{msg}</span>
      </aside>

      <main className="board-column">
        <Board
          {...{
            D,
            sel,
            se,
            mode,
            scrubT,
            pb,
            ph,
            cv,
            onEnd
          }}
          onSelect={setSe}
          onMove={move}
          onAttach={attach}
          onMsg={setMsg}
        />
      </main>

      <SidePanel
        D={D}
        upd={upd}
        sel={sel}
        se={se}
        setSe={setSe}
        setMsg={setMsg}
        delPlayer={delPlayer}
        onField={setField}
        onImport={importMatch}
        onSelectKeyframe={pick}
        onJoin={join}
        onLeave={leavePitch}
      />

      <Timeline
        D={D}
        sel={sel}
        mode={mode}
        tot={tot}
        maxSeconds={MAX_SECONDS}
        phRef={ph}
        onSel={pick}
        onTime={setTime}
        onField={setField}
        onScrub={(t) => {
          if (!pb.current.on) {
            setMode('scrub');
            setScrubT(t);
          }
        }}
        onAdd={add}
        onFit={fitToLimit}
        onDel={del}
        onAttach={attach}
        onJoin={join}
        onLeave={leavePitch}
      />
    </div>
  );
}
