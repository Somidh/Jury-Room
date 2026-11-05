import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAST } from '@jury/core';
import type { AgentCredentials, AgentDefinition } from '@jury/switch-client';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const ROOM_NAME = 'jury-room';

export const ROOM_DESCRIPTION = 'Eleven AI jurors and one person deliberate a case.';

export const ROOM_INSTRUCTIONS = [
  'This is a jury room. Eleven agents are jurors and one person is Juror 12.',
  'The case file is a room document.',
  'Jurors speak only when the bailiff gives them the floor.',
  'Every agent message ends with a [jury v1 ...] line, which code reads.',
  'To play from chat, just talk and use jurors\' names, without an @. To call a vote, write: call a vote.',
].join(' ');

export const jurorAgentName = (id: number) => `juror-${id}`;

export const BAILIFF: AgentDefinition = {
  name: 'bailiff',
  displayName: 'The Bailiff',
  description: 'Gives jurors the floor one at a time and runs the votes.',
};

export const JURORS: AgentDefinition[] = CAST.map((juror) => ({
  name: jurorAgentName(juror.id),
  displayName: `Juror ${juror.id} · ${juror.name}`,
  description: `${juror.archetype} on the jury.`,
}));

export const TEAM: AgentDefinition[] = [BAILIFF, ...JURORS];

export type StoredAgent = AgentCredentials & { connectionId: string };

export type TeamStore = {
  roomId?: string;
  gateRoomId?: string;
  agents: Record<string, StoredAgent>;
};

const storePath = join(repoRoot, '.agents.local.json');

export function readTeamStore(): TeamStore {
  if (!existsSync(storePath)) return { agents: {} };
  return JSON.parse(readFileSync(storePath, 'utf8')) as TeamStore;
}

export function writeTeamStore(store: TeamStore): void {
  writeFileSync(storePath, JSON.stringify(store, null, 2), { mode: 0o600 });
}
