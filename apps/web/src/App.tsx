import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { setHeartbeat, setMuted, startAudio } from './audio';
import { Stage, VoteChip, type Juror } from './Stage';
import { seatOf, typingSpeed, type CaseBrief, type Line, type TrialView } from './trial';
import { useTrial } from './useTrial';

const BEGIN_TEXT = "I've read the case. Begin the deliberation.";
const MAX_MESSAGE = 1000;

async function say(text: string): Promise<string | null> {
  const response = await fetch('/api/say', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (response.ok) return null;
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? 'Your message did not reach the room. Check that Mattermost is running.';
}

const nameOf = (speaker: string, jurors: Juror[]) =>
  speaker === 'human' ? 'You' : (jurors.find((juror) => juror.id === seatOf(speaker))?.name ?? '');

function CaseFile({ brief }: { brief: CaseBrief }) {
  return (
    <>
      <p className="stamp" aria-hidden="true">Jury copy</p>
      <h1>{brief.title}</h1>
      <p className="charge">{brief.charge}</p>
      <p>{brief.summary}</p>
      <h2>Evidence</h2>
      <dl>
        {brief.evidence.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.detail}</dd>
          </div>
        ))}
      </dl>
      <h2>Witnesses</h2>
      <dl>
        {brief.witnesses.map((item) => (
          <div key={item.name}>
            <dt>{item.name}, {item.role}</dt>
            <dd>{item.statement}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function Briefing({ brief }: { brief: CaseBrief }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    startAudio();
    setSending(true);
    const problem = await say(BEGIN_TEXT);
    if (problem) {
      setError(problem);
      setSending(false);
    }
  }

  return (
    <motion.main className="briefing" exit={{ opacity: 0, y: 60 }} transition={{ duration: 0.9, ease: 'easeIn' }}>
      <article className="file">
        <CaseFile brief={brief} />
      </article>
      <footer className="briefing-end">
        <p>Eleven strangers are waiting. Nobody says a word until you are ready.</p>
        {error && <p role="alert" className="error">{error}</p>}
        <button className="primary" onClick={() => void begin()} disabled={sending}>{BEGIN_TEXT}</button>
      </footer>
    </motion.main>
  );
}

function Tally({ view }: { view: TrialView }) {
  const votes = [...Object.values(view.votes), ...(view.myVote === 'undecided' ? [] : [view.myVote])];
  const guilty = votes.filter((vote) => vote === 'guilty').length;
  const notGuilty = votes.filter((vote) => vote === 'not_guilty').length;
  const undecided = 12 - guilty - notGuilty;
  const spring = { type: 'spring', stiffness: 60, damping: 11 } as const;
  const beat = 1.5 - view.heat * 0.85 - (Math.abs(guilty - notGuilty) < 3 && votes.length ? 0.2 : 0);

  return (
    <header className="tally" aria-label={`Guilty ${guilty}, not guilty ${notGuilty}, undecided ${undecided}`}>
      <span className="tally-side guilty-side"><b>{guilty}</b> Guilty</span>
      <motion.div
        className="tally-bar"
        animate={view.phase === 'deliberating' ? { scaleY: [1, 1.5, 1.05, 1.32, 1] } : { scaleY: 1 }}
        transition={view.phase === 'deliberating' ? { duration: beat, repeat: Infinity, repeatDelay: beat * 0.35, times: [0, 0.12, 0.26, 0.38, 0.6] } : undefined}
      >
        <motion.span className="fill guilty-fill" initial={false} animate={{ width: `${(guilty / 12) * 100}%` }} transition={spring} />
        <motion.span className="fill not-guilty-fill" initial={false} animate={{ width: `${(notGuilty / 12) * 100}%` }} transition={spring} />
      </motion.div>
      <span className="tally-side not-guilty-side">Not guilty <b>{notGuilty}</b></span>
    </header>
  );
}

/** A line of the screenplay, typed out as it's said. */
function Caption({ line, jurors, heat, raised }: { line: Line; jurors: Juror[]; heat: number; raised: boolean }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    setShown(0);
    const timer = setInterval(() => {
      setShown((count) => {
        if (count >= line.text.length) clearInterval(timer);
        return count + 1;
      });
    }, typingSpeed(heat));
    return () => clearInterval(timer);
    // Heat changes with the line, so the pace is set once when the line starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.id]);

  const name = nameOf(line.speaker, jurors);
  return (
    <motion.figure
      className={`caption${raised ? ' raised' : ''}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 - heat * 0.1 }}
      layout="position"
    >
      <figcaption>{name.toUpperCase()}</figcaption>
      {line.mood && <p className="parenthetical">({line.mood.toLowerCase()})</p>}
      <p className="dialogue" aria-label={line.text}>
        {line.text.slice(0, shown)}
        <span className="unsaid" aria-hidden="true">{line.text.slice(shown)}</span>
      </p>
    </motion.figure>
  );
}

type SpeechResult = { results: { 0: { transcript: string } }[] & { length: number } };
type Recogniser = {
  continuous: boolean;
  interimResults: boolean;
  onresult: (event: SpeechResult) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

function Dock({ view, jurors, target, setTarget }: {
  view: TrialView;
  jurors: Juror[];
  target: number | null;
  setTarget: (id: number | null) => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const recogniser = useRef<Recogniser | null>(null);
  const Speech = (window as unknown as { webkitSpeechRecognition?: new () => Recogniser }).webkitSpeechRecognition;

  useEffect(() => {
    if (view.prompt === 'speak') input.current?.focus();
    setSending(false);
    setError(null);
  }, [view.prompt]);

  async function send(message: string, afterwards?: () => void) {
    setSending(true);
    setError(null);
    const problem = await say(message);
    if (problem) {
      setError(problem);
      setSending(false);
    } else {
      afterwards?.();
    }
  }

  function argue(event: FormEvent) {
    event.preventDefault();
    const message = text.trim();
    if (!message) return;
    const name = jurors.find((juror) => juror.id === target)?.name.split(' ')[0];
    const addressed = name && !message.toLowerCase().includes(name.toLowerCase()) ? `${name}, ${message}` : message;
    void send(addressed, () => {
      setText('');
      setTarget(null);
    });
  }

  function toggleListening() {
    if (listening) return recogniser.current?.stop();
    if (!Speech) return;
    const speech = new Speech();
    speech.continuous = true;
    speech.interimResults = false;
    const before = text;
    speech.onresult = (event) => {
      const heard = Array.from({ length: event.results.length }, (_, index) => event.results[index]![0].transcript).join(' ');
      setText(`${before} ${heard}`.trim());
    };
    speech.onend = () => setListening(false);
    recogniser.current = speech;
    setListening(true);
    speech.start();
  }

  if (view.prompt === 'vote') {
    return (
      <motion.div className="dock waiting" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }}>
        <h2>How do you vote?</h2>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="actions">
          <button className="vote-guilty" disabled={sending} onClick={() => void send('I vote guilty')}>Guilty</button>
          <button className="vote-not-guilty" disabled={sending} onClick={() => void send('I vote not guilty')}>Not guilty</button>
          <button disabled={sending} onClick={() => void send('pass')}>{view.myVote === 'undecided' ? "I can't say yet" : 'Keep my vote'}</button>
        </div>
      </motion.div>
    );
  }

  if (view.prompt === 'speak') {
    const targetName = jurors.find((juror) => juror.id === target)?.name.split(' ')[0];
    return (
      <motion.form className="dock waiting" onSubmit={argue} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }} transition={{ delay: 0.5, duration: 0.7 }}>
        <div className="dock-head">
          <h2>Speak now or pass</h2>
          <div className="address" role="group" aria-label="Who you are speaking to">
            <button type="button" aria-pressed={target === null} onClick={() => setTarget(null)}>Everyone</button>
            {jurors.map((juror) => (
              <button key={juror.id} type="button" aria-pressed={target === juror.id} onClick={() => setTarget(juror.id)}>
                {juror.name.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="dock-input">
          <textarea
            ref={input}
            rows={2}
            value={text}
            maxLength={MAX_MESSAGE}
            aria-label="Your argument"
            placeholder={targetName ? `Say it to ${targetName}.` : 'They are all looking at you.'}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) argue(event);
            }}
          />
          {Speech && (
            <button type="button" className={listening ? 'mic listening' : 'mic'} aria-pressed={listening} onClick={toggleListening}>
              {listening ? 'Stop' : 'Speak'}
            </button>
          )}
        </div>
        <div className="actions">
          <button type="submit" className="primary" disabled={sending || !text.trim()}>Make argument</button>
          <button type="button" disabled={sending} onClick={() => void send('pass')}>Pass</button>
          <button type="button" className="quiet" disabled={sending} onClick={() => void send('call a vote')}>Call a vote</button>
        </div>
      </motion.form>
    );
  }

  return null;
}

function Verdict({ view }: { view: TrialView }) {
  const unanimous = view.verdict === 'guilty' || view.verdict === 'not_guilty';
  return (
    <motion.section className="verdict" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 2.2 }}>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6, duration: 1 }}>
        {unanimous ? 'We, the jury, find the defendant' : 'Eleven strangers and you could not agree.'}
      </motion.p>
      <motion.h1
        className={view.verdict ?? ''}
        initial={{ opacity: 0, scale: 1.25 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 3.1, duration: 0.5, ease: 'easeOut' }}
      >
        {view.verdict === 'guilty' ? 'Guilty' : view.verdict === 'not_guilty' ? 'Not guilty' : 'Hung jury'}
      </motion.h1>
      <motion.button
        className="primary"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 4.6 }}
        onClick={() => void fetch('/api/trial', { method: 'POST' })}
      >
        Start another trial
      </motion.button>
    </motion.section>
  );
}

function Transcript({ view, jurors, onClose }: { view: TrialView; jurors: Juror[]; onClose: () => void }) {
  const end = useRef<HTMLLIElement>(null);
  // Braces matter: scrollIntoView can return a promise, and React would call it as a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [view.lines.length]);

  return (
    <motion.aside className="sheet transcript" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
      <button className="sheet-close" onClick={onClose}>Close</button>
      <h2>Transcript</h2>
      <ol aria-live="polite">
        {view.lines.map((line) =>
          line.speaker === 'stage' ? (
            <li key={line.id} className="stage-note">{line.text}</li>
          ) : line.ballot ? (
            <li key={line.id} className="ballot-note"><b>{nameOf(line.speaker, jurors)}</b> {line.text}</li>
          ) : (
            <li key={line.id}>
              <b>{nameOf(line.speaker, jurors).toUpperCase()}</b>
              {line.text}
            </li>
          ),
        )}
        <li ref={end} aria-hidden="true" />
      </ol>
    </motion.aside>
  );
}

function Room({ view, jurors, target, setTarget }: {
  view: TrialView;
  jurors: Juror[];
  target: number | null;
  setTarget: (id: number | null) => void;
}) {
  const [panel, setPanel] = useState<'case' | 'transcript' | null>(null);
  const [mute, setMute] = useState(false);
  const speaker = jurors.find((juror) => juror.id === view.speaker);

  useEffect(() => {
    setHeartbeat(view.prompt !== null && view.live && !mute);
    return () => setHeartbeat(false);
  }, [view.prompt, view.live, mute]);

  return (
    <>
      <Tally view={view} />
      <div className="room-tools">
        <span className="my-vote"><VoteChip vote={view.myVote === 'undecided' ? undefined : view.myVote} live={view.live} label="Your vote" /> You</span>
        <button onClick={() => setPanel(panel === 'case' ? null : 'case')}>Case file</button>
        <button onClick={() => setPanel(panel === 'transcript' ? null : 'transcript')}>Transcript</button>
        <button
          aria-pressed={mute}
          onClick={() => {
            startAudio();
            setMuted(!mute);
            setMute(!mute);
          }}
        >
          {mute ? 'Sound off' : 'Sound on'}
        </button>
      </div>

      <div className={`foreground${panel ? ` beside-${panel}` : ''}`}>
        <AnimatePresence mode="popLayout">
          {view.caption && (
            <Caption key={view.caption.id} line={view.caption} jurors={jurors} heat={view.heat} raised={view.prompt !== null} />
          )}
          {!view.caption && !view.prompt && speaker && (
            <motion.p key="floor" className="floor-note" initial={{ opacity: 0 }} animate={{ opacity: 0.75 }} exit={{ opacity: 0 }}>
              {speaker.name.split(' ')[0]} leans in.
            </motion.p>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {view.prompt && <Dock key={view.prompt} view={view} jurors={jurors} target={target} setTarget={setTarget} />}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {panel === 'transcript' && <Transcript view={view} jurors={jurors} onClose={() => setPanel(null)} />}
        {panel === 'case' && (
          <motion.aside key="case" className="sheet case-sheet" initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
            <button className="sheet-close" onClick={() => setPanel(null)}>Close</button>
            <div className="file"><CaseFile brief={view.brief!} /></div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

export function App() {
  const view = useTrial();
  const [jurors, setJurors] = useState<Juror[]>([]);
  const [target, setTarget] = useState<number | null>(null);

  useEffect(() => {
    void fetch('/api/jurors').then((response) => response.json()).then(setJurors);
    void fetch('/api/trial', { method: 'POST' });
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="screen">
        {view.phase === 'waiting' ? (
          <p className="waiting-note">The bailiff is bringing in the case file.</p>
        ) : (
          <Stage view={view} jurors={jurors} target={target} onPick={setTarget} />
        )}
        <AnimatePresence>{view.phase === 'briefing' && view.brief && <Briefing key="brief" brief={view.brief} />}</AnimatePresence>
        {(view.phase === 'deliberating' || view.phase === 'over') && <Room view={view} jurors={jurors} target={target} setTarget={setTarget} />}
        {view.phase === 'over' && <Verdict view={view} />}
        <div className="grain" aria-hidden="true" />
      </div>
    </MotionConfig>
  );
}
