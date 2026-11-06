import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { playHandRaised, setFrozen, setHeartbeat, setMuted, startAudio } from './audio';
import { CaseDesk } from './CaseDesk';
import { Ending } from './Ending';
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

const post = (path: string, body?: object) =>
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

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
        <button onClick={() => void post('/api/leave')} disabled={sending}>Back to the case files</button>
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
  const beating = view.phase === 'deliberating' && !view.paused;
  const beat = 1.5 - view.heat * 0.85 - (Math.abs(guilty - notGuilty) < 3 && votes.length ? 0.2 : 0);

  return (
    <header className="tally" aria-label={`Guilty ${guilty}, not guilty ${notGuilty}, undecided ${undecided}`}>
      <span className="tally-side guilty-side"><b>{guilty}</b> Guilty</span>
      <motion.div
        className="tally-bar"
        animate={beating ? { scaleY: [1, 1.5, 1.05, 1.32, 1] } : { scaleY: 1 }}
        transition={beating ? { duration: beat, repeat: Infinity, repeatDelay: beat * 0.35, times: [0, 0.12, 0.26, 0.38, 0.6] } : undefined}
      >
        <motion.span className="fill guilty-fill" initial={false} animate={{ width: `${(guilty / 12) * 100}%` }} transition={spring} />
        <motion.span className="fill not-guilty-fill" initial={false} animate={{ width: `${(notGuilty / 12) * 100}%` }} transition={spring} />
      </motion.div>
      <span className="tally-side not-guilty-side">Not guilty <b>{notGuilty}</b></span>
    </header>
  );
}

/** A line of the screenplay, typed out as it's said. */
function Caption({ line, jurors, heat, raised, paused }: { line: Line; jurors: Juror[]; heat: number; raised: boolean; paused: boolean }) {
  const [shown, setShown] = useState(line.replayed ? line.text.length : 0);
  const frozen = useRef(paused);
  frozen.current = paused;

  useEffect(() => {
    if (line.replayed) return;
    const timer = setInterval(() => {
      if (frozen.current) return;
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

function Dock({ view, jurors, target, setTarget, raiseHand }: {
  view: TrialView;
  jurors: Juror[];
  target: number | null;
  setTarget: (id: number | null) => void;
  raiseHand: () => void;
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

  /** Nothing is sent while paused, though you can keep drafting. */
  const locked = sending || view.paused;

  if (view.prompt === 'vote') {
    return (
      <motion.div className="dock waiting" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }}>
        <h2>How do you vote?</h2>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="actions">
          <button className="vote-guilty" disabled={locked} onClick={() => void send('I vote guilty')}>Guilty</button>
          <button className="vote-not-guilty" disabled={locked} onClick={() => void send('I vote not guilty')}>Not guilty</button>
          <button disabled={locked} onClick={() => void send('pass')}>{view.myVote === 'undecided' ? "I can't say yet" : 'Keep my vote'}</button>
        </div>
      </motion.div>
    );
  }

  if (view.prompt === 'speak') {
    const open = !view.held;
    const targetName = jurors.find((juror) => juror.id === target)?.name.split(' ')[0];
    return (
      <motion.form className="dock waiting" onSubmit={argue} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }} transition={{ delay: 0.5, duration: 0.7 }}>
        <div className="dock-head">
          <h2>{open ? 'The floor is open' : 'The room is yours'}</h2>
          <div className="address" role="group" aria-label="Who you are speaking to">
            <button type="button" aria-pressed={target === null} onClick={() => setTarget(null)}>Everyone</button>
            {jurors.map((juror) => (
              <button key={juror.id} type="button" aria-pressed={target === juror.id} onClick={() => setTarget(juror.id)}>
                {juror.name.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>
        {open && view.openingMs && <span className="opening-time" style={{ animationDuration: `${view.openingMs}ms` }} />}
        {error && <p role="alert" className="error">{error}</p>}
        <div className="dock-input">
          <textarea
            ref={input}
            rows={2}
            value={text}
            maxLength={MAX_MESSAGE}
            aria-label="Your argument"
            placeholder={targetName ? `Say it to ${targetName}.` : open ? 'Start typing and the room will wait for you.' : 'They are all looking at you.'}
            onChange={(event) => {
              setText(event.target.value);
              // Starting to answer an opening holds the room, so it can't close on you.
              if (open) raiseHand();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (!view.paused) argue(event);
              }
            }}
          />
          {Speech && (
            <button type="button" className={listening ? 'mic listening' : 'mic'} aria-pressed={listening} onClick={toggleListening}>
              {listening ? 'Stop' : 'Speak'}
            </button>
          )}
        </div>
        <div className="actions">
          <button type="submit" className="primary" disabled={locked || !text.trim()}>Make argument</button>
          <button type="button" disabled={locked} onClick={() => void send('pass')}>{open ? 'Let them continue' : 'Never mind'}</button>
          <button type="button" className="quiet" disabled={locked} onClick={() => void send('call a vote')}>Call a vote</button>
        </div>
      </motion.form>
    );
  }

  return null;
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

/** Always there, always live. Pressing it stops the room at the end of the current line. */
function RaiseHand({ view, jurors, raised, onRaise }: {
  view: TrialView;
  jurors: Juror[];
  raised: boolean;
  onRaise: () => void;
}) {
  const speaker = jurors.find((juror) => juror.id === view.speaker)?.name.split(' ')[0];
  return (
    <motion.button
      className={`raise-hand${raised ? ' up' : ''}`}
      aria-pressed={raised}
      disabled={raised}
      onClick={onRaise}
      whileTap={{ scale: 0.95 }}
    >
      {raised ? (speaker ? `Hand raised. ${speaker} is finishing.` : 'Hand raised. The room is stopping.') : 'Raise hand'}
    </motion.button>
  );
}

/** The game stops here. The case file and transcript stay open to you. */
function PauseCard({ view, panel, onResume, onReadCase }: {
  view: TrialView;
  panel: 'case' | 'transcript' | null;
  onResume: () => void;
  onReadCase: () => void;
}) {
  return (
    <>
      <div className="pause-shade" aria-hidden="true" />
      <section className={`pause-card${panel ? ` beside-${panel}` : ''}`} aria-label="Game paused">
        <h2>Paused</h2>
        <p>{view.handUp ? 'Your hand is up. The room turns to you when you resume.' : 'Nobody speaks until you come back.'}</p>
        <div className="actions">
          <button className="primary" autoFocus onClick={onResume}>Resume<kbd>P</kbd></button>
          {panel !== 'case' && <button onClick={onReadCase}>Read the case file</button>}
        </div>
      </section>
    </>
  );
}

function Room({ view, jurors, target, setTarget, setHand, stepForward }: {
  view: TrialView;
  jurors: Juror[];
  target: number | null;
  setTarget: (id: number | null) => void;
  setHand: (up: boolean) => void;
  stepForward: () => void;
}) {
  const [panel, setPanel] = useState<'case' | 'transcript' | null>(null);
  const [mute, setMute] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const speaker = jurors.find((juror) => juror.id === view.speaker);

  useEffect(() => {
    setHeartbeat(view.held && view.live && !mute && !view.paused);
    return () => setHeartbeat(false);
  }, [view.held, view.live, mute, view.paused]);

  useEffect(() => {
    setFrozen(view.paused);
    return () => setFrozen(false);
  }, [view.paused]);

  const roomIsYours = view.held && view.prompt === 'speak';

  const raiseHand = useCallback(() => {
    if (view.handUp || roomIsYours) return;
    startAudio();
    playHandRaised();
    setHand(true);
    void say('raise hand').then((problem) => {
      if (problem) setHand(false);
    });
  }, [view.handUp, roomIsYours, setHand]);

  const deliberating = view.phase === 'deliberating';
  // Only the server's wait decides this, so the button can never go missing while it waits.
  const showContinue = deliberating && view.canContinue && !view.paused && !view.handUp;

  const stepOn = useCallback(() => {
    stepForward();
    void post('/api/continue');
  }, [stepForward]);

  const togglePause = useCallback(() => {
    void post('/api/pause', { paused: !view.paused });
  }, [view.paused]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'h') raiseHand();
      if (key === 'p' && deliberating) togglePause();
      // A focused button already answers these keys.
      const onButton = event.target instanceof HTMLButtonElement;
      if ((key === ' ' || key === 'enter') && showContinue && !onButton) {
        event.preventDefault();
        stepOn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [raiseHand, togglePause, stepOn, showContinue, deliberating]);

  return (
    <>
      <Tally view={view} />
      <div className={`room-tools${panel ? ` beside-${panel}` : ''}`}>
        <span className="my-vote"><VoteChip vote={view.myVote === 'undecided' ? undefined : view.myVote} live={view.live} label="Your vote" /> You</span>
        {deliberating && (
          <button aria-pressed={view.stepping} onClick={() => void post('/api/stepping', { stepping: !view.stepping })}>
            {view.stepping ? 'Pace: step' : 'Pace: auto'}
          </button>
        )}
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
        {deliberating && <button onClick={() => setLeaving(true)}>Leave trial</button>}
      </div>

      {leaving && deliberating && (
        <>
          <div className="pause-shade" aria-hidden="true" />
          <section className="pause-card leave-card" aria-label="Leave this trial">
            <h2>Leave this trial?</h2>
            <p>The jury is dismissed and this deliberation is lost.</p>
            <div className="actions">
              <button className="primary" autoFocus onClick={() => setLeaving(false)}>Stay</button>
              <button onClick={() => void post('/api/leave')}>Back to the case files</button>
            </div>
          </section>
        </>
      )}

      {view.paused && !leaving && deliberating && <PauseCard view={view} panel={panel} onResume={togglePause} onReadCase={() => setPanel('case')} />}

      <div className={`foreground${panel ? ` beside-${panel}` : ''}`}>
        <AnimatePresence mode="popLayout">
          {view.caption && (
            <Caption key={view.caption.id} line={view.caption} jurors={jurors} heat={view.heat} raised={view.prompt !== null} paused={view.paused} />
          )}
          {!view.caption && !view.prompt && speaker && (
            <motion.p key="floor" className="floor-note" initial={{ opacity: 0 }} animate={{ opacity: 0.75 }} exit={{ opacity: 0 }}>
              {speaker.name.split(' ')[0]} leans in.
            </motion.p>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {view.prompt && <Dock key={view.prompt} view={view} jurors={jurors} target={target} setTarget={setTarget} raiseHand={raiseHand} />}
        </AnimatePresence>
        {deliberating && (
          <div className="pace-row">
            {showContinue && (
              <motion.button className="primary continue" autoFocus initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} onClick={stepOn}>
                Continue<kbd>Space</kbd>
              </motion.button>
            )}
            {!roomIsYours && <RaiseHand view={view} jurors={jurors} raised={view.handUp} onRaise={raiseHand} />}
            <button className="pause" aria-pressed={view.paused} onClick={togglePause}>
              {view.paused ? 'Resume' : 'Pause'}<kbd>P</kbd>
            </button>
          </div>
        )}
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
  const { view, setHand, stepForward } = useTrial();
  const [jurors, setJurors] = useState<Juror[]>([]);
  const [target, setTarget] = useState<number | null>(null);

  useEffect(() => {
    void fetch('/api/jurors').then((response) => response.json()).then(setJurors);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className={`screen${view.paused ? ' paused' : ''}`}>
        {view.phase === 'waiting' ? (
          <p className="waiting-note">{view.selected ? 'The bailiff is bringing in the case file.' : ''}</p>
        ) : view.phase === 'choosing' ? (
          <CaseDesk />
        ) : (
          <Stage view={view} jurors={jurors} target={target} onPick={setTarget} />
        )}
        <AnimatePresence>{view.phase === 'briefing' && view.brief && <Briefing key="brief" brief={view.brief} />}</AnimatePresence>
        {(view.phase === 'deliberating' || view.phase === 'over') && <Room view={view} jurors={jurors} target={target} setTarget={setTarget} setHand={setHand} stepForward={stepForward} />}
        {view.phase === 'over' && view.verdict && <Ending verdict={view.verdict} debrief={view.debrief} jurors={jurors} />}
        <div className="grain" aria-hidden="true" />
      </div>
    </MotionConfig>
  );
}
