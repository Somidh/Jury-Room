// How a trial ends: the verdict, your influence, and, only if you ask, what really
// happened. The first two judge the deliberation by the evidence. The third judges nothing.
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { FACES } from './faces';
import { Portrait } from './Portrait';
import type { Juror } from './Stage';
import type { Debrief, Vote } from './trial';

type Truth = { beats: string[]; closing: string };
type Beat = 'verdict' | 'influence' | 'threshold' | 'reveal' | 'left';

const VERDICT_WORDS: Record<string, string> = { guilty: 'Guilty', not_guilty: 'Not guilty', hung: 'Hung jury' };
const VOTE_WORDS: Record<Vote, string> = { guilty: 'guilty', not_guilty: 'not guilty', undecided: 'undecided' };

/** Long enough to read, then a breath. */
const readingTime = (text: string) => 2200 + text.length * 42;

const startAnother = () => void fetch('/api/trial', { method: 'POST' });

function Verdict({ verdict, debrief, onNext }: { verdict: string; debrief: Debrief | null; onNext: () => void }) {
  const unanimous = verdict === 'guilty' || verdict === 'not_guilty';
  const fade = (delay: number) => ({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { delay, duration: 1 } });

  return (
    <section className="beat verdict-beat">
      <motion.p {...fade(1.4)}>{unanimous ? 'We, the jury, find the defendant' : 'Twelve people could not agree.'}</motion.p>
      <motion.h1
        className={verdict}
        initial={{ opacity: 0, scale: 1.25 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 2.8, duration: 0.5, ease: 'easeOut' }}
      >
        {VERDICT_WORDS[verdict] ?? verdict}
      </motion.h1>
      {debrief && (
        <motion.div className="reading" {...fade(4.2)}>
          <p className="count">
            {debrief.tally.guilty} guilty, {debrief.tally.notGuilty} not guilty{debrief.tally.undecided ? `, ${debrief.tally.undecided} undecided` : ''}
          </p>
          <h2>{debrief.evidence.headline}</h2>
          <p>{debrief.evidence.reason}</p>
          <p>The room raised {debrief.evidence.raised} of the {debrief.evidence.total} points in the evidence.</p>
          {debrief.evidence.unraised.length > 0 && (
            <>
              <p className="aside">Nobody mentioned:</p>
              <ul>
                {debrief.evidence.unraised.map((claim) => <li key={claim}>{claim}</li>)}
              </ul>
            </>
          )}
          <button className="primary" onClick={onNext}>See your influence</button>
        </motion.div>
      )}
    </section>
  );
}

function swayLine(count: number, total: number): string {
  if (count === 0) return 'The room moved without you.';
  return `You swayed ${count} of ${total} jurors.`;
}

function Influence({ debrief, jurors, onNext }: { debrief: Debrief; jurors: Juror[]; onNext: () => void }) {
  const { influence, deliberation, room } = debrief;
  const swayedIds = new Set(influence.swayed.map((sway) => sway.juror));
  const shakenIds = new Set(influence.shaken.map((item) => item.juror));
  const others = influence.movedByOthers;

  return (
    <motion.section className="beat influence-beat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>
      <h2 className="beat-title">Your influence</h2>
      <p className="headline">{swayLine(influence.swayed.length, jurors.length)}</p>

      <ul className="faces" aria-label="The jurors you swayed">
        {jurors.map((juror, index) => (
          <motion.li
            key={juror.id}
            className={swayedIds.has(juror.id) ? 'swayed' : shakenIds.has(juror.id) ? 'shaken' : undefined}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 + index * 0.09 }}
          >
            <Portrait face={FACES[juror.id]!} yaw={0} light={1} slow={false} delay={0} frozen staring />
            <span>{juror.name.split(' ')[0]}</span>
          </motion.li>
        ))}
      </ul>

      {influence.swayed.map((sway) => (
        <figure key={sway.juror} className="sway">
          <figcaption>{sway.name}, from {VOTE_WORDS[sway.from]} to {VOTE_WORDS[sway.to]}</figcaption>
          {sway.quote && <blockquote>{sway.quote}</blockquote>}
        </figure>
      ))}

      {influence.shaken.length > 0 && (
        <p>You shook {influence.shaken.map((item) => item.name).join(', ')}, but their vote held.</p>
      )}
      {others.length > 0 && (
        <p>Moved without you: {others.map((item) => `${item.name}, by ${item.by}`).join('; ')}.</p>
      )}

      <h3>Your strongest argument</h3>
      {influence.strongest ? (
        <figure className="sway">
          <blockquote>{influence.strongest.text}</blockquote>
          <figcaption>It moved {influence.strongest.jurorsMoved} {influence.strongest.jurorsMoved === 1 ? 'juror' : 'jurors'}.</figcaption>
        </figure>
      ) : (
        <p>{influence.arguments ? 'Nothing you said moved anyone.' : 'You never made an argument.'}</p>
      )}
      {influence.unsupported > 0 && (
        <p>{influence.unsupported === 1 ? 'One thing you said was' : `${influence.unsupported} things you said were`} not in the record, and it counted for nothing.</p>
      )}

      <h3>How the room argued</h3>
      <p>{deliberation.headline}</p>
      <dl className="basis">
        <div><dt>Evidence</dt><dd>{deliberation.evidence}</dd></div>
        <div><dt>Emotion</dt><dd>{deliberation.emotion}</dd></div>
        <div><dt>Pressure</dt><dd>{deliberation.pressure}</dd></div>
        <div><dt>Bias</dt><dd>{deliberation.bias}</dd></div>
      </dl>
      {room.emotional.length > 0 && (
        <>
          <p className="aside">Said from emotion:</p>
          {room.emotional.map((item) => <blockquote key={item.text}>{item.name}: {item.text}</blockquote>)}
        </>
      )}
      {room.biased.length > 0 && (
        <>
          <p className="aside">Said from bias:</p>
          {room.biased.map((item) => <blockquote key={item.text}>{item.name}: {item.text}</blockquote>)}
        </>
      )}

      <button className="primary" onClick={onNext}>Continue</button>
    </motion.section>
  );
}

function Threshold({ onReveal, onLeave }: { onReveal: () => void; onLeave: () => void }) {
  return (
    <motion.section className="beat threshold-beat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.6 }}>
      <p>The jury has gone home. Nothing below changes anything you did in that room.</p>
      <p>Most jurors never find out.</p>
      <div className="actions">
        <button className="primary" onClick={onReveal}>What actually happened that night</button>
        <button onClick={onLeave}>Leave it there</button>
      </div>
    </motion.section>
  );
}

function Reveal() {
  const [truth, setTruth] = useState<Truth | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(0);
  const [closing, setClosing] = useState(false);
  const latest = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/truth')
      .then((response) => (response.ok ? (response.json() as Promise<Truth>) : Promise.reject(new Error())))
      .then(setTruth)
      .catch(() => setFailed(true));
  }, []);

  const lines = truth ? truth.beats : [];
  const finished = truth !== null && shown >= lines.length;

  useEffect(() => {
    if (!truth || finished) return;
    const timer = setTimeout(() => setShown((count) => count + 1), shown === 0 ? 1800 : readingTime(lines[shown - 1]!));
    return () => clearTimeout(timer);
  }, [truth, shown, finished, lines]);

  useEffect(() => {
    if (!finished) return;
    const timer = setTimeout(() => setClosing(true), readingTime(lines.at(-1) ?? ''));
    return () => clearTimeout(timer);
  }, [finished, lines]);

  // Follows the story down a short screen, and returns to the top for the closing line.
  useEffect(() => {
    const scroller = latest.current?.closest('.ending') ?? document.querySelector('.ending');
    scroller?.scrollTo({ top: closing ? 0 : scroller.scrollHeight, behavior: closing ? 'auto' : 'smooth' });
  }, [shown, closing]);

  if (failed) return <section className="beat reveal-beat"><p>The record of that night could not be opened. Check that the server is still running.</p></section>;

  return (
    <AnimatePresence mode="wait">
      {closing && truth ? (
        // The story clears and the last line stands alone.
        <motion.section key="closing" className="beat closing-beat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9, duration: 2.6 }}>
          <p className="closing">{truth.closing}</p>
          <motion.button className="primary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 5 }} onClick={startAnother}>
            Start another trial
          </motion.button>
        </motion.section>
      ) : (
        <motion.section
          key="story"
          className="beat reveal-beat"
          exit={{ opacity: 0 }}
          transition={{ duration: 1.8 }}
          onClick={() => (finished ? setClosing(true) : setShown((count) => count + 1))}
        >
          {lines.slice(0, shown).map((line, index) => (
            <motion.p
              key={line}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: index === shown - 1 ? 1 : 0.42, y: 0 }}
              transition={{ duration: 1.3 }}
            >
              {line}
            </motion.p>
          ))}
          <div ref={latest} />
        </motion.section>
      )}
    </AnimatePresence>
  );
}

export function Ending({ verdict, debrief, jurors }: { verdict: string; debrief: Debrief | null; jurors: Juror[] }) {
  const [beat, setBeat] = useState<Beat>('verdict');

  return (
    <motion.div className="ending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 2 }}>
      <AnimatePresence mode="wait">
        <motion.div key={beat} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
          {beat === 'verdict' && <Verdict verdict={verdict} debrief={debrief} onNext={() => setBeat('influence')} />}
          {beat === 'influence' && debrief && <Influence debrief={debrief} jurors={jurors} onNext={() => setBeat('threshold')} />}
          {beat === 'threshold' && <Threshold onReveal={() => setBeat('reveal')} onLeave={() => setBeat('left')} />}
          {beat === 'reveal' && <Reveal />}
          {beat === 'left' && (
            <section className="beat threshold-beat">
              <p>Then that is where it stays.</p>
              <button className="primary" onClick={startAnother}>Start another trial</button>
            </section>
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
