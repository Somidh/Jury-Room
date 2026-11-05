import { CAST, type Case, type Vote } from '@jury/core';
import {
  parseFooter,
  stripFooter,
  stripMentions,
  type AgentOptions,
  type SwitchAgent,
} from '@jury/switch-client';

export type Connection = Omit<AgentOptions, 'name' | 'onMessage' | 'filter'>;

export const HUMAN_SEAT = 12;
export const CONTEXT_LIMIT = 500;
const TRANSCRIPT_LINES = 30;

/** juror-4 to 4. Agent names are ours, so this isn't parsing a Switch id. */
export function jurorId(senderName: string): number | null {
  const match = /^juror-(\d+)$/.exec(senderName);
  return match ? Number(match[1]) : null;
}

export async function createCaseDocument(agent: SwitchAgent, trialId: string, trial: Case) {
  // Points stay in the file: jurors tag their lines against them, and players never see it.
  const { document_id: id } = await agent.op<{ document_id: string }>('create_room_document', {
    name: `case-${trialId}`,
    description: trial.title,
    instructions: `JSON. The case file for trial ${trialId}.`,
    content: JSON.stringify(trial),
  });
  return id;
}

export async function readCaseDocument(agent: SwitchAgent, id: string): Promise<Case> {
  const documents = await agent.op<{ content: string }[]>('load_internal_documents', { ids: [id] });
  const content = documents[0]?.content;
  if (!content) throw new Error(`Case document ${id} is empty.`);
  return JSON.parse(content) as Case;
}

export type RoomLine = {
  id: string;
  speaker: number | 'human' | 'stage';
  label: string;
  text: string;
};

type Context = {
  threads: {
    root: ContextMessage;
    replies: ContextMessage[];
  }[];
};
type ContextMessage = { id: string; sender_name: string; body: string };

const agentNames = new Set(['bailiff', ...CAST.map((juror) => `juror-${juror.id}`)]);
const SYSTEM_NAMES = new Set(['switch-admin', 'system-bot', 'admin']);
const NOTICE = /^(📄|🗑)/u;

/** True for a message a person typed, rather than an agent or Switch itself. */
export function isHuman(senderName: string, body: string): boolean {
  return !agentNames.has(senderName) && !SYSTEM_NAMES.has(senderName) && !NOTICE.test(body);
}

function toLine(message: ContextMessage): RoomLine | null {
  const footer = parseFooter(message.body);
  const text = stripMentions(stripFooter(message.body));
  if (!text) return null;

  const juror = jurorId(message.sender_name);
  if (juror !== null && footer?.type === 'turn') {
    const name = CAST.find((profile) => profile.id === juror)?.name ?? '';
    return { id: message.id, speaker: juror, label: `Juror ${juror} (${name})`, text };
  }
  if (footer?.type === 'hand' || footer?.type === 'vote.result') {
    return { id: message.id, speaker: 'stage', label: 'In the room', text };
  }
  if (!footer && isHuman(message.sender_name, message.body)) {
    return { id: message.id, speaker: 'human', label: `Juror ${HUMAN_SEAT} (a person)`, text };
  }
  return null;
}

/** This trial's lines, read back from the room log. */
export async function readTranscript(agent: SwitchAgent, trialId: string): Promise<RoomLine[]> {
  const { threads } = await agent.op<Context>('read_context', { limit: CONTEXT_LIMIT });
  const messages = threads.flatMap((thread) => [thread.root, ...thread.replies]);
  const start = messages.findIndex((message) => {
    const footer = parseFooter(message.body);
    return footer?.type === 'trial.start' && footer.trial === trialId;
  });
  if (start < 0) throw new Error(`Trial ${trialId} is not in the room log.`);
  return messages
    .slice(start + 1)
    .map(toLine)
    .filter((line): line is RoomLine => line !== null)
    .slice(-TRANSCRIPT_LINES);
}

export const voteWords: Record<Vote, string> = {
  guilty: 'guilty',
  not_guilty: 'not guilty',
  undecided: 'undecided',
};
