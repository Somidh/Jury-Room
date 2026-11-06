// The web room. The browser only mirrors what the bailiff reports. Anything the person says
// goes through Mattermost, so a button press reaches the room like a typed message. Continue
// and Pause aren't said to anyone, so they go straight to the bailiff.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { CAST } from '@jury/core';
import type { TrialEvent } from './agents/bailiff';
import { TrialAbandoned } from './agents/pace';
import { openCourt } from './court';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_TURNS = process.env.JURY_MAX_TURNS ? Number(process.env.JURY_MAX_TURNS) : undefined;
const MAX_MESSAGE_LENGTH = 1000;

// Kept whole, so a refreshed page replays the trial and lands in the same place.
let history: TrialEvent[] = [];
let running = false;
/** The trial under way, or the one just finished, until the person returns to the desk. */
let currentCase: string | null = null;
let trialRun: Promise<void> | null = null;
/** The person's choice, kept from one trial to the next. */
let stepping = true;
const listeners = new Set<(event: TrialEvent) => void>();

function publish(event: TrialEvent): void {
  history.push(event);
  for (const listener of listeners) listener(event);
}

const jurorIds = process.env.JURY_CAST?.split(',').map(Number);
const court = await openCourt({ jurorIds, onEvent: publish });

function startTrial(caseId: string): void {
  running = true;
  currentCase = caseId;
  history = [];
  publish({ type: 'selected' });
  trialRun = court
    .runTrial(MAX_TURNS, false, stepping, caseId)
    .then(() => undefined)
    .catch((error: Error) => {
      if (!(error instanceof TrialAbandoned)) console.error(`Trial stopped: ${error.message}`);
    })
    .finally(() => {
      running = false;
    });
}

const app = new Hono();

app.get('/api/jurors', (context) =>
  context.json(CAST.filter(({ id }) => court.jurorIds.includes(id)).map(({ id, name }) => ({ id, name }))),
);

app.get('/api/cases', (context) => context.json(court.cases));

app.post('/api/trial', async (context) => {
  const { caseId } = await context.req.json<{ caseId?: string }>();
  if (!caseId || !court.hasCase(caseId)) return context.json({ error: 'There is no such case.' }, 404);
  if (!running) startTrial(caseId);
  return context.json({ running });
});

// Back to the desk, from a finished trial or one left part way through.
app.post('/api/leave', async (context) => {
  if (running) {
    await court.abandon();
    await trialRun;
  }
  history = [];
  currentCase = null;
  for (const listener of listeners) listener({ type: 'desk' });
  return context.json({ ok: true });
});

// Kept out of the event stream, so a page can't hold it until someone asks to see it.
app.get('/api/truth', (context) => {
  if (running || !currentCase) return context.json({ error: 'The trial is not over.' }, 403);
  return context.json(court.truthOf(currentCase));
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

app.post('/api/continue', (context) => {
  court.pace.advance();
  return context.json({ ok: true });
});

app.post('/api/pause', async (context) => {
  const { paused } = await context.req.json<{ paused?: boolean }>();
  if (paused) court.pace.pause();
  else court.pace.resume();
  return context.json({ paused: court.pace.paused });
});

app.post('/api/stepping', async (context) => {
  const body = await context.req.json<{ stepping?: boolean }>();
  stepping = Boolean(body.stepping);
  court.pace.setStepping(stepping);
  return context.json({ stepping });
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
