import type { z } from 'zod';

export type LlmConfig = {
  provider: string;
  geminiApiKey?: string;
  geminiModel?: string;
};

export type JsonRequest<T> = {
  system: string;
  prompt: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Returns what's wrong with a parsed reply, or null. The model gets one retry. */
  validate?: (value: T) => string | null;
};

export type Llm = {
  generateJson<T>(request: JsonRequest<T>): Promise<T>;
};

type CompleteJson = (system: string, prompt: string) => Promise<string>;

const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
const FALLBACK_GEMINI_MODEL = 'gemini-flash-lite-latest';
const BUSY_STATUSES = new Set([429, 500, 503]);
const BUSY_RETRY_DELAYS_MS = [1500, 4000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function geminiRequest(apiKey: string, model: string, system: string, prompt: string) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
}

/** The free tier often answers "busy", so retry, then try the lighter model once. */
function geminiComplete(apiKey: string, model: string): CompleteJson {
  const attempts = [
    ...[0, ...BUSY_RETRY_DELAYS_MS].map((delay) => ({ model, delay })),
    { model: FALLBACK_GEMINI_MODEL, delay: 0 },
  ];

  return async (system, prompt) => {
    let response: Response | undefined;
    for (const attempt of attempts) {
      await sleep(attempt.delay);
      response = await geminiRequest(apiKey, attempt.model, system, prompt);
      if (!BUSY_STATUSES.has(response.status)) break;
    }
    if (!response?.ok) {
      const detail = await response?.text();
      throw new Error(`Gemini returned ${response?.status}: ${detail?.slice(0, 300)}`);
    }
    const json = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
    if (!text) throw new Error('Gemini returned an empty response.');
    return text;
  };
}

/** Parses and validates a model reply, retrying once with the error as feedback. */
function withValidation(complete: CompleteJson): Llm {
  return {
    async generateJson({ system, prompt, schema, validate }) {
      let feedback = '';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const text = await complete(system, prompt + feedback);
        try {
          const value = schema.parse(JSON.parse(text));
          const problem = validate?.(value);
          if (problem) throw new Error(problem);
          return value;
        } catch (error) {
          feedback = `\n\nYour last reply was invalid: ${(error as Error).message.slice(0, 500)}\nReturn corrected JSON only.`;
        }
      }
      throw new Error('The model did not return valid JSON after a retry.');
    },
  };
}

export function createLlm(config: LlmConfig): Llm {
  if (config.provider === 'gemini') {
    if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY is missing from .env.');
    return withValidation(
      geminiComplete(config.geminiApiKey, config.geminiModel || DEFAULT_GEMINI_MODEL),
    );
  }
  throw new Error(`Unknown LLM_PROVIDER "${config.provider}".`);
}
