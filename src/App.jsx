
import { useEffect, useRef, useState } from 'react';
import Board from './Board.jsx';
import Timeline from './Timeline.jsx';
import SidePanel from './SidePanel.jsx';
import { demo, mk, bAt, cl } from './engine.js';
import { ensureMovementMeta } from './simulation.js';

const LS = 'peakkick-studio-v3';
const newId = (d) => Math.max(0, ...d.kfs.map((k) => k.id ?? 0)) + 1;

export default function App() {
  const [D, setD] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS));
      return s?.kfs?.[0]?.field ? s : demo();
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

    const ch = [];

    const r = new MediaRecorder(cv.current.captureStream(30), {
      mimeType: mt,
      videoBitsPerSecond: 10e6
    });

    r.ondataavailable = (e) => e.data.size && ch.push(e.data);

    r.onstop = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(
        new Blob(ch, { type: 'video/webm' })
      );
      a.download = 'goal_replay.webm';
      a.click();

      setMsg('Saved goal_replay.webm');
    };

    setMsg('Recording… please wait');
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
      upd((d) => {
        const p = d.teams[k].players[exactIndex];
        const f = d.kfs[sel];

        delete p.join;
        delete p.leave;

        f.hidden = (f.hidden || []).filter(
          (id) => id !== k + exactIndex
        );

        f[k][exactIndex] = f[k][exactIndex] || [34, 52.5];

        f.manual = {
          modified: true,
          source: 'manual'
        };
      });

      setSe(k + exactIndex);
      setMode('kf');

      setMsg(
        `${P[exactIndex].name || '#' + P[exactIndex].n} joins the selected keyframe as an active player.`
      );

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

  const importMatch = (nd) => {
    if (
      !confirm(
        `Replace the current project with ${nd.teams.A.name} v ${nd.teams.B.name}?`
      )
    ) {
      return;
    }

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
      <header className="studio-header">
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
      </header>

      <span className="hint status-line">{msg}</span>

      <div className="workspace">
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

          <Timeline
            D={D}
            sel={sel}
            mode={mode}
            tot={tot}
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
            onDel={del}
            onAttach={attach}
            onJoin={join}
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
        />
      </div>
    </div>
  );
}
