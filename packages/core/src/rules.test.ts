import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyOwnShift, feelTheRoom, hear, nextVote, openingState } from './belief';
import { CAST } from './cast';
import { pickNext, type Candidate, type RoomView } from './director';
import type { Case } from './types';

const trial = JSON.parse(
  readFileSync(new URL('../../../cases/hale.json', import.meta.url), 'utf8'),
) as Case;

const juror = (id: number) => CAST.find((profile) => profile.id === id)!;

describe('vote thresholds', () => {
  it('goes through grey before crossing over', () => {
    expect(nextVote('guilty', 49)).toBe('guilty');
    expect(nextVote('guilty', 48)).toBe('undecided');
    expect(nextVote('undecided', 45)).toBe('undecided');
    expect(nextVote('undecided', 40)).toBe('not_guilty');
    expect(nextVote('not_guilty', 51)).toBe('not_guilty');
    expect(nextVote('not_guilty', 52)).toBe('undecided');
    expect(nextVote('undecided', 60)).toBe('guilty');
  });

  it('never skips grey, however far belief has moved', () => {
    expect(nextVote('guilty', 5)).toBe('undecided');
    expect(nextVote('not_guilty', 95)).toBe('undecided');
  });
});

describe('hearing arguments', () => {
  const strong = { speaker: 'human' as const, pointIds: ['n8'], quality: 1, target: 6 };

  it('moves a juror the right way', () => {
    const before = openingState(juror(6));
    expect(hear(before, juror(6), strong, trial).belief).toBeLessThan(before.belief);
  });

  it('never moves a juror more than their max step', () => {
    for (const profile of CAST) {
      const before = openingState(profile);
      const everything = { ...strong, pointIds: trial.points.map((point) => point.id) };
      const moved = Math.abs(hear(before, profile, everything, trial).belief - before.belief);
      expect(moved).toBeLessThanOrEqual(profile.maxStep);
    }
  });

  it('lets no single argument flip anyone', () => {
    for (const profile of CAST) {
      const state = openingState(profile);
      for (const point of trial.points) {
        const after = hear(state, profile, { speaker: 'human', pointIds: [point.id], quality: 1, target: profile.id }, trial);
        const vote = nextVote(state.vote, after.belief);
        expect(vote === 'guilty' || vote === 'not_guilty' ? vote : state.vote).toBe(state.vote);
      }
    }
  });

  it('never lets repeating one point flip anyone, however well it is put', () => {
    for (const profile of CAST) {
      for (const point of trial.points) {
        let state = openingState(profile);
        const start = state.vote;
        for (let time = 0; time < 30; time += 1) {
          state = hear(state, profile, { speaker: 'human', pointIds: [point.id], quality: 1, target: profile.id }, trial);
          state = { ...state, vote: nextVote(state.vote, state.belief) };
        }
        const crossed = state.vote !== 'undecided' && state.vote !== start;
        expect(crossed, `#${profile.id} on ${point.id} ended at ${state.belief}`).toBe(false);
      }
    }
  });

  it('makes stubborn jurors need at least 3 distinct points', () => {
    for (const profile of CAST.filter((candidate) => candidate.resolve > 0.6)) {
      const target = profile.openingBelief >= 50 ? 40 : 60;
      expect(Math.abs(profile.openingBelief - target) / profile.maxStep).toBeGreaterThan(2);
    }
  });

  it('counts the best point in a line, and only a little of the rest', () => {
    const moved = (pointIds: string[]) =>
      juror(6).openingBelief - hear(openingState(juror(6)), juror(6), { speaker: 1, pointIds, quality: 0.7 }, trial).belief;
    const best = Math.max(moved(['n7']), moved(['n5']));
    expect(moved(['n7', 'n5'])).toBeGreaterThan(best);
    expect(moved(['n7', 'n5'])).toBeLessThan(best * 1.5);
  });

  it('halves the effect of a repeated point', () => {
    const first = hear(openingState(juror(4)), juror(4), { speaker: 'human', pointIds: ['n7'], quality: 1 }, trial);
    const second = hear(first, juror(4), { speaker: 'human', pointIds: ['n7'], quality: 1 }, trial);
    const firstStep = juror(4).openingBelief - first.belief;
    expect(first.belief - second.belief).toBeCloseTo(firstStep / 2);
  });

  it('ignores fabricated claims', () => {
    const state = openingState(juror(2));
    expect(hear(state, juror(2), { ...strong, fabricated: true }, trial)).toBe(state);
  });

  it('weighs a grudge target less', () => {
    const friendly = openingState(juror(6));
    const hostile = { ...friendly, grudges: [3] };
    const line = { speaker: 3, pointIds: ['n7'], quality: 0.7 };
    expect(hear(hostile, juror(6), line, trial).belief).toBeGreaterThan(
      hear(friendly, juror(6), line, trial).belief,
    );
  });

  it('makes the Follower feel the room more than the Analyst', () => {
    const tally = { guilty: 3, notGuilty: 9, undecided: 0 };
    const follower = feelTheRoom(openingState(juror(2)), juror(2), tally);
    const analyst = feelTheRoom(openingState(juror(4)), juror(4), tally);
    expect(juror(2).openingBelief - follower.belief).toBeGreaterThan(
      juror(4).openingBelief - analyst.belief,
    );
  });

  it('limits the model reassessment by stubbornness', () => {
    const state = openingState(juror(10));
    expect(applyOwnShift(state, juror(10), -10).belief).toBe(state.belief - juror(10).maxStep);
  });
});

describe('turn director', () => {
  const candidate = (id: number, extra: Partial<Candidate> = {}): Candidate => ({
    id,
    talkativeness: 0.5,
    focus: [],
    vote: 'guilty',
    handRaised: false,
    silentFor: 5,
    ...extra,
  });
  const view = (extra: Partial<RoomView>): RoomView => ({
    candidates: [candidate(1), candidate(2), candidate(3)],
    last: null,
    grudges: [],
    exchangeLength: 0,
    random: () => 0,
    ...extra,
  });

  it('gives the floor to a juror you named', () => {
    const grant = pickNext(view({
      candidates: [candidate(1, { talkativeness: 1, handRaised: true }), candidate(4)],
      last: { speaker: 'human', target: 4, evidenceIds: [] },
    }));
    expect(grant).toMatchObject({ jurorId: 4, why: 'addressed' });
  });

  it('returns exactly one juror', () => {
    expect(pickNext(view({}))?.jurorId).toBeTypeOf('number');
  });

  it('favours a raised hand', () => {
    const grant = pickNext(view({ candidates: [candidate(1), candidate(2, { handRaised: true })] }));
    expect(grant).toMatchObject({ jurorId: 2, why: 'hand' });
  });

  it("doesn't let someone speak twice running", () => {
    const grant = pickNext(view({
      candidates: [candidate(1, { silentFor: 0, talkativeness: 1 }), candidate(2, { talkativeness: 0.1 })],
      last: { speaker: 1, evidenceIds: [] },
    }));
    expect(grant?.jurorId).toBe(2);
  });

  it('allows a short heated exchange, then ends it', () => {
    // Juror 2 just answered juror 1 by name. Juror 3 is the bystander.
    const candidates = [
      candidate(1, { silentFor: 1 }),
      candidate(2, { silentFor: 0 }),
      candidate(3, { silentFor: 5 }),
    ];
    const last = { speaker: 2, target: 1, evidenceIds: [] };
    expect(pickNext(view({ candidates, last, exchangeLength: 2 }))?.jurorId).toBe(1);
    expect(pickNext(view({ candidates, last, exchangeLength: 3 }))?.jurorId).toBe(3);
  });

  it('lets you call on someone even after an exchange runs out', () => {
    const candidates = [candidate(1, { silentFor: 1 }), candidate(3, { silentFor: 5 })];
    const last = { speaker: 'human' as const, target: 1, evidenceIds: [] };
    expect(pickNext(view({ candidates, last, exchangeLength: 3 }))?.jurorId).toBe(1);
  });

  it('favours a holdout over a majority that keeps agreeing', () => {
    const grant = pickNext(view({
      candidates: [
        candidate(1, { vote: 'not_guilty', talkativeness: 1 }),
        candidate(2, { vote: 'not_guilty', talkativeness: 1 }),
        candidate(3, { vote: 'not_guilty', talkativeness: 1 }),
        candidate(4, { vote: 'guilty', talkativeness: 0.2 }),
      ],
    }));
    expect(grant).toMatchObject({ jurorId: 4, why: 'holdout' });
  });

  it('brings in a juror who has gone quiet', () => {
    const grant = pickNext(view({
      candidates: [candidate(1, { talkativeness: 1, silentFor: 3 }), candidate(2, { talkativeness: 0, silentFor: 14 })],
    }));
    expect(grant).toMatchObject({ jurorId: 2, why: 'quiet' });
  });
});
