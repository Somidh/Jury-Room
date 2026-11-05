// Gate 1: proves the risky Switch assumptions with 12 real agents, before any
// juror logic is built on them. Uses its own room, #jury-gate1. Safe to run again.
import { randomUUID } from 'node:crypto';
import { BAILIFF, JURORS, readTeamStore, TEAM, writeTeamStore } from '@jury/server/team';
import {
  formatFooter,
  parseFooter,
  registerAgent,
  SwitchAgent,
  type RoomMessage,
} from '@jury/switch-client';

const GATE_ROOM = 'jury-gate1';
const GRANTS = 40;
const RUN = randomUUID().slice(0, 8);
const REPLY_TIMEOUT_MS = 15_000;
const DELIVERY_TIMEOUT_MS = 10_000;

const apiUrl = process.env.SWITCH_API_URL;
const registrationKey = process.env.SWITCH_REGISTRATION_KEY;
const ownerName = process.env.OWNER_NAME ?? 'user';
const mattermostUrl = process.env.MATTERMOST_URL ?? 'http://localhost:8065';
const mattermostToken = process.env.MATTERMOST_TOKEN;

if (!apiUrl || !registrationKey) {
  console.error('.env needs SWITCH_API_URL and SWITCH_REGISTRATION_KEY.');
  process.exit(1);
}

const results: { check: string; status: 'PASS' | 'FAIL' | 'SKIP'; detail: string }[] = [];
const record = (check: string, status: 'PASS' | 'FAIL' | 'SKIP', detail: string) => {
  results.push({ check, status, detail });
  console.log(`${status}  ${check}: ${detail}`);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await sleep(25);
  }
  return condition();
}

// Register, skipping agents that already have keys.
const store = readTeamStore();
for (const agent of TEAM) {
  if (store.agents[agent.name]) continue;
  const credentials = await registerAgent(apiUrl, registrationKey, agent);
  store.agents[agent.name] = { ...credentials, connectionId: randomUUID() };
  writeTeamStore(store);
  console.log(`Registered ${agent.name}`);
}

const connection = (name: string) => {
  const stored = store.agents[name]!;
  return { apiUrl, name, id: stored.id, apiKey: stored.apiKey, connectionId: stored.connectionId };
};

// Everyone has to be in the room when it's created, so they don't miss events.
if (!store.gateRoomId) {
  const admin = new SwitchAgent({ ...connection(BAILIFF.name), connectionId: randomUUID() });
  await admin.start();
  const room = await admin.op<{ id: string }>('create_room', {
    name: GATE_ROOM,
    description: 'Gate 1 test room.',
    agent_names: TEAM.map((agent) => agent.name),
    user_names: [ownerName],
    channel_type: 'channel_public',
    instructions: 'Test room for the Jury Room.',
  });
  store.gateRoomId = room.id;
  writeTeamStore(store);
  admin.stop();
  console.log(`Created #${GATE_ROOM}`);
}
const roomId = store.gateRoomId;

// Connect all 12 with filter=all, recording what each one hears.
const heard = new Map<string, RoomMessage[]>(TEAM.map((agent) => [agent.name, []]));
const agents = new Map<string, SwitchAgent>();

for (const definition of TEAM) {
  const agent = new SwitchAgent({
    ...connection(definition.name),
    roomId,
    filter: 'all',
    log: console.log,
    onMessage: async (message) => {
      heard.get(definition.name)!.push(message);
      const footer = parseFooter(message.body);
      // The rule under test: act only on a floor grant addressed to you.
      if (definition.name === BAILIFF.name || footer?.type !== 'floor' || !message.addressed) return;
      await agent.post(
        formatFooter(`Line ${footer.turn} of ${footer.run} from ${definition.name}.`, {
          type: 'turn',
          turn: footer.turn,
          run: footer.run,
          replyto: message.messageId,
        }),
      );
    },
  });
  agents.set(definition.name, agent);
}
await Promise.all([...agents.values()].map((agent) => agent.start()));
record('Connect', 'PASS', `${agents.size} agents connected with filter=all`);

const bailiff = agents.get(BAILIFF.name)!;

// What the server actually accepts, since the docs don't list these arguments.
const ops = await (
  await fetch(`${apiUrl}/agents/${store.agents[BAILIFF.name]!.id}/ops`, {
    headers: { Authorization: `Bearer ${store.agents[BAILIFF.name]!.apiKey}` },
  })
).json() as { operations: Record<string, { input_schema: { properties?: object } }> };
for (const name of ['read_context', 'send_targeted_message', 'create_room_document', 'load_internal_documents']) {
  console.log(`  ${name}: ${Object.keys(ops.operations[name]?.input_schema.properties ?? {}).join(', ')}`);
}

// Check: a person's message reaches everyone, unaddressed, as a person.
if (mattermostToken) {
  const mm = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${mattermostUrl}/api/v4${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${mattermostToken}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`Mattermost ${path}: ${response.status} ${await response.text()}`);
    return (await response.json()) as T;
  };
  const teams = await mm<{ id: string }[]>('/users/me/teams');
  const channel = await mm<{ id: string }>(`/teams/${teams[0]!.id}/channels/name/${GATE_ROOM}`);
  const marker = `gate1 human check ${randomUUID()}`;
  const startedAt = Date.now();
  await mm('/posts', { method: 'POST', body: JSON.stringify({ channel_id: channel.id, message: marker }) });

  const copies = () =>
    [...heard.values()].map((messages) => messages.find((message) => message.body.includes(marker)));
  const arrived = await until(() => copies().every(Boolean), DELIVERY_TIMEOUT_MS);
  const received = copies().filter(Boolean) as RoomMessage[];
  const unaddressed = received.every((message) => !message.addressed);
  const agentIds = new Set(
    [...heard.values()].flat().filter((message) => parseFooter(message.body)).map((message) => message.sender),
  );
  const asPerson = received.every((message) => !agentIds.has(message.sender));
  record(
    'Human post',
    arrived && unaddressed ? 'PASS' : 'FAIL',
    `${received.length}/12 received in ${Date.now() - startedAt} ms, unaddressed=${unaddressed}, ` +
      `not an agent sender=${asPerson}, sender=${received[0]?.senderName}`,
  );
} else {
  record('Human post', 'SKIP', 'MATTERMOST_TOKEN is not set');
}

// Check: sustained single-floor traffic, with no person involved.
const delays: number[] = [];
const statuses = new Set<string>();
let missed = 0;

for (let turn = 1; turn <= GRANTS; turn += 1) {
  const juror = JURORS[(turn * 7) % JURORS.length]!;
  const startedAt = Date.now();
  const result = await bailiff.op<{ target_statuses?: Record<string, string> }>('send_targeted_message', {
    body: formatFooter(`The bailiff looks to ${juror.displayName}.`, { type: 'floor', turn, run: RUN }),
    target_names: [juror.name],
    thread_id: null,
  });
  Object.values(result.target_statuses ?? {}).forEach((status) => statuses.add(status));

  const replied = () =>
    heard.get(BAILIFF.name)!.some((message) => {
      const footer = parseFooter(message.body);
      return footer?.type === 'turn' && footer.run === RUN && footer.turn === String(turn);
    });
  if (await until(replied, REPLY_TIMEOUT_MS)) delays.push(Date.now() - startedAt);
  else missed += 1;
}

const sorted = [...delays].sort((a, b) => a - b);
const percentile = (share: number) => sorted[Math.floor((sorted.length - 1) * share)] ?? 0;
record(
  'Floor grants',
  missed === 0 ? 'PASS' : 'FAIL',
  `${delays.length}/${GRANTS} answered, round trip p50 ${percentile(0.5)} ms, p95 ${percentile(0.95)} ms, ` +
    `target statuses: ${[...statuses].join(', ') || 'none'}`,
);

// Check: only the granted juror spoke, once per grant.
await sleep(1000);
const isLine = (message: RoomMessage) => {
  const footer = parseFooter(message.body);
  return footer?.type === 'turn' && footer.run === RUN;
};
const lines = heard.get(BAILIFF.name)!.filter(isLine);
const perTurn = new Map<string, number>();
for (const line of lines) {
  const turn = String(parseFooter(line.body)!.turn);
  perTurn.set(turn, (perTurn.get(turn) ?? 0) + 1);
}
const doubled = [...perTurn.values()].filter((count) => count > 1).length;
record('One speaker', doubled === 0 && lines.length === GRANTS ? 'PASS' : 'FAIL', `${lines.length} lines, ${doubled} grants got more than one reply`);

// Check: every juror heard every other juror's lines, in the same order.
const hearsOwn = JURORS.filter((agent) =>
  heard.get(agent.name)!.some((message) => isLine(message) && message.senderName === agent.name),
).length;
const matching = JURORS.filter((agent) => {
  const others = (messages: RoomMessage[]) =>
    messages.filter((message) => isLine(message) && message.senderName !== agent.name).map((message) => message.messageId).join();
  return others(heard.get(agent.name)!) === others(lines);
}).length;
record('Same order', matching === JURORS.length ? 'PASS' : 'FAIL', `${matching}/${JURORS.length} jurors match the bailiff, ${hearsOwn} hear their own posts`);

// Check: read_context returns this run's lines, complete and in order.
type Context = { threads: { root: { body: string } }[]; truncated: boolean };
const byDefault = await bailiff.op<Context>('read_context', {});
const context = await bailiff.op<Context>('read_context', { limit: 500 });
const turns = context.threads
  .map((thread) => parseFooter(thread.root.body))
  .filter((footer) => footer?.type === 'turn' && footer.run === RUN)
  .map((footer) => Number(footer!.turn));
const inOrder = turns.every((turn, index) => index === 0 || turn > turns[index - 1]!);
record(
  'read_context',
  turns.length === GRANTS && inOrder ? 'PASS' : 'FAIL',
  `limit=500: ${turns.length}/${GRANTS} lines, in order=${inOrder}, ${context.threads.length} threads, truncated=${context.truncated}. ` +
    `No limit: ${byDefault.threads.length} threads, truncated=${byDefault.truncated}`,
);

for (const agent of agents.values()) agent.stop();

console.log('\n--- Gate 1 ---');
for (const result of results) console.log(`${result.status}  ${result.check}`);
const failed = results.some((result) => result.status === 'FAIL');
console.log(failed ? '\nGate 1 FAILED.' : '\nGate 1 passed, apart from anything marked SKIP.');
process.exit(failed ? 1 : 0);
