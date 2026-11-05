// Registers the 12 agents and sets up #jury-room. Safe to run again.
import { randomUUID } from 'node:crypto';
import { createHuman } from '@jury/server/human';
import {
  BAILIFF,
  readTeamStore,
  ROOM_DESCRIPTION,
  ROOM_INSTRUCTIONS,
  ROOM_NAME,
  TEAM,
  writeTeamStore,
} from '@jury/server/team';
import { registerAgent, SwitchAgent } from '@jury/switch-client';

const apiUrl = process.env.SWITCH_API_URL;
const registrationKey = process.env.SWITCH_REGISTRATION_KEY;
const ownerName = process.env.OWNER_NAME ?? 'user';

if (!apiUrl || !registrationKey) {
  console.error('.env needs SWITCH_API_URL and SWITCH_REGISTRATION_KEY. Run pnpm switch:key.');
  process.exit(1);
}

const store = readTeamStore();
for (const agent of TEAM) {
  if (store.agents[agent.name]) continue;
  store.agents[agent.name] = { ...(await registerAgent(apiUrl, registrationKey, agent)), connectionId: randomUUID() };
  writeTeamStore(store);
  console.log(`Registered ${agent.name}`);
}

const admin = new SwitchAgent({
  apiUrl,
  name: BAILIFF.name,
  id: store.agents[BAILIFF.name]!.id,
  apiKey: store.agents[BAILIFF.name]!.apiKey,
  connectionId: randomUUID(),
});
await admin.start();

if (!store.roomId) {
  const room = await admin.op<{ id: string }>('create_room', {
    name: ROOM_NAME,
    description: ROOM_DESCRIPTION,
    agent_names: TEAM.map((agent) => agent.name),
    user_names: [ownerName],
    channel_type: 'channel_public',
    instructions: ROOM_INSTRUCTIONS,
  });
  store.roomId = room.id;
  writeTeamStore(store);
  console.log(`Created #${ROOM_NAME}`);
}

if (process.env.MATTERMOST_TOKEN) {
  const human = createHuman({
    url: process.env.MATTERMOST_URL ?? 'http://localhost:8065',
    token: process.env.MATTERMOST_TOKEN,
    channelName: ROOM_NAME,
  });
  await human.join();
  console.log(`You're in #${ROOM_NAME}.`);
}

admin.stop();
console.log('Room ready.');
process.exit(0);
