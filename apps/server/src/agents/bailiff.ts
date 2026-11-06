import {
  buildDebrief,
  CAST,
  MAX_TURNS,
  MAX_TURNS_WITHOUT_CHANGE,
  pickNext,
  TURN_TIMEOUT_MS,
  TURNS_BETWEEN_VOTES,
  type Candidate,
  type Case,
  type Debrief,
  type LastLine,
  type Ledger,
  type LineBasis,
  type Llm,
  type PersonArgument,
  type SpokenLine,
  type Tally,
  type Verdict,
  type Vote,
} from '@jury/core';
import { formatFooter, parseFooter, stripFooter, SwitchAgent, type Footer, type RoomMessage } from '@jury/switch-client';
import { tagArgument } from './clerk';
import {
  createCaseDocument,
  HUMAN_SEAT,
  isBegin,
  isCallVote,
  isHuman,
  isPass,
  jurorId,
  voteWords,
  type Connection,
} from './shared';

const JUROR_LOAD_MS = 2000;
const BALLOT_TIMEOUT_MS = 6000;
const LEDGER_WAIT_MS = 5000;
const LEDGER_POLL_MS = 100;
const CHANGES_BEFORE_VOTE = 3;
const MIN_TURNS_BETWEEN_VOTES = 6;

export type TrialOptions = {
  trial: Case;
  jurorIds: number[];
  maxTurns?: number;
};

/** What a person is shown. The points stay hidden until the reveal. */
export type CaseBrief = {
  title: string;
  charge: string;
  summary: string;
  evidence: { label: string; detail: string }[];
  witnesses: { name: string; role: string; statement: string }[];
};

export type TrialEvent =
  | { type: 'brief'; brief: CaseBrief }
  | { type: 'deliberation' }
  | { type: 'floor'; jurorId: number }
  | { type: 'prompt'; kind: 'speak' | 'vote' }
  | { type: 'released' }
  | { type: 'human.vote'; vote: Vote }
  | { type: 'line'; speaker: string; text: string; vote?: string; mood?: string; at?: number; grudge?: number; seat?: number }
  | { type: 'tally'; tally: Tally }
  | { type: 'verdict'; verdict: string }
  | { type: 'debrief'; debrief: Debrief };

function toBrief({ title, charge, summary, evidence, witnesses }: Case): CaseBrief {
  return {
    title,
    charge,
    summary,
    evidence: evidence.map(({ label, detail }) => ({ label, detail })),
    witnesses: witnesses.map(({ name, role, statement }) => ({ name, role, statement })),
  };
}

function briefText(brief: CaseBrief): string {
  return [
    `#### ${brief.title}`,
    `**Charge:** ${brief.charge}`,
    brief.summary,
    '**Evidence**',
    brief.evidence.map((item) => `- **${item.label}:** ${item.detail}`).join('\n'),
    '**Witnesses**',
    brief.witnesses.map((item) => `- **${item.name}, ${item.role}:** ${item.statement}`).join('\n'),
    'The jurors will stay silent until you type **begin**.',
  ].join('\n\n');
}

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
  const ballots = new Map<number, Vote>();
  const votes = new Map<number, Vote>();
  const lastSpoke = new Map<number, number>();
  const hands = new Set<number>();
  const grudges: [number, number][] = [];
  const humanQueue: string[] = [];
  const spoken: SpokenLine[] = [];
  const humanArguments: PersonArgument[] = [];
  const ledgers = new Map<number, Ledger>();
  let lastTally: Tally = { guilty: 0, notGuilty: 0, undecided: 0 };

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
    spoken.push({
      juror: speaker,
      text: stripFooter(message.body),
      vote,
      points: String(footer.points ?? '').split(',').filter(Boolean),
      basis: (footer.basis as LineBasis | undefined) ?? 'evidence',
    });

    last = {
      speaker,
      speakerVote: vote,
      target: target === HUMAN_SEAT ? undefined : target,
      evidenceIds: evidenceFor(String(footer.points ?? '').split(',').filter(Boolean)),
    };
    emit({
      type: 'line',
      speaker: message.senderName,
      text: stripFooter(message.body),
      vote,
      mood: String(footer.mood ?? ''),
      at: target,
      grudge: footer.grudge ? Number(footer.grudge) : undefined,
    });
  }

  function onMessage(message: RoomMessage): void {
    if (!trialId) return;

    // Checked first, so a pasted juror line still counts as the person speaking.
    if (isHuman(message.senderName, message.body)) {
      humanQueue.push(stripFooter(message.body));
      const wake = humanArrived;
      humanArrived = null;
      wake?.();
      return;
    }
    const footer = parseFooter(message.body);
    if (footer?.trial !== trialId) return;

    const speaker = jurorId(message.senderName);
    if (speaker === null) return;

    if (footer.type === 'hand') {
      hands.add(speaker);
      emit({ type: 'line', speaker: 'stage', text: stripFooter(message.body), seat: speaker });
    } else if (footer.type === 'ballot') {
      ballots.set(speaker, footer.vote as Vote);
      votes.set(speaker, footer.vote as Vote);
      emit({ type: 'line', speaker: message.senderName, text: stripFooter(message.body), vote: String(footer.vote) });
    } else if (footer.type === 'ledger') {
      ledgers.set(speaker, JSON.parse(String(footer.data)) as Ledger);
      return;
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

  /** Waits as long as it takes. Nothing in a trial moves on a timer while a person decides. */
  async function nextHuman(): Promise<string> {
    while (!humanQueue.length) await new Promise<void>((resolve) => (humanArrived = resolve));
    return humanQueue.shift()!;
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

  /** Returns true once the person has used their moment: an argument, a pass or a vote call. */
  async function handleHuman(text: string): Promise<boolean> {
    if (isPass(text)) return true;
    if (isCallVote(text)) {
      voteRequested = true;
      return true;
    }
    const vote = readHumanVote(text);
    if (vote) {
      humanVote = vote;
      emit({ type: 'human.vote', vote });
    }
    if (vote && text.split(/\s+/).length <= 6) return false;

    emit({ type: 'line', speaker: 'human', text });
    // A person arguing is a room still working, however long the jurors hold.
    turnsSinceChange = 0;
    const target = findTarget(text);
    let tags = { points: [] as string[], quality: 0.2, tactic: 'logic', fabricated: false };
    try {
      tags = await tagArgument(llm, options!.trial, text);
    } catch (error) {
      connection.log?.(`[bailiff] clerk failed: ${(error as Error).message}`);
    }
    const arg = String(humanArguments.length + 1);
    humanArguments.push({ id: arg, text, points: tags.points, fabricated: tags.fabricated });
    await agent.post(
      formatFooter(tags.fabricated ? 'The clerk notes that is not in the record.' : 'The clerk notes it for the record.', {
        type: 'clerk',
        trial: trialId,
        arg,
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
    return true;
  }

  /** The pause after every juror. The next one is only called once the person is done. */
  async function yieldToHuman(): Promise<void> {
    await agent.post(formatFooter('Speak now or pass.', { type: 'human.turn', trial: trialId }));
    emit({ type: 'prompt', kind: 'speak' });
    while (!(await handleHuman(await nextHuman())));
    emit({ type: 'released' });
  }

  async function askHumanVote(): Promise<void> {
    await agent.post(formatFooter(`Juror ${HUMAN_SEAT}, how do you vote?`, { type: 'human.ballot', trial: trialId }));
    emit({ type: 'prompt', kind: 'vote' });
    for (;;) {
      const text = await nextHuman();
      await handleHuman(text);
      if (readHumanVote(text) || isPass(text)) break;
    }
    emit({ type: 'released' });
  }

  async function waitForBegin(): Promise<void> {
    while (!isBegin(await nextHuman()));
    await agent.post(formatFooter('The jury begins deliberating.', { type: 'deliberation', trial: trialId }));
    emit({ type: 'deliberation' });
  }

  function reset(): void {
    humanVote = null;
    last = null;
    lineCount = 0;
    exchangeLength = 0;
    exchangePair = '';
    voteRequested = false;
    changesSinceVote = 0;
    turnsSinceVote = 0;
    turnsSinceChange = 0;
    ballots.clear();
    votes.clear();
    lastSpoke.clear();
    hands.clear();
    grudges.length = 0;
    humanQueue.length = 0;
    spoken.length = 0;
    humanArguments.length = 0;
    ledgers.clear();
  }

  async function takeVote(round: number): Promise<Tally> {
    const { jurorIds } = options!;
    ballots.clear();
    await agent.post(
      formatFooter(`The foreman calls for a vote. Ballot ${round}.`, { type: 'vote.call', trial: trialId, round }),
    );
    for (const id of jurorIds) {
      await agent.send(formatFooter('How do you vote?', { type: 'ballot.call', trial: trialId, round }), [`juror-${id}`]);
      await waitFor(id, BALLOT_TIMEOUT_MS);
    }

    await askHumanVote();

    // A ballot that never arrived stands as that juror's last public vote.
    const all = [
      ...jurorIds.map((id) => ballots.get(id) ?? votes.get(id) ?? 'undecided'),
      humanVote ?? 'undecided',
    ];
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
    lastTally = tally;
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

  /** Asks every juror for their private account, now the trial is over. */
  async function collectLedgers(): Promise<void> {
    await agent.post(formatFooter('The jury is dismissed.', { type: 'debrief.call', trial: trialId }));
    const deadline = Date.now() + LEDGER_WAIT_MS;
    while (ledgers.size < options!.jurorIds.length && Date.now() < deadline) await sleep(LEDGER_POLL_MS);
  }

  async function finish(verdict: Verdict, text: string): Promise<string> {
    await agent.post(formatFooter(text, { type: 'verdict', trial: trialId, verdict }));
    emit({ type: 'verdict', verdict });

    await collectLedgers();
    const debrief = buildDebrief({
      trial: options!.trial,
      verdict,
      tally: lastTally,
      lines: spoken,
      arguments: humanArguments,
      ledgers: [...ledgers.values()],
    });
    emit({ type: 'debrief', debrief });
    await agent.post(
      formatFooter(`${debrief.evidence.headline} You swayed ${debrief.influence.swayed.length} of ${options!.jurorIds.length} jurors.`, {
        type: 'debrief',
        trial: trialId,
      }),
    );
    return verdict;
  }

  return {
    agent,

    /** Runs one trial to its end, and returns the verdict. */
    async run(trialOptions: TrialOptions): Promise<string> {
      reset();
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
      const brief = toBrief(trialOptions.trial);
      await agent.post(formatFooter(briefText(brief), { type: 'brief', trial: trialId }));
      await sleep(JUROR_LOAD_MS);
      emit({ type: 'brief', brief });
      await waitForBegin();

      let round = 1;
      await takeVote(round);

      for (let turn = 1; ; turn += 1) {
        // The room is never hung on a stale count, so running out of time forces a ballot.
        const outOfTime = turn > maxTurns || turnsSinceChange >= MAX_TURNS_WITHOUT_CHANGE;
        const dueVote =
          voteRequested ||
          (outOfTime && turnsSinceVote > 0) ||
          (changesSinceVote >= CHANGES_BEFORE_VOTE && turnsSinceVote >= MIN_TURNS_BETWEEN_VOTES) ||
          turnsSinceVote >= TURNS_BETWEEN_VOTES;
        if (dueVote) {
          round += 1;
          const tally = await takeVote(round);
          if (tally.guilty === size) return finish('guilty', 'We find the defendant guilty.');
          if (tally.notGuilty === size) return finish('not_guilty', 'We find the defendant not guilty.');
        }

        if (outOfTime) {
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

        emit({ type: 'floor', jurorId: grant.jurorId });
        await agent.send(
          formatFooter('The floor is yours.', {
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
        await yieldToHuman();
      }
    },
  };
}

export { voteWords };
