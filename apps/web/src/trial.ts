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
  | { type: 'brief'; brief: CaseBrief }
  | { type: 'deliberation' }
  | { type: 'floor'; jurorId: number }
  | { type: 'prompt'; kind: 'speak' | 'vote' }
  | { type: 'released' }
  | { type: 'human.vote'; vote: Vote }
  | { type: 'line'; speaker: string; text: string; vote?: Vote; mood?: string; at?: number; grudge?: number; seat?: number }
  | { type: 'tally'; tally: Tally }
  | { type: 'verdict'; verdict: string }
  | { type: 'debrief'; debrief: Debrief };

export type Line = { id: number; speaker: string; text: string; mood?: string; ballot: boolean };

export type TrialView = {
  phase: 'waiting' | 'briefing' | 'deliberating' | 'over';
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
  /** From 0 to 1, how hot the room is. Rises on clashes and flips, cools on every line. */
  heat: number;
  verdict: string | null;
  debrief: Debrief | null;
};

export const emptyTrial: TrialView = {
  phase: 'waiting',
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
      return { ...view, live: true };
    case 'brief':
      return { ...emptyTrial, live: view.live, phase: 'briefing', brief: event.brief };
    case 'deliberation':
      return { ...view, phase: 'deliberating' };
    case 'floor':
      return { ...view, speaker: event.jurorId, facing: null, shifting: null, prompt: null, caption: null };
    case 'prompt':
      return { ...view, prompt: event.kind, speaker: null, shifting: null };
    case 'released':
      return { ...view, prompt: null };
    case 'human.vote':
      return { ...view, myVote: event.vote };
    case 'tally':
      return { ...view, speaker: null };
    case 'verdict':
      return { ...view, phase: 'over', verdict: event.verdict, prompt: null, speaker: null, caption: null };
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
      return (900 + event.text.length * typingSpeed(heat)) * pace + 500;
    }
    default:
      return 0;
  }
}

/** Milliseconds per character. A heated room talks faster. */
export const typingSpeed = (heat: number) => 30 - heat * 14;
