// The web room. The browser only mirrors what the bailiff reports, and anything the person
// does goes through Mattermost, so a button press reaches the room like a typed message.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { CAST } from '@jury/core';
import type { TrialEvent } from './agents/bailiff';
import { openCourt } from './court';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_MESSAGE_LENGTH = 1000;

// Kept whole, so a refreshed page replays the trial and lands in the same place.
let history: TrialEvent[] = [];
let running = false;
const listeners = new Set<(event: TrialEvent) => void>();

function publish(event: TrialEvent): void {
  history.push(event);
  for (const listener of listeners) listener(event);
}

const jurorIds = process.env.JURY_CAST?.split(',').map(Number);
const court = await openCourt({ jurorIds, onEvent: publish });

function startTrial(): void {
  running = true;
  history = [];
  court
    .runTrial()
    .catch((error: Error) => console.error(`Trial stopped: ${error.message}`))
    .finally(() => {
      running = false;
    });
}

const app = new Hono();

app.get('/api/jurors', (context) =>
  context.json(CAST.filter(({ id }) => court.jurorIds.includes(id)).map(({ id, name }) => ({ id, name }))),
);

app.post('/api/trial', (context) => {
  if (!running) startTrial();
  return context.json({ running });
});

// Kept out of the event stream, so a page can't hold it until someone asks to see it.
app.get('/api/truth', (context) => {
  if (running) return context.json({ error: 'The trial is not over.' }, 403);
  return context.json(court.truth);
});

app.post('/api/say', async (context) => {
  const { text } = await context.req.json<{ text?: string }>();
  const message = text?.trim();
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    return context.json({ error: `Write between 1 and ${MAX_MESSAGE_LENGTH} characters.` }, 400);
  }
  await court.human.say(message);
  return context.json({ ok: true });
});

app.get('/api/events', (context) =>
  streamSSE(context, async (stream) => {
    const queue = [...history];
    let wake: (() => void) | null = null;
    const listener = (event: TrialEvent) => {
      queue.push(event);
      wake?.();
    };
    listeners.add(listener);
    // Tells the page the replay is over, so it only stages lines that are happening now.
    let caughtUp = false;
    stream.onAbort(() => {
      listeners.delete(listener);
      wake?.();
    });
    while (!stream.aborted) {
      const event = queue.shift();
      if (event) await stream.writeSSE({ data: JSON.stringify(event) });
      else if (!caughtUp) {
        caughtUp = true;
        await stream.writeSSE({ data: JSON.stringify({ type: 'caught-up' }) });
      } else await new Promise<void>((resolve) => (wake = resolve));
    }
  }),
);

app.use('/*', serveStatic({ root: './apps/web/dist' }));

serve({ fetch: app.fetch, port: PORT }, () => console.log(`The jury room is open at http://localhost:${PORT}`));
