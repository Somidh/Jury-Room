import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hear, nextVote, openingState } from './belief';
import { CASE_IDS } from './cases';
import { CAST } from './cast';
import type { Case } from './types';

const load = (id: string) =>
  JSON.parse(readFileSync(new URL(`../../../cases/${id}.json`, import.meta.url), 'utf8')) as Case;

const TEASER_WORDS = 40;

describe('the case list', () => {
  it('lists every file in cases/', () => {
    const files = readdirSync(new URL('../../../cases/', import.meta.url)).map((file) => file.replace('.json', ''));
    expect([...CASE_IDS].sort()).toEqual(files.sort());
  });
});

describe.each(CASE_IDS.map((id) => [id, load(id)] as const))('%s', (id, trial) => {
  it('is a whole case', () => {
    expect(trial.id).toBe(id);
    for (const text of [trial.kind, trial.title, trial.charge, trial.teaser, trial.summary, trial.record.reason, trial.truth.closing]) {
      expect(text.trim()).not.toBe('');
    }
    expect(trial.evidence.length).toBeGreaterThanOrEqual(6);
    expect(trial.witnesses.length).toBeGreaterThanOrEqual(3);
    expect(trial.truth.beats.length).toBeGreaterThanOrEqual(5);
  });

  it('keeps the teaser short', () => {
    expect(trial.teaser.split(/\s+/).length).toBeLessThanOrEqual(TEASER_WORDS);
  });

  it('ties every point and focus to something in the file', () => {
    const known = new Set([...trial.evidence, ...trial.witnesses].map((item) => item.id));
    expect(known.size).toBe(trial.evidence.length + trial.witnesses.length);
    for (const point of trial.points) expect(known, point.id).toContain(point.evidenceId);
    for (const ids of Object.values(trial.focus)) for (const item of ids) expect(known, item).toContain(item);
  });

  it('uses each point id once', () => {
    const ids = trial.points.map((point) => point.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tells every juror what to dwell on', () => {
    for (const { id: juror } of CAST) {
      expect(trial.fixations[String(juror)]?.trim(), `juror ${juror}`).toBeTruthy();
      expect(trial.focus[String(juror)], `juror ${juror}`).toBeDefined();
    }
  });

  it('gives both sides something to argue, and bias something to cling to', () => {
    const side = (pushes: string) => trial.points.filter((point) => point.pushes === pushes);
    expect(side('guilty').length).toBeGreaterThanOrEqual(7);
    expect(side('not_guilty').length).toBeGreaterThanOrEqual(7);
    expect(trial.points.some((point) => point.prejudicial)).toBe(true);
  });

  it('opens with a real argument, not a settled room', () => {
    const votes = CAST.map((profile) => openingState(profile, trial.openingLean).vote);
    expect(votes.filter((vote) => vote === 'guilty').length).toBeGreaterThanOrEqual(3);
    expect(votes.filter((vote) => vote === 'not_guilty').length).toBeGreaterThanOrEqual(1);
  });

  it('never lets one point, however often repeated, carry anyone across', () => {
    for (const profile of CAST) {
      for (const point of trial.points) {
        let state = openingState(profile, trial.openingLean);
        const start = state.vote;
        for (let time = 0; time < 30; time += 1) {
          state = hear(state, profile, { speaker: 'human', pointIds: [point.id], quality: 1, target: profile.id }, trial);
          state = { ...state, vote: nextVote(state.vote, state.belief) };
        }
        // A juror who opens a hair from the line can go grey, but never crosses on one point.
        if (Math.abs(profile.openingBelief + (trial.openingLean ?? 0) - 50) > 12) {
          const crossed = state.vote !== 'undecided' && state.vote !== start;
          expect(crossed, `#${profile.id} on ${point.id} ended at ${state.belief}`).toBe(false);
        }
      }
    }
  });
});
