import { readFileSync } from 'node:fs';
import type { Case } from '@jury/core';
import type { SwitchAgent } from '@jury/switch-client';
import { describe, expect, it } from 'vitest';
import { createCaseDocument } from './shared';

const trial = JSON.parse(readFileSync(new URL('../../../../cases/hale.json', import.meta.url), 'utf8')) as Case;

describe('the case document', () => {
  it('never gives the jurors the truth or the assessment of the record', async () => {
    let content = '';
    const agent = {
      op: async (_name: string, args: { content: string }) => {
        content = args.content;
        return { document_id: 'doc' };
      },
    } as unknown as SwitchAgent;

    await createCaseDocument(agent, 't1', trial);

    const shared = JSON.parse(content) as Partial<Case>;
    expect(shared.truth).toBeUndefined();
    expect(shared.record).toBeUndefined();
    for (const beat of trial.truth.beats) expect(content).not.toContain(beat);
    expect(shared.points).toHaveLength(trial.points.length);
  });
});
