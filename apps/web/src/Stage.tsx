// The room, seen from seat 12 at the foot of the table.
import { animate, AnimatePresence, motion, useMotionValue, useTransform } from 'motion/react';
import { useEffect, useRef, type CSSProperties } from 'react';
import { FACES } from './faces';
import { Portrait } from './Portrait';
import { playFlip } from './audio';
import type { TrialView, Vote } from './trial';

export type Juror = { id: number; name: string };

type Place = { x: number; y: number; depth: number; side: -1 | 0 | 1 };

function sidePlace(side: -1 | 1, depth: number): Place {
  const offset = 13 + depth * 27;
  return { x: 50 + side * offset, y: 27 + depth ** 1.25 * 34, depth, side };
}

/** The foreman takes the head of the table. The two who will fight sit closest to you. */
export const PLACES: Record<number, Place> = {
  1: { x: 50, y: 21, depth: 0, side: 0 },
  5: sidePlace(-1, 0.1),
  2: sidePlace(-1, 0.32),
  7: sidePlace(-1, 0.55),
  4: sidePlace(-1, 0.78),
  3: sidePlace(-1, 1),
  9: sidePlace(1, 0.1),
  6: sidePlace(1, 0.32),
  11: sidePlace(1, 0.55),
  10: sidePlace(1, 0.78),
  8: sidePlace(1, 1),
};

const scaleAt = (depth: number) => 0.56 + depth ** 1.35 * 0.86;
const VOTE_WORDS: Record<Vote, string> = { guilty: 'Guilty', not_guilty: 'Not guilty', undecided: 'Undecided' };
const VOTE_MARKS: Record<Vote, string> = { guilty: 'G', not_guilty: 'NG', undecided: '?' };

export function VoteChip({ vote, live, label }: { vote: Vote | undefined; live: boolean; label: string }) {
  const previous = useRef(vote);
  useEffect(() => {
    if (live && vote && previous.current !== vote) playFlip();
    previous.current = vote;
  }, [vote, live]);

  return (
    <span className="chip-holder">
      <motion.span
        key={vote ?? 'none'}
        className={`chip ${vote ?? 'none'}`}
        role="img"
        aria-label={`${label}: ${vote ? VOTE_WORDS[vote] : 'no vote yet'}`}
        initial={live && vote ? { rotateY: 180, scale: 1.5 } : false}
        animate={{ rotateY: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 210, damping: 13 }}
      >
        {vote ? VOTE_MARKS[vote] : ''}
      </motion.span>
    </span>
  );
}

function yawFor(place: Place, view: TrialView, id: number): number {
  if (view.held) return 0;
  const inward = -place.side * 0.72;
  // A passing opening: heads lift, then the talk moves on. Only the foreman looks right at you.
  if (view.prompt) return id === 1 ? 0 : inward * 0.5;
  // The nearest jurors catch your hand going up while the speaker is still finishing.
  if (view.handUp && view.speaker !== id && place.depth >= 0.55) return inward * 0.25;
  if (view.speaker === id) {
    if (view.facing === 12) return 0;
    const target = view.facing ? PLACES[view.facing] : undefined;
    return target ? Math.max(-0.85, Math.min(0.85, (target.x - place.x) / 34)) : inward;
  }
  const speaker = view.speaker ? PLACES[view.speaker] : undefined;
  if (speaker) return Math.max(-0.85, Math.min(0.85, (speaker.x - place.x) / 34));
  return inward;
}

function Seat({ juror, view, onPick, target, order }: {
  juror: Juror;
  view: TrialView;
  onPick: (id: number) => void;
  target: boolean;
  order: number;
}) {
  const place = PLACES[juror.id]!;
  const speaking = view.speaker === juror.id;
  const frozen = view.phase !== 'deliberating';
  const someoneSpeaking = view.speaker !== null;
  const scale = scaleAt(place.depth);
  const brightness = frozen ? 0.3 : speaking ? 1.08 : view.held ? 0.92 : view.prompt ? 0.76 : someoneSpeaking ? 0.32 : 0.7;

  return (
    <motion.div
      className="seat"
      style={{ left: `${place.x}%`, top: `${place.y}%`, '--scale': scale, zIndex: speaking ? 13 : Math.round(place.depth * 10) + 2 } as CSSProperties}
      initial={false}
      animate={{
        filter: `brightness(${brightness}) saturate(${speaking ? 1.08 : 0.82})`,
        scale: speaking ? 1.1 : 1,
        y: speaking ? '6%' : '0%',
        x: juror.id === view.shifting ? ['-50%', '-46%', '-53%', '-50%'] : '-50%',
      }}
      transition={{
        filter: { duration: 0.45 - view.heat * 0.2 },
        scale: { type: 'spring', stiffness: 170, damping: 17 },
        y: { type: 'spring', stiffness: 170, damping: 17 },
        x: { duration: 0.6 },
      }}
    >
      <div className={`seat-face${target ? ' targeted' : ''}`}>
        <Portrait
          face={FACES[juror.id]!}
          yaw={yawFor(place, view, juror.id)}
          light={place.side === 0 ? 1 : -place.side as number}
          slow={view.held}
          delay={order * 0.17}
          frozen={frozen || view.paused}
          staring={view.held}
        />
      </div>
      {/* Only the head is a target. The portraits overlap, so the whole picture can't be. */}
      <button
        className="seat-hit"
        onClick={() => onPick(juror.id)}
        disabled={view.prompt !== 'speak'}
        aria-label={`Speak to ${juror.name}`}
      />
    </motion.div>
  );
}

/** The left edge of the table, as a percentage across, at a height down the screen. */
const tableEdge = (y: number) => 40.9 - ((y - 33.3) / 66.7) * 28.1;

/** Each juror's vote lies on the table in front of them, where everyone can read it. */
function Placard({ juror, view }: { juror: Juror; view: TrialView }) {
  const place = PLACES[juror.id]!;
  const y = place.side === 0 ? 35.5 : place.y + 4.5 + place.depth * 4;
  const x = place.side === 0 ? 50 : 50 + place.side * (50 - tableEdge(y) - 2.4 - place.depth * 2.2);
  const lit = view.speaker === null || view.speaker === juror.id;
  return (
    <motion.span
      className="placard"
      style={{ left: `${x}%`, top: `${y}%`, '--scale': 0.72 + place.depth * 0.62 } as CSSProperties}
      initial={false}
      animate={{ opacity: view.phase !== 'deliberating' ? 0.25 : lit ? 1 : 0.62 }}
      transition={{ duration: 0.3 }}
    >
      <VoteChip vote={view.votes[juror.id]} live={view.live} label={juror.name} />
      <span className="place-name">{juror.name.split(' ')[0]}</span>
    </motion.span>
  );
}

function Room() {
  return (
    <svg className="room-art" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="wall" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#1d140e" />
          <stop offset="0.5" stopColor="#3a2617" />
          <stop offset="1" stopColor="#1a100a" />
        </linearGradient>
        <linearGradient id="left-wall" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#090604" />
          <stop offset="1" stopColor="#2c1c12" />
        </linearGradient>
        <linearGradient id="right-wall" x1="1" x2="0" y1="0" y2="0">
          <stop offset="0" stopColor="#090604" />
          <stop offset="1" stopColor="#2c1c12" />
        </linearGradient>
        <linearGradient id="wood" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#6c4526" />
          <stop offset="0.4" stopColor="#4a2d18" />
          <stop offset="1" stopColor="#1e120a" />
        </linearGradient>
      </defs>
      <rect width="1600" height="900" fill="#0d0805" />
      <polygon points="0,0 500,0 500,330 0,900" fill="url(#left-wall)" />
      <polygon points="1600,0 1100,0 1100,330 1600,900" fill="url(#right-wall)" />
      <rect x="500" y="0" width="600" height="330" fill="url(#wall)" />
      {[560, 640, 720, 880, 960, 1040].map((x) => (
        <line key={x} x1={x} x2={x} y1="0" y2="330" stroke="#120b07" strokeWidth="3" />
      ))}
      {[0, 1, 2, 3, 4].map((step) => (
        <line key={step} x1={500 - step * 100} y1="0" x2={500 - step * 100} y2={330 + step * 114} stroke="#080503" strokeWidth={3 + step} />
      ))}
      {[0, 1, 2, 3, 4].map((step) => (
        <line key={step} x1={1100 + step * 100} y1="0" x2={1100 + step * 100} y2={330 + step * 114} stroke="#080503" strokeWidth={3 + step} />
      ))}
      {/* The clock Nico keeps checking. */}
      <g transform="translate(1000 92)">
        <circle r="40" fill="#cdbf9f" opacity="0.55" />
        <circle r="40" fill="none" stroke="#0e0906" strokeWidth="6" />
        <line x2="0" y2="-24" stroke="#0e0906" strokeWidth="4" />
        <line x2="17" y2="11" stroke="#0e0906" strokeWidth="4" />
      </g>
      {/* A shut door, with no way out of it until this is done. */}
      <rect x="548" y="96" width="112" height="240" fill="#1a100a" stroke="#0a0604" strokeWidth="5" />
      <rect x="566" y="116" width="76" height="58" fill="#3a2d20" opacity="0.5" />
      <circle cx="646" cy="228" r="6" fill="#8a6a3a" />
    </svg>
  );
}

function Table() {
  return (
    <svg className="table-art" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="table-wood" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#7a4e2a" />
          <stop offset="0.45" stopColor="#50301a" />
          <stop offset="1" stopColor="#1f120a" />
        </linearGradient>
      </defs>
      <polygon points="655,300 945,300 1395,900 205,900" fill="url(#table-wood)" />
      {[-0.7, -0.42, -0.14, 0.14, 0.42, 0.7].map((at) => (
        <line key={at} x1={800 + at * 145} y1="300" x2={800 + at * 595} y2="900" stroke="#1d110a" strokeWidth="2" opacity="0.5" />
      ))}
      <polygon points="655,300 945,300 948,308 652,308" fill="#a6743f" opacity="0.5" />
      {/* Each juror's papers and glass, shrinking down the table. */}
      {[
        [742, 372, 0.34], [858, 372, 0.34], [666, 468, 0.6], [934, 468, 0.6], [578, 594, 0.92], [1022, 594, 0.92],
      ].map(([x, y, s]) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y}) scale(${s})`}>
          <polygon points="-54,-34 46,-40 64,34 -44,42" fill="#c9bc9e" opacity="0.42" />
          <ellipse cx="90" cy="-14" rx="18" ry="9" fill="#d9cdb4" opacity="0.2" />
        </g>
      ))}
    </svg>
  );
}

/** Your seat, at the foot of the table. It lights up when your hand goes up. */
function YourSeat({ view }: { view: TrialView }) {
  const up = view.handUp || view.held;
  return (
    <>
      <motion.div
        className="your-light"
        initial={false}
        animate={{ opacity: up ? 1 : 0 }}
        transition={{ duration: view.handUp ? 0.35 : 1.2 }}
      />
      <AnimatePresence>
        {view.handUp && (
          <motion.svg
            key="hand"
            className="your-hand"
            viewBox="0 0 200 420"
            aria-hidden="true"
            initial={{ y: '100%', rotate: 7 }}
            animate={{ y: '0%', rotate: 0 }}
            exit={{ y: '100%', transition: { duration: 0.7, ease: 'easeIn' } }}
            transition={{ type: 'spring', stiffness: 120, damping: 15 }}
          >
            <defs>
              <linearGradient id="hand-skin" x1="0" x2="1" y1="0" y2="0.3">
                <stop offset="0" stopColor="#ffc877" />
                <stop offset="0.4" stopColor="#a56d43" />
                <stop offset="1" stopColor="#25130a" />
              </linearGradient>
              <linearGradient id="hand-sleeve" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="#57402b" />
                <stop offset="1" stopColor="#0c0704" />
              </linearGradient>
            </defs>
            <path d="M 60 420 L 66 262 L 138 262 L 146 420 Z" fill="url(#hand-sleeve)" />
            <path d="M 70 270 C 62 226, 42 204, 38 172 C 36 158, 52 152, 62 170 L 74 192 L 66 72 C 65 54, 87 52, 90 72 L 96 150 L 100 48 C 101 28, 124 28, 124 50 L 122 150 L 136 66 C 139 46, 162 50, 159 72 L 146 158 L 170 96 C 176 80, 194 88, 189 106 C 172 164, 164 206, 138 270 Z" fill="url(#hand-skin)" />
          </motion.svg>
        )}
      </AnimatePresence>
    </>
  );
}

/** One lamp, and the only thing in the room that flickers. */
function Lamp({ view }: { view: TrialView }) {
  const level = useMotionValue(1);
  const glow = useTransform(level, (value) => value);
  const heat = useRef(view.heat);
  heat.current = view.heat;

  useEffect(() => {
    if (view.phase !== 'deliberating' || view.paused) return;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      const wait = 9000 - heat.current * 7600 + Math.random() * 3000;
      timer = setTimeout(() => {
        if (heat.current > 0.25 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          void animate(level, [1, 0.5, 0.95, 0.35, 1], { duration: 0.34, ease: 'linear' });
        }
        next();
      }, wait);
    };
    next();
    return () => clearTimeout(timer);
  }, [level, view.phase, view.paused]);

  return (
    <>
      <svg className="lamp-art" viewBox="0 0 400 200" aria-hidden="true">
        <line x1="200" y1="0" x2="200" y2="66" stroke="#080503" strokeWidth="5" />
        <path d="M 112 150 Q 134 74 182 64 L 218 64 Q 266 74 288 150 Z" fill="#0f0a07" />
        <path d="M 112 150 Q 200 136 288 150 Q 200 170 112 150 Z" fill="#f2b75a" />
      </svg>
      <motion.div className="light-pool" style={{ opacity: glow }} />
    </>
  );
}

export function Stage({ view, jurors, target, onPick }: {
  view: TrialView;
  jurors: Juror[];
  target: number | null;
  onPick: (id: number) => void;
}) {
  const waiting = view.held;
  const hot = view.heat > 0.4;
  const seated = [...jurors].sort((a, b) => PLACES[a.id]!.depth - PLACES[b.id]!.depth);

  return (
    <div className={`stage${view.phase === 'briefing' ? ' frozen' : ''}`}>
      <motion.div
        className="set"
        initial={false}
        animate={{ scale: waiting ? 1.05 : 1, y: waiting ? '-2%' : '0%' }}
        transition={{ duration: waiting ? 7 : 1.4 - view.heat * 0.7, ease: 'easeOut' }}
      >
        <Room />
        {seated.map((juror, order) => (
          <Seat key={juror.id} juror={juror} view={view} onPick={onPick} target={target === juror.id} order={order} />
        ))}
        <Table />
        <Lamp view={view} />
        <YourSeat view={view} />
        {seated.map((juror) => <Placard key={juror.id} juror={juror} view={view} />)}
      </motion.div>

      <motion.div
        className="dimmer"
        initial={false}
        animate={{ opacity: view.phase === 'briefing' ? 0.5 : waiting ? 0.26 : 0 }}
        transition={{ duration: waiting ? 2.4 : 0.5 }}
      />
      <motion.div
        className="tension"
        initial={false}
        animate={{ opacity: hot ? view.heat * 0.85 : 0 }}
        transition={{ duration: 0.8 }}
      />
      <div className="vignette" />
    </div>
  );
}
