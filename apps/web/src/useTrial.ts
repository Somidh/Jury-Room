// Plays the bailiff's events onto the stage. The order and the words come from the room.
// This only decides how long a moment holds, so a line can be read before the next one.
import { useEffect, useReducer, useRef } from 'react';
import { applyEvent, emptyTrial, holdFor, type TrialEvent, type TrialView } from './trial';

type Incoming = TrialEvent | { type: 'caught-up' };

export function useTrial(): TrialView {
  const [view, dispatch] = useReducer(applyEvent, emptyTrial);
  const heat = useRef(0);
  heat.current = view.heat;

  useEffect(() => {
    const queue: { event: TrialEvent; staged: boolean }[] = [];
    let live = false;
    let playing = false;
    let closed = false;

    async function play() {
      if (playing) return;
      playing = true;
      while (queue.length && !closed) {
        const { event, staged } = queue.shift()!;
        dispatch(event);
        if (staged) await new Promise((resolve) => setTimeout(resolve, holdFor(event, heat.current)));
      }
      playing = false;
    }

    const source = new EventSource('/api/events');
    source.onopen = () => {
      live = false;
      queue.length = 0;
      dispatch({ type: 'reset' });
    };
    source.onmessage = (message) => {
      const incoming = JSON.parse(message.data as string) as Incoming;
      if (incoming.type === 'caught-up') {
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

  return view;
}
