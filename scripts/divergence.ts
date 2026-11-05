// Checks the cast sounds like eleven people: every juror answers the same moment, then
// we measure shared words and ask a blind reader to name who said each line.
//   pnpm divergence
import { readFileSync } from 'node:fs';
import { CAST, createLlm, type Case } from '@jury/core';
import { jurorPrompt, PREAMBLE } from '@jury/server/jurors';
import { z } from 'zod';

const MAX_SHARED_WORDS = 0.35;
const MIN_BLIND_SCORE = 0.7;
const CALL_GAP_MS = 500;

const MOMENT = `Juror 8 (Ruth Okoye): A nine-point partial print on a tool he used every single shift. What does that actually prove, besides that he worked for a living?

It is your moment to speak. Answer in character, under 45 words.`;

const STOP_WORDS = new Set(
  'the a an and or but of to in on at for with that this it is was are be he she they you i we his him her not do does did what just so if as by from have has had there'.split(' '),
);

const trial = JSON.parse(readFileSync(new URL('../cases/hale.json', import.meta.url), 'utf8')) as Case;
const llm = createLlm({
  provider: process.env.LLM_PROVIDER ?? 'gemini',
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL,
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const wordsOf = (text: string) =>
  new Set(text.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter((word) => word && !STOP_WORDS.has(word)));

function sharedWords(a: string, b: string): number {
  const [first, second] = [wordsOf(a), wordsOf(b)];
  const shared = [...first].filter((word) => second.has(word)).length;
  return shared / Math.max(1, new Set([...first, ...second]).size);
}

const lines = new Map<number, string>();
for (const juror of CAST) {
  const { line } = await llm.generateJson({
    system: `${PREAMBLE}\n\n${jurorPrompt(juror.id)}\n\nTHE CASE:\n${trial.summary}`,
    prompt: `${MOMENT}\n\nReply with JSON only: {"line": what you say aloud}`,
    schema: z.object({ line: z.string().min(1) }),
  });
  lines.set(juror.id, line);
  console.log(`${String(juror.id).padStart(2)} ${juror.name}: ${line}`);
  await sleep(CALL_GAP_MS);
}

const pairs = CAST.flatMap((a, index) =>
  CAST.slice(index + 1).map((b) => ({ a: a.id, b: b.id, shared: sharedWords(lines.get(a.id)!, lines.get(b.id)!) })),
).sort((x, y) => y.shared - x.shared);
const worst = pairs[0]!;
console.log(`\nMost similar pair: jurors ${worst.a} and ${worst.b}, ${Math.round(worst.shared * 100)}% shared words`);

// The reader sees each line beside the eleven character sheets, with no names on the lines.
const sheets = CAST.map((juror) => `Juror ${juror.id}:\n${jurorPrompt(juror.id)}`).join('\n\n');
const order = [...CAST].sort(() => Math.random() - 0.5);
const { guesses } = await llm.generateJson({
  system: 'You match lines of dialogue to the character who said them. Each character said exactly one line.',
  prompt: `CHARACTERS:\n${sheets}\n\nLINES:\n${order.map((juror, index) => `${index + 1}. ${lines.get(juror.id)}`).join('\n')}\n\nReply with JSON only: {"guesses": an array of juror numbers, one per line, in order}`,
  schema: z.object({ guesses: z.array(z.number().int()) }),
});
const correct = order.filter((juror, index) => guesses[index] === juror.id).length;
const score = correct / order.length;
console.log(`Blind reader named ${correct} of ${order.length} speakers (${Math.round(score * 100)}%)`);

const passed = worst.shared <= MAX_SHARED_WORDS && score >= MIN_BLIND_SCORE;
console.log(passed ? 'PASSED: the jurors sound like different people.' : 'FAILED: jurors are too alike.');
process.exit(passed ? 0 : 1);
