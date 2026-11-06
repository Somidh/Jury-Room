import type { Argument, Case, JurorProfile, JurorState, Point, Tally, Vote } from './types';

const FOCUS_BONUS = 1.5;
const ADDRESSED_BONUS = 1.3;
const GRUDGE_PENALTY = 0.6;
const ALLY_BONUS = 1.2;
const OWN_SHIFT_LIMIT = 2;
/** A line making several points lands its best one. The rest only add a little. */
const EXTRA_POINT_SHARE = 0.35;
/** The furthest one point can ever move a juror, as a multiple of their max step. */
const POINT_LIFETIME_LIMIT = 1.4;
const SOCIAL_BASE = 18;
const ISOLATED_SIDE_SIZE = 3;
const ISOLATION_BONUS = 3;
/**
 * A juror's line lands softer than a well-made argument from the person, and a juror
 * who isn't sure persuades less still. Otherwise the room argues itself to a verdict
 * and the person in seat 12 doesn't matter.
 */
const JUROR_LINE_QUALITY = 0.3;
const UNSURE_SHARE = 0.5;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function openingState(profile: JurorProfile, lean = 0): JurorState {
  const belief = clamp(profile.openingBelief + lean, 0, 100);
  return {
    belief,
    // The opening ballot forces a choice. Doubt shows up later, as grey.
    vote: belief >= 50 ? 'guilty' : 'not_guilty',
    heard: {},
    moved: {},
    grudges: [],
    allies: [],
  };
}

export function jurorLineQuality(vote: Vote): number {
  return vote === 'undecided' ? JUROR_LINE_QUALITY * UNSURE_SHARE : JUROR_LINE_QUALITY;
}

/** How sure a juror is, whichever way they lean. */
export function conviction(belief: number): number {
  return Math.abs(belief - 50) * 2;
}

/** The gap between thresholds stops a juror flickering around one line. */
export function nextVote(current: Vote, belief: number): Vote {
  // One step at a time: nobody crosses from guilty to not guilty without going grey.
  if (current === 'guilty') return belief <= 48 ? 'undecided' : 'guilty';
  if (current === 'not_guilty') return belief >= 52 ? 'undecided' : 'not_guilty';
  if (belief <= 40) return 'not_guilty';
  if (belief >= 60) return 'guilty';
  return 'undecided';
}

function pointStep(
  point: Point,
  argument: Argument,
  profile: JurorProfile,
  state: JurorState,
  focus: string[],
): number {
  const novelty = 0.5 ** (state.heard[point.id] ?? 0);
  const lens = profile.lens[argument.tactic ?? point.tactic];
  const onFocus = focus.includes(point.evidenceId) ? FOCUS_BONUS : 1;
  const addressed = argument.target === profile.id ? ADDRESSED_BONUS : 1;
  const speaker = argument.speaker;
  const relation =
    typeof speaker === 'number' && state.grudges.includes(speaker)
      ? GRUDGE_PENALTY
      : typeof speaker === 'number' && state.allies.includes(speaker)
        ? ALLY_BONUS
        : 1;
  const size =
    point.weight * argument.quality * lens * onFocus * addressed * relation * novelty;
  const signed = size * (1 - profile.resolve);
  return point.pushes === 'guilty' ? signed : -signed;
}

/** Applies one argument to a juror's private state. Uses no model. */
export function hear(
  state: JurorState,
  profile: JurorProfile,
  argument: Argument,
  trial: Pick<Case, 'points' | 'focus'>,
): JurorState {
  if (argument.fabricated || argument.speaker === profile.id) return state;

  const focus = trial.focus[String(profile.id)] ?? [];
  const heard = { ...state.heard };
  const moved = { ...state.moved };
  const pointLimit = profile.maxStep * POINT_LIFETIME_LIMIT;
  const steps: number[] = [];
  for (const id of argument.pointIds) {
    const point = trial.points.find((candidate) => candidate.id === id);
    if (!point) continue;
    // Halving alone isn't enough: it still sums to twice the first step, which
    // would let one point, repeated, flip a juror close to the line.
    const left = Math.max(0, pointLimit - (moved[id] ?? 0));
    const raw = pointStep(point, argument, profile, { ...state, heard }, focus);
    const limited = clamp(raw, -Math.min(left, profile.maxStep), Math.min(left, profile.maxStep));
    steps.push(limited);
    moved[id] = (moved[id] ?? 0) + Math.abs(limited);
    heard[id] = (heard[id] ?? 0) + 1;
  }

  const [best = 0, ...rest] = steps.sort((a, b) => Math.abs(b) - Math.abs(a));
  const step = best + rest.reduce((sum, value) => sum + value * EXTRA_POINT_SHARE, 0);
  const belief = clamp(state.belief + clamp(step, -profile.maxStep, profile.maxStep), 0, 100);
  return { ...state, belief, heard, moved };
}

/** Pressure from a vote result. Pulls a juror toward a majority they aren't part of. */
export function feelTheRoom(state: JurorState, profile: JurorProfile, tally: Tally): JurorState {
  const lean = tally.guilty - tally.notGuilty;
  if (lean === 0) return state;

  const majority: Vote = lean > 0 ? 'guilty' : 'not_guilty';
  if (state.vote === majority) return state;

  const ownSide = state.vote === 'guilty' ? tally.guilty : tally.notGuilty;
  const isolated = state.vote !== 'undecided' && ownSide <= ISOLATED_SIDE_SIZE;
  const margin = Math.abs(lean) / 12;
  const size =
    SOCIAL_BASE *
    margin *
    profile.lens.social *
    (1 - profile.resolve / 2) *
    (isolated ? ISOLATION_BONUS : 1);
  return {
    ...state,
    belief: clamp(state.belief + (majority === 'guilty' ? size : -size), 0, 100),
  };
}

/** The model's own reassessment on a juror's turn. It can't outrun their stubbornness. */
export function applyOwnShift(
  state: JurorState,
  profile: JurorProfile,
  shift: number,
): JurorState {
  const limit = Math.min(OWN_SHIFT_LIMIT, profile.maxStep);
  return { ...state, belief: clamp(state.belief + clamp(shift, -limit, limit), 0, 100) };
}
