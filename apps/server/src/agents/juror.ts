import {
  applyOwnShift,
  feelTheRoom,
  hear,
  jurorLineQuality,
  nextVote,
  openingState,
  type Argument,
  type Case,
  type JurorProfile,
  type JurorState,
  type Ledger,
  type LineBasis,
  type Llm,
  type Moved,
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
const BASES = ['evidence', 'emotion', 'pressure', 'bias'] as const satisfies readonly LineBasis[];
const MAX_WORDS = 45;
const HARD_WORD_LIMIT = 60;
const MAX_POINTS = 2;
const THINK_TIMEOUT_MS = 22_000;
/** A point argued this many times in the recent transcript has stopped landing. */
const WORN_OUT_AFTER = 3;
const ECHO_OVERLAP = 0.6;
const ECHO_WINDOW = 6;
const MIN_WORD_LENGTH = 4;

const Reply = z.object({
  line: z.string().min(1),
  addressedTo: z.number().int().nullable(),
  quote: z.string().nullable(),
  points: z.array(z.string()),
  tactic: z.enum(TACTICS),
  basis: z.enum(BASES).catch('evidence'),
  mood: z.string(),
  shift: z.number(),
  shiftReason: z.string(),
  grudge: z.number().int().nullable(),
});
type Reply = z.infer<typeof Reply>;

const OPENING_LINES = [
  'Anyone else want to weigh in?',
  'Before we go on. Does anyone else have something to say?',
  "We haven't heard from everyone. Anyone?",
];

const BALLOT_LINES: Record<Vote, string> = {
  guilty: 'Guilty.',
  not_guilty: 'Not guilty.',
  undecided: "I can't say yet.",
};

function describeBelief(belief: number): string {
  if (belief >= 85) return 'You are certain the defendant is guilty.';
  if (belief >= 65) return 'You think the defendant is guilty.';
  if (belief >= 55) return 'You lean toward guilty, without much comfort.';
  if (belief >= 45) return "You honestly don't know any more.";
  if (belief >= 35) return 'You lean toward not guilty, and it unsettles you.';
  return 'You do not believe the state proved it.';
}

const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

const contentWords = (text: string) =>
  new Set(normalise(text).split(/\s+/).filter((word) => word.length >= MIN_WORD_LENGTH));

/** Share of the shorter line's content words that also appear in the other line. */
function overlap(a: string, b: string): number {
  const [first, second] = [contentWords(a), contentWords(b)];
  const shared = [...first].filter((word) => second.has(word)).length;
  return shared / Math.max(1, Math.min(first.size, second.size));
}

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
  let openingVote: Vote = state.vote;
  let moved: Moved = { person: 0, jurors: 0, room: 0, self: 0 };
  let byArgument: Record<string, number> = {};
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
    const before = state.belief;
    state = hear(state, profile, argument, trial);
    const change = state.belief - before;
    if (argument.speaker === 'human') {
      moved.person += change;
      if (argument.arg) byArgument[argument.arg] = (byArgument[argument.arg] ?? 0) + change;
    } else {
      moved.jurors += change;
    }
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
      quality: jurorLineQuality(footer.vote as Vote),
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
      arg: footer.arg ? String(footer.arg) : undefined,
    });
  }

  async function onTrialStart(footer: Footer): Promise<void> {
    trialId = String(footer.trial);
    mood = 'settled';
    handRaised = false;
    moved = { person: 0, jurors: 0, room: 0, self: 0 };
    byArgument = {};
    reasons.length = 0;
    trial = await readCaseDocument(agent, String(footer.doc));
    state = openingState(profile, trial.openingLean);
    openingVote = state.vote;
  }

  function buildPrompt(lines: RoomLine[], pendingVote: Vote, why: string): string {
    const changing = pendingVote !== state.vote;
    const uses = (id: string) => lines.filter((line) => line.points?.includes(id)).length;
    const wornOut = trial!.points.filter((point) => uses(point.id) >= WORN_OUT_AFTER);
    const pointList = trial!.points
      .filter((point) => !wornOut.includes(point))
      .map((point) => `${point.id}: ${point.claim}`)
      .join('\n');
    const focus = trial!.fixations[String(profile.id)] ?? 'whatever the room is doing';
    const transcript = lines.map((line) => `${line.label}: ${line.text}`).join('\n') || '(nobody has spoken yet)';
    const said = lines.filter((line) => line.speaker === profile.id).map((line) => `- ${line.text}`).join('\n');
    return [
      `THE ROOM SO FAR:\n${transcript}`,
      `YOUR PRIVATE STATE (never say these words aloud):
Your last vote: ${voteWords[state.vote]}. ${describeBelief(state.belief)}
Your mood: ${mood}. People who've got under your skin: ${state.grudges.map((id) => `Juror ${id}`).join(', ') || 'nobody'}.
What's been on your mind: ${reasons.slice(-3).join('; ') || 'nothing yet'}.
What you fixate on in this case: ${focus}`,
      changing
        ? `YOU HAVE CHANGED YOUR MIND. You are now ${voteWords[pendingVote]}. Let the room hear it in your own voice, and name the one thing that did it. It should cost you something. Talk like a person, not a form: never say "changing my vote", "moving to", or the word "undecided".`
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
      wornOut.length
        ? `THE ROOM IS SICK OF THESE. Don't argue them again:\n${wornOut.map((point) => `- ${point.claim}`).join('\n')}`
        : '',
      `Reply with JSON only:
{"line": what you say aloud, under ${MAX_WORDS} words,
 "addressedTo": the juror number you're speaking to (${HUMAN_SEAT} for the person), or null,
 "quote": if addressedTo is set, a short phrase copied word for word from that person's most recent line, else null,
 "points": the one or two ids below that your line actually argues, or [],
 "tactic": one of ${TACTICS.join(', ')},
 "basis": what your line really rests on, honestly, whatever you'd claim aloud: "evidence" for facts in the case, "emotion" for feeling, "pressure" for pushing people or the clock, "bias" for who he is or where he's from,
 "mood": one word,
 "shift": how this moment changed your mind, -5 toward innocent to +5 toward guilty, usually 0,
 "shiftReason": a few private words on why,
 "grudge": the juror number who just insulted you, or null}
POINTS:
${pointList}`,
    ].filter(Boolean).join('\n\n');
  }

  /** A line too long to say always fails. An echo gets one retry, then it stands. */
  function validator(lines: RoomLine[]) {
    const heard = lines.filter((line, index) => line.speaker === profile.id || index >= lines.length - ECHO_WINDOW);
    let warned = false;
    return (reply: Reply): string | null => {
      const words = reply.line.split(/\s+/).length;
      if (words > HARD_WORD_LIMIT) return `line is ${words} words, the limit is ${MAX_WORDS}`;
      if (warned || !heard.some((line) => overlap(line.text, reply.line) >= ECHO_OVERLAP)) return null;
      warned = true;
      return 'that line repeats what was just said. Make a different argument, in different words.';
    };
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
          validate: validator(lines),
        }),
        THINK_TIMEOUT_MS,
      );

      const replyTo = lines.filter((line) => line.speaker !== profile.id).at(-1)?.id;
      const before = state.belief;
      state = applyOwnShift({ ...state, vote: pendingVote }, profile, reply.shift);
      moved.self += state.belief - before;
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
          basis: reply.basis,
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

  /** The only time a juror's private account leaves their agent, and only after the verdict. */
  async function reportLedger(): Promise<void> {
    const ledger: Ledger = { juror: profile.id, openingVote, finalVote: state.vote, moved, byArgument };
    await agent.post(
      formatFooter(`Juror ${profile.id} gathers their things.`, { type: 'ledger', trial: trialId, data: JSON.stringify(ledger) }),
    );
  }

  /** The foreman's job: stop the table and look down it. Scripted, so it can't fail or wander. */
  async function offerTheFloor(footer: Footer): Promise<void> {
    const line = OPENING_LINES[Number(footer.count) % OPENING_LINES.length]!;
    await agent.post(formatFooter(line, { type: 'opening', trial: trialId }));
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

    // A person can write anything into a message, so only the bailiff's records count.
    const fromBailiff = message.senderName === 'bailiff';
    if (footer.type === 'turn') onTurn(message, footer);
    else if (footer.type === 'clerk' && fromBailiff) onClerk(footer);
    else if (footer.type === 'debrief.call' && fromBailiff) await reportLedger();
    else if (footer.type === 'vote.result' && fromBailiff) {
      const before = state.belief;
      state = feelTheRoom(state, profile, {
        guilty: Number(footer.guilty),
        notGuilty: Number(footer.notGuilty),
        undecided: Number(footer.undecided),
      });
      moved.room += state.belief - before;
      raiseHandIfMoved();
    }

    // Only the bailiff can give a juror the floor. Being tagged by anyone else isn't a turn.
    if (!fromBailiff || !message.addressed) return;
    if (footer.type === 'floor') await takeFloor(footer);
    else if (footer.type === 'ballot.call') await castBallot(footer);
    else if (footer.type === 'opening.call') await offerTheFloor(footer);
  }

  return { agent, profile };
}
