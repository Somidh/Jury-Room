import { describe, expect, it } from 'vitest';
import { applyEvent, emptyTrial, type CaseBrief, type TrialView } from './trial';

const brief: CaseBrief = { title: 'A', charge: 'B', summary: 'C', evidence: [], witnesses: [] };
const stepping: TrialView = { ...emptyTrial, live: true, stepping: true };

describe('moving between trials', () => {
  it('keeps the pace when a briefing lands after it', () => {
    expect(applyEvent(stepping, { type: 'brief', brief }).stepping).toBe(true);
  });

  it('keeps the pace through the desk and the next pick', () => {
    const desk = applyEvent(stepping, { type: 'desk' });
    expect(desk.phase).toBe('choosing');
    expect(applyEvent(desk, { type: 'selected' }).stepping).toBe(true);
  });

  it('shows the desk only once it knows no trial is running', () => {
    expect(applyEvent(emptyTrial, { type: 'live' }).phase).toBe('choosing');
    const picked = applyEvent(emptyTrial, { type: 'selected' });
    expect(applyEvent(picked, { type: 'live' }).phase).toBe('waiting');
  });

  it('leaves nothing of the last trial behind', () => {
    const left = applyEvent({ ...stepping, paused: true, canContinue: true, myVote: 'guilty', heat: 1 }, { type: 'desk' });
    expect(left).toMatchObject({ paused: false, canContinue: false, myVote: 'undecided', heat: 0 });
  });
});
