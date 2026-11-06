import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDebrief, type Ledger, type SpokenLine } from './debrief';
import type { Case, Tally } from './types';

const trial = JSON.parse(readFileSync(new URL('../../../cases/hale.json', import.meta.url), 'utf8')) as Case;
const tally: Tally = { guilty: 0, notGuilty: 12, undecided: 0 };

const ledger = (juror: number, extra: Partial<Ledger> = {}): Ledger => ({
  juror,
  openingVote: 'guilty',
  finalVote: 'not_guilty',
  moved: { person: -20, jurors: -5, room: -5, self: 0 },
  byArgument: {},
  ...extra,
});

const line = (juror: number, extra: Partial<SpokenLine> = {}): SpokenLine => ({
  juror,
  text: 'A line.',
  vote: 'not_guilty',
  points: ['n1'],
  basis: 'evidence',
  ...extra,
});

const build = (extra: Partial<Parameters<typeof buildDebrief>[0]> = {}) =>
  buildDebrief({ trial, verdict: 'not_guilty', tally, lines: [], arguments: [], ledgers: [], ...extra });

describe('the verdict', () => {
  it('measures the verdict against the evidence presented', () => {
    expect(build().evidence.standing).toBe('supported');
    expect(build({ verdict: 'guilty' }).evidence.standing).toBe('unsupported');
    expect(build({ verdict: 'hung' }).evidence.standing).toBe('unresolved');
  });

  it('names the heaviest doubts nobody raised', () => {
    const { evidence } = build({ lines: [line(1, { points: ['n8'] })] });
    expect(evidence.raised).toBe(1);
    expect(evidence.unraised).toHaveLength(3);
    expect(evidence.unraised).not.toContain('Nobody can identify a voice through a freezer door beside compressors');
  });
});

describe('the truth stays out of it', () => {
  it('gives the same debrief whatever really happened', () => {
    const other = { ...trial, truth: { beats: ['Someone else did it.'], closing: 'Nothing.' } };
    const input = { verdict: 'not_guilty' as const, tally, lines: [line(1)], arguments: [], ledgers: [ledger(1)] };
    expect(buildDebrief({ ...input, trial: other })).toEqual(buildDebrief({ ...input, trial }));
  });

  it('never tells the player they were right or wrong', () => {
    for (const verdict of ['guilty', 'not_guilty', 'hung'] as const) {
      const words = JSON.stringify(build({ verdict, ledgers: [ledger(1)], lines: [line(1)] }));
      expect(words).not.toMatch(/\b(correct|incorrect|wrong|mistake|failed|right answer|you were right)\b/i);
    }
  });
});

describe('your influence', () => {
  it('counts a juror you moved most of the way', () => {
    const { influence } = build({ ledgers: [ledger(6)], lines: [line(6, { text: 'Those compressors.' })] });
    expect(influence.swayed).toMatchObject([{ juror: 6, from: 'guilty', to: 'not_guilty', quote: 'Those compressors.' }]);
  });

  it("doesn't credit you with a juror the room moved", () => {
    const moved = { person: -2, jurors: -4, room: -30, self: 0 };
    const { influence } = build({ ledgers: [ledger(7, { moved })] });
    expect(influence.swayed).toEqual([]);
    expect(influence.movedByOthers).toMatchObject([{ juror: 7, by: 'the pressure of the count' }]);
  });

  it('notices a juror you shook who held their vote', () => {
    const { influence } = build({ ledgers: [ledger(3, { finalVote: 'guilty', moved: { person: -9, jurors: 0, room: 0, self: 0 } })] });
    expect(influence.swayed).toEqual([]);
    expect(influence.shaken).toMatchObject([{ juror: 3 }]);
  });

  it('finds your strongest argument by how far it moved the room', () => {
    const { influence } = build({
      arguments: [
        { id: '1', text: 'Weak.', points: ['n7'], fabricated: false },
        { id: '2', text: 'The glove.', points: ['n10'], fabricated: false },
      ],
      ledgers: [
        ledger(1, { byArgument: { '1': -1, '2': -6 } }),
        ledger(2, { byArgument: { '2': -4 } }),
      ],
    });
    expect(influence.strongest).toEqual({ text: 'The glove.', jurorsMoved: 2 });
  });

  it('has nothing to credit if you never argued', () => {
    expect(build().influence.strongest).toBeNull();
  });
});

describe('the room', () => {
  it('counts a prejudicial point as bias, whatever the speaker said it was', () => {
    const { deliberation, room } = build({
      lines: [line(10, { points: ['g8'], text: 'Once a thug.', vote: 'guilty' }), line(3, { basis: 'emotion', text: 'He said it!' })],
    });
    expect(deliberation.bias).toBe(1);
    expect(room.biased).toMatchObject([{ name: 'Clive Pruitt', text: 'Once a thug.' }]);
    expect(room.emotional).toMatchObject([{ name: 'Gus Rourke' }]);
  });
});
