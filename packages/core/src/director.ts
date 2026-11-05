// Decides who speaks next. Sees public signals only, never a juror's belief.

export type Candidate = {
  id: number;
  talkativeness: number;
  focus: string[];
  vote: 'guilty' | 'not_guilty' | 'undecided';
  handRaised: boolean;
  /** Turns since this juror last spoke. Infinity if they haven't. */
  silentFor: number;
};

export type LastLine = {
  speaker: number | 'human';
  speakerVote?: 'guilty' | 'not_guilty' | 'undecided';
  /** The juror this line named, if any. */
  target?: number;
  evidenceIds: string[];
};

export type RoomView = {
  candidates: Candidate[];
  last: LastLine | null;
  /** Pairs of juror ids that have openly clashed. */
  grudges: [number, number][];
  /** How many lines in a row the current two jurors have traded. */
  exchangeLength: number;
  /** Returns 0 to 1. Injected so tests and replays are repeatable. */
  random: () => number;
};

export type Grant = { jurorId: number; why: string; score: number };

const NAMED_BY_HUMAN = 100;
const NAMED_BY_JUROR = 60;
const HAND_RAISED = 50;
const ON_FOCUS = 30;
const OPPOSING = 20;
const GRUDGE = 20;
const HOLDOUT = 30;
const HOLDOUT_SIDE_SIZE = 2;
const TALK_SCALE = 15;
const QUIET_AFTER = 8;
const QUIET_PER_TURN = 5;
const RECENT_WINDOW = 3;
const RECENT_PENALTY = 15;
const JUST_SPOKE_PENALTY = 40;
const JITTER = 10;
const MAX_EXCHANGE = 3;

function hasGrudge(grudges: [number, number][], a: number, b: number): boolean {
  return grudges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

function score(candidate: Candidate, view: RoomView): { score: number; why: string } {
  const { last } = view;
  const parts: [string, number][] = [];

  // You can always call on someone. Two jurors can only trade lines for so long.
  const named = last?.target === candidate.id;
  const byHuman = last?.speaker === 'human';
  const exchangeOver = view.exchangeLength >= MAX_EXCHANGE;
  if (named && (byHuman || !exchangeOver)) {
    parts.push(['addressed', byHuman ? NAMED_BY_HUMAN : NAMED_BY_JUROR]);
  }
  if (candidate.handRaised) parts.push(['hand', HAND_RAISED]);
  if (last?.evidenceIds.some((id) => candidate.focus.includes(id))) parts.push(['focus', ON_FOCUS]);
  if (
    last?.speakerVote &&
    candidate.vote !== 'undecided' &&
    last.speakerVote !== 'undecided' &&
    candidate.vote !== last.speakerVote
  ) {
    parts.push(['opposing', OPPOSING]);
  }
  if (typeof last?.speaker === 'number' && hasGrudge(view.grudges, candidate.id, last.speaker)) {
    parts.push(['grudge', GRUDGE]);
  }
  // The drama is in the minority. A room that only agrees with itself goes flat.
  const side = view.candidates.filter((other) => other.vote === candidate.vote).length;
  const rest = view.candidates.length - side;
  if (candidate.vote !== 'undecided' && side <= HOLDOUT_SIDE_SIZE && rest > side) {
    parts.push(['holdout', HOLDOUT]);
  }
  parts.push(['talkative', candidate.talkativeness * TALK_SCALE]);
  if (candidate.silentFor > QUIET_AFTER && Number.isFinite(candidate.silentFor)) {
    parts.push(['quiet', (candidate.silentFor - QUIET_AFTER) * QUIET_PER_TURN]);
  }

  // silentFor 0 means they spoke the last line, so they never go again straight
  // away. Someone just answered by name is exempt from the recent penalty, which
  // is what lets two jurors trade lines.
  const heated = named && (byHuman || !exchangeOver);
  if (candidate.silentFor === 0) {
    parts.push(['recent', -JUST_SPOKE_PENALTY]);
  } else if (candidate.silentFor < RECENT_WINDOW && !heated) {
    parts.push(['recent', -RECENT_PENALTY * (RECENT_WINDOW - candidate.silentFor)]);
  }

  const total = parts.reduce((sum, [, value]) => sum + value, 0) + view.random() * JITTER;
  const strongest = parts.reduce((best, part) => (part[1] > best[1] ? part : best), ['open', 0]);
  return { score: total, why: strongest[0] as string };
}

/** Picks exactly one juror, or nobody if the room is empty. */
export function pickNext(view: RoomView): Grant | null {
  let best: Grant | null = null;
  for (const candidate of view.candidates) {
    const { score: value, why } = score(candidate, view);
    if (!best || value > best.score) best = { jurorId: candidate.id, why, score: value };
  }
  return best;
}

/** Hard limits, so a trial always ends. */
export const MAX_TURNS = 60;
export const MAX_TURNS_WITHOUT_CHANGE = 20;
export const TURN_TIMEOUT_MS = 25_000;
export const TURNS_BETWEEN_VOTES = 12;
