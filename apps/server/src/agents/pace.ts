// How fast the room moves for the person reading it. Pause stops everything, and stepping
// makes the room wait for Continue after each juror. Neither is said in the room, so neither
// goes through Switch: they are instructions to the director, not lines in the deliberation.

export type PaceEvent =
  | { type: 'pace'; stepping: boolean }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'continue.wait' }
  | { type: 'continued' };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Thrown at the gate when the person leaves a trial, to unwind the director. */
export class TrialAbandoned extends Error {}

export function createPace(emit: (event: PaceEvent) => void) {
  let stepping = false;
  let paused = false;
  let awaitingContinue = false;
  let abandoned = false;
  const watchers = new Set<() => void>();

  /** Wakes everything waiting on the room, so each waiter can look again. */
  function notify(): void {
    const waiting = [...watchers];
    watchers.clear();
    for (const wake of waiting) wake();
  }

  const nextChange = () => new Promise<void>((resolve) => watchers.add(resolve));

  /** Returns once the room is not paused. Every step the director takes passes through this. */
  async function gate(): Promise<void> {
    for (;;) {
      if (abandoned) throw new TrialAbandoned();
      if (!paused) return;
      await nextChange();
    }
  }

  /** Runs down a wait, and stops the clock for as long as the room is paused. */
  async function hold(ms: number, until: () => boolean = () => false): Promise<void> {
    let left = ms;
    for (;;) {
      await gate();
      if (left <= 0 || until()) return;
      const started = Date.now();
      await Promise.race([sleep(left), nextChange()]);
      left -= Date.now() - started;
    }
  }

  /** Waits for Continue, or for anything else that means the person has stepped in. */
  async function waitForContinue(interrupted: () => boolean): Promise<void> {
    awaitingContinue = true;
    emit({ type: 'continue.wait' });
    for (;;) {
      await gate();
      if (!awaitingContinue || !stepping || interrupted()) break;
      await nextChange();
    }
    awaitingContinue = false;
    emit({ type: 'continued' });
  }

  return {
    gate,
    hold,
    notify,
    nextChange,
    waitForContinue,
    get stepping() {
      return stepping;
    },
    get paused() {
      return paused;
    },

    /** Ignored unless the room is waiting, so a double click can't skip a juror. */
    advance(): void {
      if (!awaitingContinue || paused) return;
      awaitingContinue = false;
      notify();
    },

    pause(): void {
      if (paused) return;
      paused = true;
      emit({ type: 'paused' });
      notify();
    },

    resume(): void {
      if (!paused) return;
      paused = false;
      emit({ type: 'resumed' });
      notify();
    },

    setStepping(value: boolean): void {
      stepping = value;
      emit({ type: 'pace', stepping });
      notify();
    },

    /** Stops the trial at the next gate, wherever it's waiting. */
    abandon(): void {
      abandoned = true;
      notify();
    },

    /** Clears a finished trial. The person's choice of stepping is set by the next one. */
    reset(): void {
      paused = false;
      awaitingContinue = false;
      abandoned = false;
      notify();
    },
  };
}

export type Pace = ReturnType<typeof createPace>;
