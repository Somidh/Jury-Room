// Audits the last trial from the Switch room log alone: silence during the briefing, one
// speaker per grant, the room stopping for a raised hand, jurors never running on past an
// opening, and every reply and quote tracing back to something really said in the room.
//   pnpm smoke
import { parseFooter, stripFooter, SwitchAgent } from '@jury/switch-client';
import { isHand, isHuman } from '@jury/server/shared';
import { readTeamStore } from '@jury/server/team';

type Message = { id: string; sender_name: string; body: string };

const store = readTeamStore();
const stored = store.agents.bailiff!;
const agent = new SwitchAgent({
  apiUrl: process.env.SWITCH_API_URL!,
  name: 'bailiff',
  id: stored.id,
  apiKey: stored.apiKey,
  connectionId: stored.connectionId,
  roomId: store.roomId,
  filter: 'all',
});
await agent.start();

type Page = { threads: { root: Message; replies: Message[] }[]; truncated: boolean; oldest_timestamp: number };

const footerOf = (message: Message) => parseFooter(message.body);

/** One read holds 500 entries and a long trial has more, so page back to its start. */
async function readLastTrial(): Promise<Message[]> {
  let messages: Message[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await agent.op<Page>('read_context', { limit: 500, before });
    const older = page.threads.flatMap((thread) => [thread.root, ...thread.replies]);
    const known = new Set(messages.map((message) => message.id));
    messages = [...older.filter((message) => !known.has(message.id)), ...messages];
    const found = older.some((message) => footerOf(message)?.type === 'trial.start');
    if (found || !page.truncated || !older.length) return messages;
    // Switch reports this in milliseconds but only accepts a date string back.
    before = new Date(page.oldest_timestamp).toISOString();
  }
}

const log = await readLastTrial();
const startAt = log.findLastIndex((message) => footerOf(message)?.type === 'trial.start');
if (startAt < 0) throw new Error('No trial in the room log. Run pnpm trial first.');

const trialId = footerOf(log[startAt]!)!.trial;
const messages = log.slice(startAt);
const byId = new Map(log.map((message) => [message.id, message]));
const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]/g, '');

const problems: string[] = [];
let grants = 0;
let spoken = 0;
let passes = 0;
let quotes = 0;
let open: string | null = null;
let began = false;
/** A raised hand can land while a juror is already thinking, so one grant may be in flight. */
const MAX_GRANTS_AFTER_HAND = 1;
const MAX_RUN = 5;
let grantsSinceHand: number | null = null;
let run = 0;
const SPOKEN = new Set(['floor', 'turn', 'pass', 'ballot', 'ballot.call', 'vote.call', 'hand']);

for (const message of messages) {
  if (isHuman(message.sender_name, message.body)) {
    if (began) {
      run = 0;
      if (isHand(stripFooter(message.body)) && grantsSinceHand === null) grantsSinceHand = 0;
    }
    continue;
  }
  const footer = footerOf(message);
  if (footer?.trial !== trialId) continue;
  if (footer.type === 'deliberation') began = true;
  if (footer.type === 'human.turn') grantsSinceHand = null;
  if (footer.type === 'opening') run = 0;
  if (!began && SPOKEN.has(footer.type)) problems.push(`${message.sender_name} broke the briefing silence`);

  if (footer.type === 'floor') {
    run += 1;
    if (run > MAX_RUN) problems.push(`turn ${footer.turn} ran past ${MAX_RUN} jurors with no opening`);
    if (grantsSinceHand !== null) {
      grantsSinceHand += 1;
      if (grantsSinceHand > MAX_GRANTS_AFTER_HAND) problems.push(`turn ${footer.turn} ignored a raised hand`);
    }
    if (open) problems.push(`turn ${open} got no answer before the next grant`);
    open = String(footer.turn);
    grants += 1;
  } else if (footer.type === 'turn' || footer.type === 'pass') {
    if (String(footer.turn) !== open) problems.push(`${message.sender_name} spoke without the floor on turn ${footer.turn}`);
    open = null;
    if (footer.type === 'pass') passes += 1;
    else spoken += 1;
  }
  if (footer.type !== 'turn') continue;

  const target = footer.replyto ? byId.get(String(footer.replyto)) : undefined;
  if (footer.replyto && !target) problems.push(`turn ${footer.turn} replies to a message not in the log`);
  if (footer.quote) {
    quotes += 1;
    const quoted = normalise(String(footer.quote));
    if (!log.some((line) => normalise(stripFooter(line.body)).includes(quoted))) {
      problems.push(`turn ${footer.turn} quotes words nobody said`);
    }
  }
}

const verdict = messages.map(footerOf).find((footer) => footer?.type === 'verdict')?.verdict ?? 'none';
console.log(`Trial ${trialId}: ${grants} grants, ${spoken} lines, ${passes} passes, ${quotes} quotes, verdict ${verdict}`);
for (const problem of problems) console.log(`  PROBLEM: ${problem}`);
console.log(problems.length ? 'FAILED' : 'PASSED: every line traces back to the room log.');
process.exit(problems.length ? 1 : 0);
