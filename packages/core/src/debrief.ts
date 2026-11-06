// The end of a trial. This measures the deliberation against the evidence that was
// presented. It has no access to what really happened, by its type and on purpose: a
// verdict is judged by what could be proved, never by a truth nobody in the room had.
import { CAST } from './cast';
import type { Case, Tally, Vote } from './types';

/** What moved a juror, as signed belief points. Positive moves toward guilty. */
export type Moved = { person: number; jurors: number; room: number; self: number };

/** What one juror reports, in their own words of account, when the trial is over. */
export type Ledger = {
  juror: number;
  openingVote: Vote;
  finalVote: Vote;
  moved: Moved;
  /** Belief moved by each of the person's arguments, by argument id. */
  byArgument: Record<string, number>;
};

export type LineBasis = 'evidence' | 'emotion' | 'pressure' | 'bias';

export type SpokenLine = {
  juror: number;
  text: string;
  /** Their vote once they'd said it. */
  vote: Vote;
  points: string[];
  basis: LineBasis;
};

export type PersonArgument = {
  id: string;
  text: string;
  points: string[];
  fabricated: boolean;
};

export type Verdict = 'guilty' | 'not_guilty' | 'hung';

export type Debrief = {
  verdict: Verdict;
  tally: Tally;
  evidence: {
    /** How the verdict sits with the evidence presented. */
    standing: 'supported' | 'unsupported' | 'unresolved';
    headline: string;
    reason: string;
    raised: number;
    total: number;
    /** The heaviest points nobody brought up. */
    unraised: string[];
  };
  deliberation: {
    headline: string;
    evidence: number;
    emotion: number;
    pressure: number;
    bias: number;
  };
  influence: {
    swayed: Sway[];
    /** Their vote held, but you moved them. */
    shaken: { juror: number; name: string }[];
    /** Changed their vote for other reasons. */
    movedByOthers: { juror: number; name: string; by: string }[];
    arguments: number;
    strongest: { text: string; jurorsMoved: number } | null;
    unsupported: number;
  };
  /** The lines that rested on something other than the evidence. */
  room: {
    emotional: { name: string; text: string }[];
    biased: { name: string; text: string }[];
  };
};

export type Sway = { juror: number; name: string; from: Vote; to: Vote; quote: string | null };

type Input = {
  /** Deliberately not the whole case. The truth can't reach this function. */
  trial: Pick<Case, 'points' | 'record'>;
  verdict: Verdict;
  tally: Tally;
  lines: SpokenLine[];
  arguments: PersonArgument[];
  ledgers: Ledger[];
};

/** You swayed a juror if at least this much of what changed their mind came from you. */
const SWAYED_SHARE = 0.34;
const SHAKEN_POINTS = 5;
const MIN_ARGUMENT_MOVEMENT = 0.5;
const UNRAISED_SHOWN = 3;
const QUOTES_SHOWN = 2;
const WELL_ARGUED_SHARE = 0.6;
const MIXED_SHARE = 0.35;

const nameOf = (juror: number) => CAST.find((profile) => profile.id === juror)?.name ?? `Juror ${juror}`;

function assessEvidence(input: Input): Debrief['evidence'] {
  const { trial, verdict, lines } = input;
  const raisedIds = new Set([...lines.flatMap((line) => line.points), ...input.arguments.flatMap((item) => item.points)]);
  const unraised = trial.points
    .filter((point) => !raisedIds.has(point.id))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, UNRAISED_SHOWN)
    .map((point) => point.claim);

  const { supports, reason } = trial.record;
  const standing = verdict === 'hung' ? 'unresolved' : verdict === supports ? 'supported' : 'unsupported';
  const headline = {
    supported: 'The evidence presented supports this verdict.',
    unsupported: 'The evidence presented does not carry this verdict.',
    unresolved: 'The room could not agree, so the evidence went unanswered.',
  }[standing];

  return {
    standing,
    headline,
    reason,
    raised: trial.points.filter((point) => raisedIds.has(point.id)).length,
    total: trial.points.length,
    unraised,
  };
}

function basisOf(line: SpokenLine, trial: Input['trial']): LineBasis {
  const prejudicial = line.points.some((id) => trial.points.find((point) => point.id === id)?.prejudicial);
  return prejudicial ? 'bias' : line.basis;
}

function assessDeliberation({ lines, trial }: Input): Debrief['deliberation'] {
  const count = (basis: LineBasis) => lines.filter((line) => basisOf(line, trial) === basis).length;
  const evidence = count('evidence');
  const share = evidence / Math.max(1, lines.length);
  const headline =
    share >= WELL_ARGUED_SHARE
      ? 'The room mostly argued from the evidence.'
      : share >= MIXED_SHARE
        ? 'Evidence and pressure ran side by side.'
        : 'Pressure did more of the work than the evidence.';
  return { headline, evidence, emotion: count('emotion'), pressure: count('pressure'), bias: count('bias') };
}

/** How much of a juror's change of mind came from each source, toward where they ended up. */
function shareFromPerson({ moved, openingVote, finalVote }: Ledger): number {
  const towardGuilty = finalVote === 'guilty' || (finalVote === 'undecided' && openingVote === 'not_guilty');
  const toward = (value: number) => Math.max(0, towardGuilty ? value : -value);
  const total = toward(moved.person) + toward(moved.jurors) + toward(moved.room) + toward(moved.self);
  return total > 0 ? toward(moved.person) / total : 0;
}

function biggestOtherSource({ moved, finalVote, openingVote }: Ledger): string {
  const towardGuilty = finalVote === 'guilty' || (finalVote === 'undecided' && openingVote === 'not_guilty');
  const toward = (value: number) => (towardGuilty ? value : -value);
  return toward(moved.room) >= toward(moved.jurors) ? 'the pressure of the count' : 'the other jurors';
}

/** The line a juror said as they crossed to their final vote, if they said one. */
function turningLine(ledger: Ledger, lines: SpokenLine[]): string | null {
  const theirs = lines.filter((line) => line.juror === ledger.juror);
  const at = theirs.findIndex((line) => line.vote === ledger.finalVote);
  return at >= 0 ? theirs[at]!.text : null;
}

function assessInfluence(input: Input): Debrief['influence'] {
  const { ledgers, lines } = input;
  const changed = ledgers.filter((ledger) => ledger.openingVote !== ledger.finalVote);
  const swayedLedgers = changed.filter((ledger) => shareFromPerson(ledger) >= SWAYED_SHARE);

  const swayed = swayedLedgers.map((ledger) => ({
    juror: ledger.juror,
    name: nameOf(ledger.juror),
    from: ledger.openingVote,
    to: ledger.finalVote,
    quote: turningLine(ledger, lines),
  }));
  const movedByOthers = changed
    .filter((ledger) => !swayedLedgers.includes(ledger))
    .map((ledger) => ({ juror: ledger.juror, name: nameOf(ledger.juror), by: biggestOtherSource(ledger) }));
  const shaken = ledgers
    .filter((ledger) => ledger.openingVote === ledger.finalVote && Math.abs(ledger.moved.person) >= SHAKEN_POINTS)
    .map((ledger) => ({ juror: ledger.juror, name: nameOf(ledger.juror) }));

  const scored = input.arguments
    .map((item) => {
      const reach = ledgers.map((ledger) => Math.abs(ledger.byArgument[item.id] ?? 0));
      return {
        text: item.text,
        total: reach.reduce((sum, value) => sum + value, 0),
        jurorsMoved: reach.filter((value) => value >= MIN_ARGUMENT_MOVEMENT).length,
      };
    })
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);
  const best = scored[0];

  return {
    swayed,
    shaken,
    movedByOthers,
    arguments: input.arguments.length,
    strongest: best ? { text: best.text, jurorsMoved: best.jurorsMoved } : null,
    unsupported: input.arguments.filter((item) => item.fabricated).length,
  };
}

function quotes({ lines, trial }: Input, basis: LineBasis) {
  return lines
    .filter((line) => basisOf(line, trial) === basis)
    .sort((a, b) => a.text.length - b.text.length)
    .slice(0, QUOTES_SHOWN)
    .map((line) => ({ name: nameOf(line.juror), text: line.text }));
}

export function buildDebrief(input: Input): Debrief {
  return {
    verdict: input.verdict,
    tally: input.tally,
    evidence: assessEvidence(input),
    deliberation: assessDeliberation(input),
    influence: assessInfluence(input),
    room: { emotional: quotes(input, 'emotion'), biased: quotes(input, 'bias') },
  };
}
