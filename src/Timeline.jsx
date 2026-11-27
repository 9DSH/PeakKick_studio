import { useEffect, useRef, useState } from 'react';
import { cl } from './engine.js';

const PAD = 22;

export default function Timeline({
  D,
  sel,
  mode,
  tot,
  maxSeconds,
  phRef,
  onSel,
  onTime,
  onScrub,
  onAdd,
  onFit,
  onDel,
  onLeave,
  onAttach,
  onJoin,
  onField
}) {
  const sc = useRef();
  const inner = useRef();
  const phEl = useRef();
  const dr = useRef(null);

  const [
    z,
    setZ
  ] = useState(1);

  const [half, setHalf] = useState('all');
  const [cw, setCw] = useState(800);
  const [fz, setFz] = useState(null);
  const [joinTeam, setJoinTeam] = useState('A');
  const [joinPlayer, setJoinPlayer] = useState(0);

  const k = D.kfs;
  const cur = k[sel];
  const snap = (v) => Math.round(v * 10) / 10;

  const htIndex = k.findIndex((f) => f.ph === 'HT');
  const h2Index = k.findIndex((f) => f.ph === 'H2');
  const fallbackH2 = k.findIndex((f) => f.sl === '2H');
  const minuteBoundary = k.findIndex((f) => f.minute >= 45);
  const secondStart = h2Index > 0 ? h2Index : fallbackH2 > 0 ? fallbackH2 : minuteBoundary;
  const firstEnd = htIndex > 0 ? htIndex : secondStart > 0 ? secondStart - 1 : -1;
  const hasHalves = firstEnd > 0 && secondStart > firstEnd;
  const splitGap = hasHalves ? k[secondStart].t - k[firstEnd].t : 0;
  const halfPadding = Math.min(0.35, Math.max(0, splitGap / 2));
  const range = () => (
    half === '1' && hasHalves
      ? [0, Math.min(tot, k[firstEnd].t + halfPadding)]
      : half === '2' && hasHalves
        ? [Math.max(0, k[secondStart].t - halfPadding), tot]
        : [0, tot]
  );

  const [a, b] = fz ?? range();

  const pps = ((cw - 2 * PAD) / Math.max(1, b - a)) * z;
  const W = 2 * PAD + (b - a) * pps;
  const X = (t) => PAD + (t - a) * pps;

  useEffect(() => {
    const el = sc.current;
    if (typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver(() => setCw(el.clientWidth));
    ro.observe(el);
    setCw(el.clientWidth);

    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = sc.current;

    const h = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();

        setZ((v) =>
          cl(v * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 1, 24)
        );
      }
    };

    el.addEventListener('wheel', h, { passive: false });

    return () => el.removeEventListener('wheel', h);
  }, []);

  useEffect(() => {
    phRef.current = (t, playing) => {
      const x = X(t);

      if (phEl.current) {
        phEl.current.style.left = x + 'px';
      }

      const s = sc.current;

      if (
        playing &&
        s &&
        (x < s.scrollLeft + 40 || x > s.scrollLeft + s.clientWidth - 60)
      ) {
        s.scrollLeft = x - s.clientWidth * 0.3;
      }
    };
  });

  useEffect(() => {
    const s = sc.current;
    const x = X(cur.t);

    if (
      s &&
      (x < s.scrollLeft + 30 || x > s.scrollLeft + s.clientWidth - 30)
    ) {
      s.scrollLeft = Math.max(0, x - s.clientWidth * 0.4);
    }
  }, [sel, z, half]);

  const tAt = (e) => {
    const r = inner.current.getBoundingClientRect();

    return cl(
      a + (e.clientX - r.left - PAD) / pps,
      0,
      tot
    );
  };

  useEffect(() => {
    const mv = (e) => {
      const d = dr.current;
      if (!d) return;

      const t = tAt(e);

      if (d.kind === 'scrub') {
        onScrub(t);
      } else {
        onTime(d.i, snap(t));
      }
    };

    const up = () => {
      if (dr.current) {
        dr.current = null;
        setFz(null);
      }
    };

    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);

    return () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
  });

  const down = (e) => {
    const m = e.target.closest('[data-i]');

    if (m) {
      const i = +m.dataset.i;
      onSel(i);

      if (i > 0) {
        dr.current = { kind: 'kf', i };
        setFz([a, b]);
      }
    } else {
      dr.current = { kind: 'scrub' };
      setFz([a, b]);
      onScrub(tAt(e));
    }
  };

  const joins = (f) =>
    ['A', 'B']
      .flatMap((t) =>
        D.teams[t].players.flatMap((p) => [
          p.join === f.id ? `+${t}${p.n}` : null,
          p.leave === f.id ? `-${t}${p.n}` : null
        ])
      )
      .filter(Boolean)
      .join(' ');

  const step = pps < 10 ? 10 : pps < 22 ? 5 : pps < 45 ? 2 : 1;
  const ticks = [];

  for (
    let s = Math.ceil(a / step) * step;
    s <= b + 1e-6;
    s += step
  ) {
    ticks.push(s);
  }

  let lastX = -1e9;

  const showLabel = k.map((f, i) => {
    const x = X(f.t);
    const s = i === sel || x - lastX >= 92;

    if (s) lastX = x;

    return s;
  });

  const inRange = (f) => f.t >= a - 0.01 && f.t <= b + 0.01;
  const selectHalf = (next) => {
    setFz(null);
    setZ(1);
    setHalf(next);
    if (next === '1' && hasHalves && sel > firstEnd) onSel(firstEnd);
    if (next === '2' && hasHalves && sel < secondStart) onSel(secondStart);
  };

  return (
    <div className="tlw">
      <div className="r">
        <b>Timeline</b>

        <button
          onClick={() => onSel(Math.max(0, sel - 1))}
          disabled={sel === 0}
        >
          ← Previous
        </button>

        <button
          onClick={() => onSel(Math.min(k.length - 1, sel + 1))}
          disabled={sel >= k.length - 1}
        >
          Next →
        </button>

        <button onClick={onAdd}>+ Keyframe</button>
        <button onClick={onDel}>Delete</button>

        <span className="join-bar">
          <b>Join</b>

          <select
            value={joinTeam}
            onChange={(e) => {
              setJoinTeam(e.target.value);
              setJoinPlayer(0);
            }}
          >
            <option value="A">Home</option>
            <option value="B">Away</option>
          </select>

          <select
            value={joinPlayer}
            onChange={(e) => setJoinPlayer(+e.target.value)}
          >
            {D.teams[joinTeam].players.map((p, i) => (
              <option value={i} key={i}>
                #{p.n || i + 1} {p.name || `Player ${i + 1}`}
              </option>
            ))}
          </select>

          <button className="pri" onClick={() => onJoin(joinTeam, joinPlayer)}>
            + Add to keyframe
          </button>
           <button className="dng" onClick={() => onLeave(joinTeam + joinPlayer)}>− Remove</button>
        </span>

        <label className="hint">
          Time{' '}
          <input
            type="number"
            step="0.1"
            min="0"
            disabled={sel === 0}
            value={cur.t}
            onChange={(e) => onTime(sel, snap(+e.target.value))}
            style={{ width: 74 }}
          />{' '}
          s
        </label>

        <span className="seg2">
          {[
            ['home', 'Home field'],
            ['away', 'Away field'],
            ['full', 'Full']
          ].map(([f, l]) => (
            <button
              key={f}
              className={cur.field === f ? 'pri' : ''}
              onClick={() => onField(f)}
              title="Which field is shown from this keyframe"
            >
              {l}
            </button>
          ))}
        </span>

        <span className="hint">
          Ball: {cur.hold ? `with ${cur.hold}` : 'free'}
        </span>

        {cur.hold && <button onClick={() => onAttach(null)}>Detach ball</button>}
      </div>

      <div className="r">
        <span className="seg2">
          {[
            ['all', 'Whole match'],
            ['1', '1st half'],
            ['2', '2nd half']
          ].map(([h, l]) => (
            <button
              key={h}
              className={half === h ? 'pri' : ''}
              disabled={h !== 'all' && !hasHalves}
              onClick={() => selectHalf(h)}
            >
              {l}
            </button>
          ))}
        </span>

        <span className="hint">Zoom</span>

        <button onClick={() => setZ((v) => cl(v / 1.4, 1, 24))}>−</button>
        <button onClick={() => setZ((v) => cl(v * 1.4, 1, 24))}>+</button>
        <button onClick={() => setZ(1)}>Fit</button>

        <span className="hint">{Math.round(z * 100)}%</span>

        <span className="hint">
          <span className={tot > maxSeconds ? 'length-over' : ''}>
            Length {tot.toFixed(1)} s · {k.length} keyframes
          </span>
          <button className="fit-limit" onClick={onFit} disabled={tot <= maxSeconds}>Fit to {maxSeconds} s</button>
        </span>
      </div>

      <div className="trkw" ref={sc}>
        <div id="trk" ref={inner} style={{ width: W }} onPointerDown={down}>
          {ticks.map((s) => (
            <span key={s}>
              <i className="tkl" style={{ left: X(s) }} />
              <span className="tick" style={{ left: X(s) }}>
                {s}s
              </span>
            </span>
          ))}

          {k.map((f, i) => {
            const n = k[i + 1];

            if (!inRange(f)) return null;

            return (
              <span key={i}>
                {n && inRange(n) && (
                  <>
                    <i
                      className="bar"
                      style={{
                        left: X(f.t),
                        width: (n.t - f.t) * pps
                      }}
                    />

                    {(n.t - f.t) * pps >= 44 && (
                      <span
                        className="seg"
                        style={{ left: X((f.t + n.t) / 2) }}
                      >
                        {(n.t - f.t).toFixed(1)}s
                      </span>
                    )}
                  </>
                )}

                <div
                  data-i={i}
                  className={
                    'mk' +
                    (i === sel && mode === 'kf' ? ' on' : '') +
                    (f.manual?.modified ? ' manual' : ' generated')
                  }
                  style={{ left: X(f.t) }}
                  title={
                    f.manual?.modified
                      ? 'Manually modified'
                      : 'Generated / API keyframe'
                  }
                >
                  {i + 1}
                </div>

                {(f.ev === 'sub' || f.htSubs) && (
                  <span className="evmark sub" style={{ left: X(f.t) }}>
                    SUB
                  </span>
                )}

                {(f.ev === 'card' ||
                  f.comment?.type === 'yellow' ||
                  f.comment?.type === 'red') && (
                  <span
                    className={`evmark ${
                      f.comment?.type === 'red' ? 'red' : 'yellow'
                    }`}
                    style={{ left: X(f.t) }}
                  >
                    {f.comment?.type === 'red' ? 'RED' : 'YC'}
                  </span>
                )}

                {showLabel[i] && (
                  <span className="mt" style={{ left: X(f.t) }}>
                    {f.t.toFixed(1)}s · {f.field[0].toUpperCase()}{' '}
                    <b style={{ color: '#00e5ff' }}>{joins(f)}</b>
                  </span>
                )}
              </span>
            );
          })}

          <i
            className="bar t"
            style={{ left: X(k.at(-1).t), width: 1.2 * pps }}
          />

          {k
            .filter((f) => f.comment?.type === 'goal' && inRange(f))
            .map((f) => (
              <div key={'g' + f.id} className="gl" style={{ left: X(f.t) }}>
                ⚽
              </div>
            ))}

          {((half === '2' ? secondStart : firstEnd) > 0) && inRange(k[half === '2' ? secondStart : firstEnd]) && (
            <div className="htl" style={{ left: X(k[half === '2' ? secondStart : firstEnd].t) }}>
              <span>{half === '2' ? '2H' : 'HT'}</span>
            </div>
          )}

          <i ref={phEl} className="ph" />
        </div>
      </div>

      <p className="hint" style={{ textAlign: 'center' }}>
        Drag a numbered marker to change its time, click empty space to scrub,
        Ctrl + mouse wheel (or the + and − buttons) to zoom. H/A/F under a marker
        = Home, Away or Full field. ⚽ = goal, +A9 / -B4 = player joins / leaves.
      </p>
    </div>
  );
}