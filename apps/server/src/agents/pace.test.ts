import { describe, expect, it } from 'vitest';
import { createPace, TrialAbandoned, type PaceEvent } from './pace';

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

function setUp() {
  const events: PaceEvent['type'][] = [];
  const pace = createPace((event) => events.push(event.type));
  pace.setStepping(true);
  return { pace, events };
}

function watch(promise: Promise<void>) {
  const state = { done: false };
  void promise.then(() => (state.done = true));
  return state;
}

describe('continue', () => {
  it('waits for as long as it takes', async () => {
    const { pace } = setUp();
    const wait = watch(pace.waitForContinue(() => false));
    await tick(30);
    expect(wait.done).toBe(false);
    pace.advance();
    await tick();
    expect(wait.done).toBe(true);
  });

  it('cannot skip the next juror with a click that lands early', async () => {
    const { pace } = setUp();
    pace.advance();
    const wait = watch(pace.waitForContinue(() => false));
    await tick();
    expect(wait.done).toBe(false);
  });

  it('gives way to a raised hand without needing a click', async () => {
    const { pace } = setUp();
    let handUp = false;
    const wait = watch(pace.waitForContinue(() => handUp));
    await tick();
    handUp = true;
    pace.notify();
    await tick();
    expect(wait.done).toBe(true);
  });

  it('stops waiting if the person switches stepping off', async () => {
    const { pace } = setUp();
    const wait = watch(pace.waitForContinue(() => false));
    await tick();
    pace.setStepping(false);
    await tick();
    expect(wait.done).toBe(true);
  });

  it('does nothing while paused', async () => {
    const { pace } = setUp();
    const wait = watch(pace.waitForContinue(() => false));
    pace.pause();
    pace.advance();
    await tick();
    expect(wait.done).toBe(false);
    pace.resume();
    await tick();
    expect(wait.done).toBe(false);
    pace.advance();
    await tick();
    expect(wait.done).toBe(true);
  });
});

describe('leaving a trial', () => {
  it('unwinds a room waiting for Continue', async () => {
    const { pace } = setUp();
    const wait = pace.waitForContinue(() => false);
    await tick();
    pace.abandon();
    await expect(wait).rejects.toBeInstanceOf(TrialAbandoned);
  });

  it('unwinds a paused room', async () => {
    const { pace } = setUp();
    pace.pause();
    const gate = pace.gate();
    pace.abandon();
    await expect(gate).rejects.toBeInstanceOf(TrialAbandoned);
  });

  it('leaves the next trial free to run', async () => {
    const { pace } = setUp();
    pace.abandon();
    pace.reset();
    await expect(pace.gate()).resolves.toBeUndefined();
  });
});

describe('pause', () => {
  it('holds the room at the gate until resume', async () => {
    const { pace } = setUp();
    pace.pause();
    const gate = watch(pace.gate());
    await tick(20);
    expect(gate.done).toBe(false);
    pace.resume();
    await tick();
    expect(gate.done).toBe(true);
  });

  it('stops the clock, so time paused is not time spent', async () => {
    const { pace } = setUp();
    const hold = watch(pace.hold(60));
    await tick(20);
    pace.pause();
    await tick(120);
    expect(hold.done).toBe(false);
    pace.resume();
    await tick(10);
    expect(hold.done).toBe(false);
    await tick(70);
    expect(hold.done).toBe(true);
  });

  it('keeps a raised hand waiting until resume', async () => {
    const { pace } = setUp();
    let handUp = false;
    const wait = watch(pace.waitForContinue(() => handUp));
    await tick();
    pace.pause();
    handUp = true;
    pace.notify();
    await tick();
    expect(wait.done).toBe(false);
    pace.resume();
    await tick();
    expect(wait.done).toBe(true);
  });

  it('reports each change once', () => {
    const { pace, events } = setUp();
    pace.pause();
    pace.pause();
    pace.resume();
    pace.resume();
    expect(events.filter((type) => type === 'paused')).toHaveLength(1);
    expect(events.filter((type) => type === 'resumed')).toHaveLength(1);
  });
});
