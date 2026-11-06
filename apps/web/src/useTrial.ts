// Plays the bailiff's events onto the stage. The order and the words come from the room.
// This only decides how long a moment holds, so a line can be read before the next one.
import { useEffect, useReducer, useRef } from 'react';
import { applyEvent, emptyTrial, holdFor, type TrialEvent, type TrialView } from './trial';

type Incoming = TrialEvent | { type: 'caught-up' };

const TICK_MS = 50;

export function useTrial(): {
  view: TrialView;
  setHand: (up: boolean) => void;
  stepForward: () => void;
} {
  const [view, dispatch] = useReducer(applyEvent, emptyTrial);
  const heat = useRef(0);
  heat.current = view.heat;

  useEffect(() => {
    const queue: { event: TrialEvent; staged: boolean }[] = [];
    let live = false;
    let playing = false;
    let closed = false;
    /** Paused, so nothing new reaches the stage. A line already on its way waits here. */
    let frozen = false;
    /** Changes when the stage is cleared, so a moment from an old trial stops holding it. */
    let scene = 0;

    /** A moment on stage. Its clock stops while the game is paused. */
    async function holdStage(ms: number) {
      const started = scene;
      let left = ms;
      while (!closed && scene === started && (left > 0 || frozen)) {
        await new Promise((resolve) => setTimeout(resolve, TICK_MS));
        if (!frozen) left -= TICK_MS;
      }
    }

    async function play() {
      if (playing) return;
      playing = true;
      while (queue.length && !closed) {
        const { event, staged } = queue.shift()!;
        dispatch(event);
        if (staged) await holdStage(holdFor(event, heat.current));
      }
      playing = false;
    }

    const source = new EventSource('/api/events');
    source.onopen = () => {
      live = false;
      frozen = false;
      queue.length = 0;
      dispatch({ type: 'reset' });
    };
    source.onmessage = (message) => {
      const incoming = JSON.parse(message.data as string) as Incoming;
      // These answer the person at once, ahead of the lines still playing.
      if (incoming.type === 'hand.raised' || incoming.type === 'pace') {
        dispatch(incoming);
      } else if (incoming.type === 'paused' || incoming.type === 'resumed') {
        frozen = incoming.type === 'paused';
        dispatch(incoming);
      } else if (incoming.type === 'desk') {
        queue.length = 0;
        frozen = false;
        scene += 1;
        dispatch(incoming);
      } else if (incoming.type === 'caught-up') {
        live = true;
        queue.push({ event: { type: 'live' }, staged: false });
      } else {
        queue.push({ event: incoming, staged: live });
      }
      void play();
    };
    return () => {
      closed = true;
      source.close();
    };
  }, []);

  return {
    view,
    setHand: (up) => dispatch({ type: up ? 'hand.raised' : 'hand.lowered' }),
    stepForward: () => dispatch({ type: 'continued' }),
  };
}
