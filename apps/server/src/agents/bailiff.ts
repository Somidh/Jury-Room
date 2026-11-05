import {
  CAST,
  MAX_TURNS,
  MAX_TURNS_WITHOUT_CHANGE,
  pickNext,
  TURN_TIMEOUT_MS,
  TURNS_BETWEEN_VOTES,
  type Candidate,
  type Case,
  type LastLine,
  type Llm,
  type Tally,
  type Vote,
} from '@jury/core';
import { formatFooter, parseFooter, stripFooter, SwitchAgent, type Footer, type RoomMessage } from '@jury/switch-client';
import { tagArgument } from './clerk';
import { createCaseDocument, HUMAN_SEAT, isHuman, jurorId, voteWords, type Connection } from './shared';

const PACE_MS = 1500;
const JUROR_LOAD_MS = 2000;
const BALLOT_TIMEOUT_MS = 6000;
const HUMAN_VOTE_WAIT_MS = 30_000;
const HUMAN_ANSWER_WAIT_MS = 20_000;
const CHANGES_BEFORE_VOTE = 3;
const MIN_TURNS_BETWEEN_VOTES = 6;

export type TrialOptions = {
  trial: Case;
  jurorIds: number[];
  maxTurns?: number;
};

export type TrialEvent =
  | { type: 'line'; speaker: string; text: string; vote?: string; mood?: string }
  | { type: 'tally'; tally: Tally }
  | { type: 'verdict'; verdict: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Holds the one floor. It sees public lines and votes, never a juror's private state. */
export function createBailiff(connection: Connection, llm: Llm, emit: (event: TrialEvent) => void) {
  const agent = new SwitchAgent({ ...connection, name: 'bailiff', filter: 'all', onMessage });

  let trialId = '';
  let options: TrialOptions | null = null;
  let humanVote: Vote | null = null;
  let last: LastLine | null = null;
  let lineCount = 0;
  let exchangeLength = 0;
  let exchangePair = '';
  let waitingFor: { jurorId: number; done: () => void } | null = null;
  let humanArrived: (() => void) | null = null;
  let voteRequested = false;
  let changesSinceVote = 0;
  let turnsSinceVote = 0;
  let turnsSinceChange = 0;
  let askedHuman = false;
  const ballots = new Map<number, Vote>();
  const votes = new Map<number, Vote>();
  const lastSpoke = new Map<number, number>();
  const hands = new Set<number>();
  const grudges: [number, number][] = [];
  const humanQueue: string[] = [];

  const evidenceFor = (points: string[]) =>
    points
      .map((id) => options!.trial.points.find((point) => point.id === id)?.evidenceId)
      .filter((id): id is string => Boolean(id));

  function onJurorTurn(speaker: number, message: RoomMessage, footer: Footer): void {
    const vote = footer.vote as Vote;
    if (votes.get(speaker) !== vote) {
      changesSinceVote += 1;
      turnsSinceChange = 0;
    }
    votes.set(speaker, vote);
    lastSpoke.set(speaker, lineCount);
    lineCount += 1;
    hands.delete(speaker);

    const target = footer.at ? Number(footer.at) : undefined;
    const pair = [speaker, target].sort().join('-');
    exchangeLength = target !== undefined && pair === exchangePair ? exchangeLength + 1 : 1;
    exchangePair = pair;
    if (footer.grudge) grudges.push([speaker, Number(footer.grudge)]);
    askedHuman = target === HUMAN_SEAT;

    last = {
      speaker,
      speakerVote: vote,
      target: target === HUMAN_SEAT ? undefined : target,
      evidenceIds: evidenceFor(String(footer.points ?? '').split(',').filter(Boolean)),
    };
    emit({ type: 'line', speaker: message.senderName, text: stripFooter(message.body), vote, mood: String(footer.mood ?? '') });
  }

  function onMessage(message: RoomMessage): void {
    if (!trialId) return;
    const footer = parseFooter(message.body);

    if (!footer && isHuman(message.senderName, message.body)) {
      humanQueue.push(message.body);
      humanArrived?.();
      return;
    }
    if (footer?.trial !== trialId) return;

    const speaker = jurorId(message.senderName);
    if (speaker === null) return;

    if (footer.type === 'hand') {
      hands.add(speaker);
      emit({ type: 'line', speaker: 'stage', text: stripFooter(message.body) });
    } else if (footer.type === 'ballot') {
      ballots.set(speaker, footer.vote as Vote);
      votes.set(speaker, footer.vote as Vote);
      emit({ type: 'line', speaker: message.senderName, text: stripFooter(message.body), vote: String(footer.vote) });
    } else if (footer.type === 'turn') {
      onJurorTurn(speaker, message, footer);
    } else if (footer.type === 'pass') {
      lastSpoke.set(speaker, lineCount);
      emit({ type: 'line', speaker: 'stage', text: stripFooter(message.body) });
    } else {
      return;
    }

    if (footer.type !== 'hand' && waitingFor?.jurorId === speaker) waitingFor.done();
  }

  /** Waits for the addressed juror. This is what makes the floor single-holder. */
  function waitFor(id: number, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waitingFor = null;
        resolve(false);
      }, ms);
      waitingFor = {
        jurorId: id,
        done: () => {
          clearTimeout(timer);
          waitingFor = null;
          resolve(true);
        },
      };
    });
  }

  function waitForHuman(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      humanArrived = () => {
        clearTimeout(timer);
        humanArrived = null;
        resolve();
      };
    });
  }

  function findTarget(text: string): number | undefined {
    const active = options!.jurorIds;
    const tagged = /@juror-(\d+)|juror\s+(\d+)/i.exec(text);
    const number = tagged ? Number(tagged[1] ?? tagged[2]) : undefined;
    if (number && active.includes(number)) return number;
    return CAST.find(
      (juror) => active.includes(juror.id) && new RegExp(`\\b${juror.name.split(' ')[0]}\\b`, 'i').test(text),
    )?.id;
  }

  function readHumanVote(text: string): Vote | null {
    if (/\bnot guilty\b/i.test(text) && /\b(vote|i say|my vote)\b|^not guilty/i.test(text)) return 'not_guilty';
    if (/\bguilty\b/i.test(text) && /\b(vote|i say|my vote)\b|^guilty/i.test(text)) return 'guilty';
    return null;
  }

  async function handleHuman(text: string): Promise<void> {
    if (/call (a|the) vote/i.test(text)) {
      voteRequested = true;
      return;
    }
    const vote = readHumanVote(text);
    if (vote) humanVote = vote;
    if (vote && text.split(/\s+/).length <= 6) return;

    emit({ type: 'line', speaker: 'human', text });
    const target = findTarget(text);
    let tags = { points: [] as string[], quality: 0.2, tactic: 'logic', fabricated: false };
    try {
      tags = await tagArgument(llm, options!.trial, text);
    } catch (error) {
      connection.log?.(`[bailiff] clerk failed: ${(error as Error).message}`);
    }
    await agent.post(
      formatFooter(tags.fabricated ? 'The clerk notes that is not in the record.' : 'The clerk notes it for the record.', {
        type: 'clerk',
        trial: trialId,
        points: tags.points.join(','),
        quality: tags.quality,
        tactic: tags.tactic,
        target,
        fabricated: String(tags.fabricated),
      }),
    );
    lineCount += 1;
    exchangeLength = 0;
    exchangePair = '';
    last = { speaker: 'human', speakerVote: humanVote ?? undefined, target, evidenceIds: evidenceFor(tags.points) };
  }

  async function drainHuman(): Promise<void> {
    while (humanQueue.length) await handleHuman(humanQueue.shift()!);
  }

  async function takeVote(round: number): Promise<Tally> {
    const { jurorIds } = options!;
    ballots.clear();
    await agent.post(
      formatFooter(`The foreman calls for a vote. Ballot ${round}.`, { type: 'vote.call', trial: trialId, round }),
    );
    for (const id of jurorIds) {
      await agent.send(formatFooter(`Juror ${id}?`, { type: 'ballot.call', trial: trialId, round }), [`juror-${id}`]);
      await waitFor(id, BALLOT_TIMEOUT_MS);
    }

    await drainHuman();
    if (!humanVote) {
      await agent.post(formatFooter(`Juror ${HUMAN_SEAT}, how do you vote?`, { type: 'human.ballot', trial: trialId }));
      await waitForHuman(HUMAN_VOTE_WAIT_MS);
      await drainHuman();
    }

    const all = [...ballots.values(), humanVote ?? 'undecided'];
    const tally: Tally = {
      guilty: all.filter((vote) => vote === 'guilty').length,
      notGuilty: all.filter((vote) => vote === 'not_guilty').length,
      undecided: all.filter((vote) => vote === 'undecided').length,
    };
    await agent.post(
      formatFooter(`Guilty ${tally.guilty}. Not guilty ${tally.notGuilty}. Undecided ${tally.undecided}.`, {
        type: 'vote.result',
        trial: trialId,
        round,
        guilty: tally.guilty,
        notGuilty: tally.notGuilty,
        undecided: tally.undecided,
      }),
    );
    emit({ type: 'tally', tally });
    changesSinceVote = 0;
    turnsSinceVote = 0;
    voteRequested = false;
    return tally;
  }

  function candidates(): Candidate[] {
    return options!.jurorIds.map((id) => {
      const profile = CAST.find((juror) => juror.id === id)!;
      const spoke = lastSpoke.get(id);
      return {
        id,
        talkativeness: profile.talkativeness,
        focus: options!.trial.focus[String(id)] ?? [],
        vote: votes.get(id) ?? 'undecided',
        handRaised: hands.has(id),
        silentFor: spoke === undefined ? Number.POSITIVE_INFINITY : lineCount - spoke - 1,
      };
    });
  }

  async function finish(verdict: string, text: string): Promise<string> {
    await agent.post(formatFooter(text, { type: 'verdict', trial: trialId, verdict }));
    emit({ type: 'verdict', verdict });
    return verdict;
  }

  return {
    agent,

    /** Runs one trial to its end, and returns the verdict. */
    async run(trialOptions: TrialOptions): Promise<string> {
      options = trialOptions;
      trialId = `t${Date.now().toString(36)}`;
      const maxTurns = trialOptions.maxTurns ?? MAX_TURNS;
      const size = trialOptions.jurorIds.length + 1;

      const doc = await createCaseDocument(agent, trialId, trialOptions.trial);
      await agent.post(
        formatFooter(`Court is adjourned to the jury room. ${trialOptions.trial.title}: ${trialOptions.trial.charge}.`, {
          type: 'trial.start',
          trial: trialId,
          doc,
        }),
      );
      await sleep(JUROR_LOAD_MS);

      let round = 1;
      await takeVote(round);

      for (let turn = 1; ; turn += 1) {
        await drainHuman();

        if (askedHuman) {
          askedHuman = false;
          await waitForHuman(HUMAN_ANSWER_WAIT_MS);
          await drainHuman();
        }

        const dueVote =
          voteRequested ||
          (changesSinceVote >= CHANGES_BEFORE_VOTE && turnsSinceVote >= MIN_TURNS_BETWEEN_VOTES) ||
          turnsSinceVote >= TURNS_BETWEEN_VOTES;
        if (dueVote) {
          round += 1;
          const tally = await takeVote(round);
          if (tally.guilty === size) return finish('guilty', 'We find the defendant guilty.');
          if (tally.notGuilty === size) return finish('not_guilty', 'We find the defendant not guilty.');
        }

        if (turn > maxTurns || turnsSinceChange >= MAX_TURNS_WITHOUT_CHANGE) {
          return finish('hung', 'The jury cannot agree. The foreman tells the judge they are hung.');
        }

        const grant = pickNext({
          candidates: candidates(),
          last,
          grudges,
          exchangeLength,
          random: Math.random,
        });
        if (!grant) throw new Error('No jurors are in the room.');

        await agent.send(
          formatFooter(`The bailiff looks to Juror ${grant.jurorId}.`, {
            type: 'floor',
            trial: trialId,
            turn,
            why: grant.why,
          }),
          [`juror-${grant.jurorId}`],
        );
        const answered = await waitFor(grant.jurorId, TURN_TIMEOUT_MS);
        if (!answered) emit({ type: 'line', speaker: 'stage', text: `Juror ${grant.jurorId} says nothing.` });
        turnsSinceVote += 1;
        turnsSinceChange += 1;
        await sleep(PACE_MS);
      }
    },
  };
}

export { voteWords };
