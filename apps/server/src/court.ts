// Seats the bailiff and jurors in the room. The terminal and the web server both use this.
import { readFileSync } from 'node:fs';
import { CAST, createLlm, type Case } from '@jury/core';
import { createBailiff, type TrialEvent } from './agents/bailiff';
import { createJuror } from './agents/juror';
import { createHuman } from './human';
import { readTeamStore, ROOM_NAME } from './team';

type Options = {
  jurorIds?: number[];
  onEvent: (event: TrialEvent) => void;
};

export async function openCourt({ jurorIds = CAST.map((juror) => juror.id), onEvent }: Options) {
  const store = readTeamStore();
  if (!store.roomId) throw new Error('No room yet. Run pnpm bootstrap.');

  const trial = JSON.parse(readFileSync(new URL('../../../cases/hale.json', import.meta.url), 'utf8')) as Case;
  const llm = createLlm({
    provider: process.env.LLM_PROVIDER ?? 'gemini',
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL,
  });

  const connection = (name: string) => {
    const stored = store.agents[name]!;
    return {
      apiUrl: process.env.SWITCH_API_URL!,
      id: stored.id,
      apiKey: stored.apiKey,
      connectionId: stored.connectionId,
      roomId: store.roomId,
      log: (line: string) => console.error(`    ${line}`),
    };
  };

  const bailiff = createBailiff(connection('bailiff'), llm, onEvent);
  const jurors = jurorIds.map((id) =>
    createJuror(connection(`juror-${id}`), CAST.find((profile) => profile.id === id)!, llm),
  );
  await bailiff.agent.start();
  await Promise.all(jurors.map((juror) => juror.agent.start()));

  const human = createHuman({
    url: process.env.MATTERMOST_URL ?? 'http://localhost:8065',
    token: process.env.MATTERMOST_TOKEN!,
    channelName: ROOM_NAME,
  });

  return {
    human,
    jurorIds,
    truth: trial.truth,
    runTrial: (maxTurns?: number) => bailiff.run({ trial, jurorIds, maxTurns }),
  };
}
