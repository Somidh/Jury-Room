import {
  applyOwnShift,
  feelTheRoom,
  hear,
  nextVote,
  openingState,
  type Argument,
  type Case,
  type JurorProfile,
  type JurorState,
  type Llm,
  type Tactic,
  type Vote,
} from '@jury/core';
import { formatFooter, parseFooter, SwitchAgent, type Footer, type RoomMessage } from '@jury/switch-client';
import { z } from 'zod';
import { jurorPrompt, PREAMBLE } from '../jurors';
import {
  HUMAN_SEAT,
  jurorId,
  readCaseDocument,
  readTranscript,
  voteWords,
  type Connection,
  type RoomLine,
} from './shared';

const TACTICS = ['logic', 'evidence', 'social', 'emotional', 'fatigue'] as const;
const MAX_WORDS = 45;
const HARD_WORD_LIMIT = 60;
const MAX_POINTS = 2;
const THINK_TIMEOUT_MS = 22_000;

const Reply = z.object({
  line: z.string().min(1),
  addressedTo: z.number().int().nullable(),
  quote: z.string().nullable(),
  points: z.array(z.string()),
  tactic: z.enum(TACTICS),
  mood: z.string(),
  shift: z.number(),
  shiftReason: z.string(),
  grudge: z.number().int().nullable(),
});
type Reply = z.infer<typeof Reply>;

const BALLOT_LINES: Record<Vote, string> = {
  guilty: 'Guilty.',
  not_guilty: 'Not guilty.',
  undecided: "I can't say yet.",
};

function describeBelief(belief: number): string {
  if (belief >= 85) return 'You are certain he did it.';
  if (belief >= 65) return 'You think he did it.';
  if (belief >= 55) return 'You lean toward guilty, without much comfort.';
  if (belief >= 45) return "You honestly don't know any more.";
  if (belief >= 35) return 'You lean toward not guilty, and it unsettles you.';
  return 'You do not believe the state proved it.';
}

const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

function timeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('thinking timed out')), ms)),
  ]);
}

/** One juror. It knows only what its own socket delivers, plus its private state. */
export function createJuror(connection: Connection, profile: JurorProfile, llm: Llm) {
  const name = `juror-${profile.id}`;
  const persona = jurorPrompt(profile.id);
  const agent = new SwitchAgent({ ...connection, name, filter: 'all', onMessage });

  let trial: Case | null = null;
  let trialId = '';
  let state: JurorState = openingState(profile);
  let mood = 'settled';
  let handRaised = false;
  const reasons: string[] = [];
  const log = (line: string) => connection.log?.(`[${name}] ${line}`);

  function raiseHandIfMoved(): void {
    if (handRaised || nextVote(state.vote, state.belief) === state.vote) return;
    handRaised = true;
    void agent
      .post(formatFooter(`Juror ${profile.id} shifts in their seat.`, { type: 'hand', trial: trialId, juror: profile.id }))
      .catch((error: Error) => log(error.message));
  }

  function heardArgument(argument: Argument): void {
    if (!trial) return;
    state = hear(state, profile, argument, trial);
    raiseHandIfMoved();
  }

  function onTurn(message: RoomMessage, footer: Footer): void {
    const speaker = jurorId(message.senderName);
    if (speaker === null) return;
    const target = footer.at ? Number(footer.at) : undefined;
    if (Number(footer.grudge) === profile.id && !state.grudges.includes(speaker)) {
      state = { ...state, grudges: [...state.grudges, speaker] };
    }
    heardArgument({
      speaker,
      pointIds: String(footer.points ?? '').split(',').filter(Boolean),
      quality: 0.7,
      tactic: footer.tactic as Tactic | undefined,
      target,
    });
  }

  function onClerk(footer: Footer): void {
    heardArgument({
      speaker: 'human',
      pointIds: String(footer.points ?? '').split(',').filter(Boolean),
      quality: Number(footer.quality ?? 0),
      tactic: footer.tactic as Tactic | undefined,
      target: footer.target ? Number(footer.target) : undefined,
      fabricated: footer.fabricated === 'true',
    });
  }

  async function onTrialStart(footer: Footer): Promise<void> {
    trialId = String(footer.trial);
    state = openingState(profile);
    mood = 'settled';
    handRaised = false;
    reasons.length = 0;
    trial = await readCaseDocument(agent, String(footer.doc));
  }

  function buildPrompt(lines: RoomLine[], pendingVote: Vote, why: string): string {
    const changing = pendingVote !== state.vote;
    const pointList = trial!.points.map((point) => `${point.id}: ${point.claim}`).join('\n');
    const focus = (trial!.focus[String(profile.id)] ?? []).join(', ') || 'whatever the room is doing';
    const transcript = lines.map((line) => `${line.label}: ${line.text}`).join('\n') || '(nobody has spoken yet)';
    const said = lines.filter((line) => line.speaker === profile.id).map((line) => `- ${line.text}`).join('\n');
    return [
      `THE ROOM SO FAR:\n${transcript}`,
      `YOUR PRIVATE STATE (never say these words aloud):
Your last vote: ${voteWords[state.vote]}. ${describeBelief(state.belief)}
Your mood: ${mood}. People who've got under your skin: ${state.grudges.map((id) => `Juror ${id}`).join(', ') || 'nobody'}.
What's been on your mind: ${reasons.slice(-3).join('; ') || 'nothing yet'}.
What you fixate on in this case: ${focus}.`,
      changing
        ? `YOU HAVE CHANGED YOUR MIND. Your vote is now ${voteWords[pendingVote]}. Say so now, in your own way, and say what did it. It should cost you something.`
        : `Your vote is still ${voteWords[state.vote]}. Don't say or imply anything else. ${
            why === 'addressed'
              ? 'Someone just spoke to you. Answer them directly.'
              : why === 'holdout'
                ? 'You are outnumbered. Push back on the room, or admit what is getting to you.'
                : 'It is your moment to speak. Disagree with someone, or raise something nobody has said yet.'
          }`,
      said
        ? `YOU ALREADY SAID THESE. Don't repeat them or their argument. Say something new, go after a different fact, or get personal:\n${said}`
        : '',
      `Reply with JSON only:
{"line": what you say aloud, under ${MAX_WORDS} words,
 "addressedTo": the juror number you're speaking to (${HUMAN_SEAT} for the person), or null,
 "quote": if addressedTo is set, a short phrase copied word for word from that person's most recent line, else null,
 "points": the one or two ids below that your line actually argues, or [],
 "tactic": one of ${TACTICS.join(', ')},
 "mood": one word,
 "shift": how this moment changed your mind, -5 toward innocent to +5 toward guilty, usually 0,
 "shiftReason": a few private words on why,
 "grudge": the juror number who just insulted you, or null}
POINTS:
${pointList}`,
    ].filter(Boolean).join('\n\n');
  }

  /** Only a line too long to say costs a retry. Free-tier calls are scarce. */
  function validate(reply: Reply): string | null {
    const words = reply.line.split(/\s+/).length;
    return words > HARD_WORD_LIMIT ? `line is ${words} words, the limit is ${MAX_WORDS}` : null;
  }

  /** Keeps a quote only if it's really in that person's last line. */
  function verifiedQuote(reply: Reply, lines: RoomLine[]): string | undefined {
    if (reply.addressedTo === null || !reply.quote) return undefined;
    const seat = reply.addressedTo === HUMAN_SEAT ? 'human' : reply.addressedTo;
    const theirs = lines.filter((line) => line.speaker === seat).at(-1);
    return theirs && normalise(theirs.text).includes(normalise(reply.quote)) ? reply.quote : undefined;
  }

  async function takeFloor(footer: Footer): Promise<void> {
    const pendingVote = nextVote(state.vote, state.belief);
    const fields = { trial: trialId, turn: footer.turn };
    try {
      const lines = await readTranscript(agent, trialId);
      const reply = await timeout(
        llm.generateJson({
          system: `${PREAMBLE}\n\n${persona}\n\nTHE CASE:\n${JSON.stringify({
            title: trial!.title,
            charge: trial!.charge,
            summary: trial!.summary,
            evidence: trial!.evidence,
            witnesses: trial!.witnesses,
          })}`,
          prompt: buildPrompt(lines, pendingVote, String(footer.why)),
          schema: Reply,
          validate,
        }),
        THINK_TIMEOUT_MS,
      );

      const replyTo = lines.filter((line) => line.speaker !== profile.id).at(-1)?.id;
      state = applyOwnShift({ ...state, vote: pendingVote }, profile, reply.shift);
      mood = reply.mood;
      handRaised = false;
      reasons.push(reply.shiftReason);

      const points = reply.points.filter((id) => trial!.points.some((point) => point.id === id));
      await agent.post(
        formatFooter(reply.line.replace(/\\"/g, '"'), {
          type: 'turn',
          ...fields,
          vote: pendingVote,
          mood: reply.mood,
          at: reply.addressedTo ?? undefined,
          points: points.slice(0, MAX_POINTS).join(','),
          tactic: reply.tactic,
          grudge: reply.grudge ?? undefined,
          quote: verifiedQuote(reply, lines),
          replyto: replyTo,
        }),
      );
      raiseHandIfMoved();
    } catch (error) {
      log(`passing: ${(error as Error).message}`);
      await agent.post(formatFooter(`Juror ${profile.id} says nothing.`, { type: 'pass', ...fields }));
    }
  }

  async function castBallot(footer: Footer): Promise<void> {
    await agent.post(
      formatFooter(BALLOT_LINES[state.vote], { type: 'ballot', trial: trialId, round: footer.round, vote: state.vote }),
    );
  }

  async function onMessage(message: RoomMessage): Promise<void> {
    const footer = parseFooter(message.body);
    if (!footer) return;

    if (footer.type === 'trial.start' && message.senderName === 'bailiff') return onTrialStart(footer);
    if (footer.trial !== trialId) return;

    if (footer.type === 'turn') onTurn(message, footer);
    else if (footer.type === 'clerk') onClerk(footer);
    else if (footer.type === 'vote.result') {
      state = feelTheRoom(state, profile, {
        guilty: Number(footer.guilty),
        notGuilty: Number(footer.notGuilty),
        undecided: Number(footer.undecided),
      });
      raiseHandIfMoved();
    }

    // Only the bailiff can give a juror the floor. Being tagged by anyone else isn't a turn.
    if (message.senderName !== 'bailiff' || !message.addressed) return;
    if (footer.type === 'floor') await takeFloor(footer);
    else if (footer.type === 'ballot.call') await castBallot(footer);
  }

  return { agent, profile };
}
