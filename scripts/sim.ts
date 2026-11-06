// Plays whole trials with no model and no Switch, to tune the belief rules.
// Run with: pnpm sim
import { readFileSync } from 'node:fs';
import {
  CASE_IDS,
  CAST,
  feelTheRoom,
  hear,
  jurorLineQuality,
  nextVote,
  openingState,
  type Argument,
  type Case,
  type JurorState,
  type Tally,
  type Vote,
} from '@jury/core';

const LINES_BETWEEN_VOTES = 6;
const MAX_LINES = 60;
/** Measured live: the director gives the smaller side most of the floor. */
const MINORITY_FLOOR_SHARE = 0.6;

function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 2 ** 32;
    return value / 2 ** 32;
  };
}

function nextSpeaker(states: Map<number, JurorState>, random: () => number) {
  const voting = (vote: Vote) => CAST.filter((profile) => states.get(profile.id)!.vote === vote);
  const [guilty, notGuilty] = [voting('guilty'), voting('not_guilty')];
  const minority = guilty.length < notGuilty.length ? guilty : notGuilty;
  const pool = minority.length && random() < MINORITY_FLOOR_SHARE ? minority : CAST;
  return pool[Math.floor(random() * pool.length)]!;
}

type Player = {
  name: string;
  side: 'guilty' | 'not_guilty';
  /** Point ids in the order this player raises them. */
  plan: string[];
  quality: number;
};

function count(states: Map<number, JurorState>, human: Vote): Tally {
  const votes = [...states.values()].map((state) => state.vote).concat(human);
  return {
    guilty: votes.filter((vote) => vote === 'guilty').length,
    notGuilty: votes.filter((vote) => vote === 'not_guilty').length,
    undecided: votes.filter((vote) => vote === 'undecided').length,
  };
}

function play(trial: Case, player: Player, seed: number): { result: string; lines: number; flips: string[] } {
  const random = seeded(seed);
  const states = new Map(CAST.map((profile) => [profile.id, openingState(profile, trial.openingLean)]));
  const flips: string[] = [];
  let plan = [...player.plan];

  const everyoneHears = (argument: Argument) => {
    for (const profile of CAST) {
      states.set(profile.id, hear(states.get(profile.id)!, profile, argument, trial));
    }
  };

  for (let line = 1; line <= MAX_LINES; line += 1) {
    // Roughly one line in three is the player. The rest are jurors arguing their side.
    if (line % 3 === 0 && plan.length) {
      everyoneHears({ speaker: 'human', pointIds: [plan.shift()!], quality: player.quality });
    } else {
      const speaker = nextSpeaker(states, random);
      const { vote, belief } = states.get(speaker.id)!;
      const side = vote === 'undecided' ? (belief < 50 ? 'not_guilty' : 'guilty') : vote;
      const points = trial.points.filter((point) => point.pushes === side);
      const pick = () => points[Math.floor(random() * points.length)]!.id;
      const pointIds = random() < 0.7 ? [pick(), pick()] : [pick()];
      everyoneHears({ speaker: speaker.id, pointIds: [...new Set(pointIds)], quality: jurorLineQuality(vote) });
    }

    if (line % LINES_BETWEEN_VOTES === 0) {
      for (const profile of CAST) {
        const state = states.get(profile.id)!;
        const vote = nextVote(state.vote, state.belief);
        if (vote !== state.vote) flips.push(`L${line} #${profile.id} ${state.vote}->${vote}`);
        states.set(profile.id, { ...state, vote });
      }
      const tally = count(states, player.side);
      if (tally.guilty === 12) return { result: 'guilty', lines: line, flips };
      if (tally.notGuilty === 12) return { result: 'not_guilty', lines: line, flips };
      for (const profile of CAST) {
        states.set(profile.id, feelTheRoom(states.get(profile.id)!, profile, tally));
      }
    }
  }
  const tally = count(states, player.side);
  return { result: `hung ${tally.guilty}-${tally.notGuilty}-${tally.undecided}`, lines: MAX_LINES, flips };
}

const SEEDS = 200;
/** A strong player has to win at least this often, and a weak one no more than this. */
const STRONG_WINS = 50;
const WEAK_WINS = 10;
/** With this many jurors already on your side, the room can carry you. That's the point of going along. */
const CARRIED_BY = 9;
let failed = false;

function check(trial: Case): void {
  const ids = (side: string) =>
    trial.points
      .filter((point) => point.pushes === side)
      .sort((a, b) => b.weight - a.weight)
      .map((point) => point.id);
  const weakest = (side: string) => ids(side).at(-1)!;

  const opening = CAST.map((profile) => openingState(profile, trial.openingLean).vote);
  const carried = (side: Vote) => opening.filter((vote) => vote === side).length >= CARRIED_BY;

  const players: (Player & { needs: 'win' | 'not win' })[] = [
    { name: 'strong for not guilty', side: 'not_guilty', plan: ids('not_guilty'), quality: 0.9, needs: 'win' },
    { name: 'strong for guilty', side: 'guilty', plan: ids('guilty'), quality: 0.9, needs: 'win' },
    { name: 'weak, repeats one point (not guilty)', side: 'not_guilty', plan: Array(14).fill(weakest('not_guilty')), quality: 0.3, needs: 'not win' },
    { name: 'weak, repeats one point (guilty)', side: 'guilty', plan: Array(14).fill(weakest('guilty')), quality: 0.3, needs: 'not win' },
    { name: 'silent, votes not guilty', side: 'not_guilty', plan: [], quality: 0, needs: 'not win' },
    { name: 'silent, votes guilty', side: 'guilty', plan: [], quality: 0, needs: 'not win' },
  ];

  console.log(`\n${trial.title}: opens ${opening.filter((vote) => vote === 'guilty').length} guilty, ${opening.filter((vote) => vote === 'not_guilty').length} not guilty, plus you`);

  for (const player of players) {
    const results = new Map<string, number>();
    let totalLines = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const { result, lines } = play(trial, player, seed);
      const bucket = result.startsWith('hung') ? 'hung' : result;
      results.set(bucket, (results.get(bucket) ?? 0) + 1);
      totalLines += lines;
    }
    const share = (key: string) => Math.round(((results.get(key) ?? 0) / SEEDS) * 100);
    const won = share(player.side);
    const exempt = player.needs === 'not win' && carried(player.side);
    const ok = exempt || (player.needs === 'win' ? won >= STRONG_WINS : won <= WEAK_WINS);
    if (!ok) failed = true;
    console.log(
      `  ${exempt ? 'room' : ok ? 'ok  ' : 'FAIL'} ${player.name}: guilty ${share('guilty')}%, not guilty ${share('not_guilty')}%, hung ${share('hung')}%, avg ${Math.round(totalLines / SEEDS)} lines`,
    );
  }
}

for (const id of CASE_IDS) {
  check(JSON.parse(readFileSync(new URL(`../cases/${id}.json`, import.meta.url), 'utf8')) as Case);
}

if (failed) {
  console.error('\nFAILED: a case is not winnable both ways by skill.');
  process.exit(1);
}
console.log('\nPASSED: strong play wins either way in every case. Passive play only wins with a big majority behind it.');
