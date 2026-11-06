// Folds the bailiff's events into what the page shows. The page never decides who speaks.

export type Vote = 'guilty' | 'not_guilty' | 'undecided';

export type CaseBrief = {
  title: string;
  charge: string;
  summary: string;
  evidence: { label: string; detail: string }[];
  witnesses: { name: string; role: string; statement: string }[];
};

type Tally = { guilty: number; notGuilty: number; undecided: number };

type Quote = { name: string; text: string };

export type Debrief = {
  verdict: string;
  tally: Tally;
  evidence: { standing: string; headline: string; reason: string; raised: number; total: number; unraised: string[] };
  deliberation: { headline: string; evidence: number; emotion: number; pressure: number; bias: number };
  influence: {
    swayed: { juror: number; name: string; from: Vote; to: Vote; quote: string | null }[];
    shaken: { juror: number; name: string }[];
    movedByOthers: { juror: number; name: string; by: string }[];
    arguments: number;
    strongest: { text: string; jurorsMoved: number } | null;
    unsupported: number;
  };
  room: { emotional: Quote[]; biased: Quote[] };
};

export type TrialEvent =
  | { type: 'reset' }
  | { type: 'live' }
  | { type: 'selected' }
  | { type: 'desk' }
  | { type: 'brief'; brief: CaseBrief }
  | { type: 'deliberation' }
  | { type: 'floor'; jurorId: number }
  | { type: 'prompt'; kind: 'vote' }
  | { type: 'prompt'; kind: 'speak'; reason: 'hand' }
  | { type: 'prompt'; kind: 'speak'; reason: 'opening'; ms: number | null }
  | { type: 'hand.raised' }
  | { type: 'hand.lowered' }
  | { type: 'released' }
  | { type: 'human.vote'; vote: Vote }
  | { type: 'line'; speaker: string; text: string; vote?: Vote; mood?: string; at?: number; grudge?: number; seat?: number }
  | { type: 'tally'; tally: Tally }
  | { type: 'verdict'; verdict: string }
  | { type: 'debrief'; debrief: Debrief }
  | { type: 'pace'; stepping: boolean }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'continue.wait' }
  | { type: 'continued' };

export type Line = {
  id: number;
  speaker: string;
  text: string;
  mood?: string;
  ballot: boolean;
  /** Said before this page connected, so it's shown whole rather than typed out. */
  replayed: boolean;
};

export type TrialView = {
  phase: 'waiting' | 'choosing' | 'briefing' | 'deliberating' | 'over';
  /** A case has been picked and the bailiff is bringing it in. */
  selected: boolean;
  /** False while a refreshed page replays history, so nothing stages or sounds. */
  live: boolean;
  brief: CaseBrief | null;
  lines: Line[];
  /** The line on screen as a caption. */
  caption: Line | null;
  votes: Record<number, Vote>;
  myVote: Vote;
  speaker: number | null;
  /** Who the speaker is talking to. */
  facing: number | null;
  /** The juror who has just shifted in their seat. */
  shifting: number | null;
  prompt: 'speak' | 'vote' | null;
  /** The room is holding for you, rather than offering a moment that will pass. */
  held: boolean;
  /** How long a passing opening lasts, in milliseconds. */
  openingMs: number | null;
  handUp: boolean;
  /** Waiting for Continue after each juror, rather than moving on by itself. */
  stepping: boolean;
  /** The line has been read out and the room is waiting for Continue. */
  canContinue: boolean;
  paused: boolean;
  /** From 0 to 1, how hot the room is. Rises on clashes and flips, cools on every line. */
  heat: number;
  verdict: string | null;
  debrief: Debrief | null;
};

export const emptyTrial: TrialView = {
  phase: 'waiting',
  selected: false,
  live: false,
  brief: null,
  lines: [],
  caption: null,
  votes: {},
  myVote: 'undecided',
  speaker: null,
  facing: null,
  shifting: null,
  prompt: null,
  held: false,
  openingMs: null,
  handUp: false,
  stepping: false,
  canContinue: false,
  paused: false,
  heat: 0,
  verdict: null,
  debrief: null,
};

const BALLOT_WORDS = new Set(['Guilty.', 'Not guilty.', "I can't say yet."]);
const ANGRY = /angr|furi|irrit|enrag|hostile|bitter|defensive|contempt|disgust|impatient|livid|aggress|annoy|frustrat/i;
const COOLING = 0.84;

export const seatOf = (speaker: string) => Number(/^juror-(\d+)$/.exec(speaker)?.[1] ?? 0);

function heatAfter(view: TrialView, event: Extract<TrialEvent, { type: 'line' }>, flipped: boolean): number {
  let added = 0;
  if (event.at && event.at !== 12) added += 0.1;
  if (event.grudge) added += 0.32;
  if (event.mood && ANGRY.test(event.mood)) added += 0.18;
  if (event.text.includes('!')) added += 0.07;
  if (flipped) added += 0.28;
  return Math.min(1, view.heat * COOLING + added);
}

export function applyEvent(view: TrialView, event: TrialEvent): TrialView {
  switch (event.type) {
    case 'reset':
      return emptyTrial;
    case 'live':
      return { ...view, live: true, phase: view.phase === 'waiting' && !view.selected ? 'choosing' : view.phase };
    case 'selected':
      return { ...emptyTrial, live: view.live, stepping: view.stepping, selected: true };
    case 'desk':
      return { ...emptyTrial, live: view.live, stepping: view.stepping, phase: 'choosing' };
    case 'brief':
      // The pace event can land just ahead of this, and it has to survive.
      return { ...emptyTrial, live: view.live, stepping: view.stepping, phase: 'briefing', brief: event.brief };
    case 'deliberation':
      return { ...view, phase: 'deliberating' };
    case 'floor':
      return { ...view, speaker: event.jurorId, facing: null, shifting: null, prompt: null, caption: null, canContinue: false };
    case 'prompt':
      return {
        ...view,
        canContinue: false,
        prompt: event.kind,
        held: event.kind === 'vote' || event.reason === 'hand',
        openingMs: event.kind === 'speak' && event.reason === 'opening' ? event.ms : null,
        handUp: event.kind === 'speak' && event.reason === 'hand' ? false : view.handUp,
        speaker: null,
        shifting: null,
      };
    case 'pace':
      return { ...view, stepping: event.stepping };
    case 'paused':
      return { ...view, paused: true };
    case 'resumed':
      return { ...view, paused: false };
    case 'continue.wait':
      return { ...view, canContinue: true };
    case 'continued':
      return { ...view, canContinue: false };
    case 'hand.raised':
      return { ...view, handUp: true };
    case 'hand.lowered':
      return { ...view, handUp: false };
    case 'released':
      return { ...view, prompt: null, held: false, openingMs: null };
    case 'human.vote':
      return { ...view, myVote: event.vote };
    case 'tally':
      return { ...view, speaker: null };
    case 'verdict':
      return { ...view, phase: 'over', verdict: event.verdict, prompt: null, speaker: null, caption: null, canContinue: false, paused: false };
    case 'debrief':
      return { ...view, debrief: event.debrief };
    case 'line': {
      const seat = seatOf(event.speaker);
      const line: Line = {
        id: view.lines.length,
        speaker: event.speaker,
        text: event.text,
        mood: event.mood,
        ballot: BALLOT_WORDS.has(event.text),
        replayed: !view.live,
      };
      const lines = [...view.lines, line];
      if (event.speaker === 'stage') return { ...view, lines, shifting: event.seat ?? null };

      const flipped = Boolean(seat && event.vote && view.votes[seat] && view.votes[seat] !== event.vote);
      const votes = seat && event.vote ? { ...view.votes, [seat]: event.vote } : view.votes;
      if (line.ballot) return { ...view, lines, votes, speaker: seat, caption: null };
      return {
        ...view,
        lines,
        votes,
        speaker: seat || null,
        facing: event.at ?? null,
        caption: line,
        heat: heatAfter(view, event, flipped),
      };
    }
  }
}

/** How long a live event holds the stage before the next one plays. */
export function holdFor(event: TrialEvent, heat: number): number {
  const pace = 1 - heat * 0.4;
  switch (event.type) {
    case 'deliberation':
      return 1600;
    case 'floor':
      return 900 * pace;
    case 'tally':
      return 1400;
    case 'line': {
      if (event.speaker === 'stage') return 500;
      if (BALLOT_WORDS.has(event.text)) return 380;
      // The bailiff holds each line a little longer than this, so the page never falls behind.
      return (900 + event.text.length * typingSpeed(heat)) * pace + 500;
    }
    default:
      return 0;
  }
}

/** Milliseconds per character. A heated room talks faster. */
export const typingSpeed = (heat: number) => 30 - heat * 14;
