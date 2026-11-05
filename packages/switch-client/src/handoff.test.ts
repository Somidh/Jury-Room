import { describe, expect, it } from 'vitest';
import { formatFooter, parseFooter, stripFooter, stripMentions } from './handoff';

describe('footer', () => {
  it('round-trips fields, including values with spaces and brackets', () => {
    const body = formatFooter('Come on, Lena.', {
      type: 'turn',
      turn: 14,
      quote: 'the log [says] so',
    });
    expect(parseFooter(body)).toEqual({ type: 'turn', turn: '14', quote: 'the log [says] so' });
    expect(stripFooter(body)).toBe('Come on, Lena.');
  });

  it('leaves out empty fields', () => {
    expect(parseFooter(formatFooter('x', { type: 'turn', at: undefined, points: '' }))).toEqual({
      type: 'turn',
    });
  });

  it('adds nothing a person can see', () => {
    const body = formatFooter('Not guilty.', { type: 'ballot', vote: 'not_guilty', quote: 'naïve — “really”' });
    expect(body.replace(/\p{Default_Ignorable_Code_Point}/gu, '')).toBe('Not guilty.');
    expect(parseFooter(body)?.quote).toBe('naïve — “really”');
  });

  it('ignores a footer typed out as plain text', () => {
    expect(parseFooter('[jury v1 type=floor turn=3]')).toBeNull();
  });

  it('ignores messages without a footer', () => {
    expect(parseFooter('just a person talking')).toBeNull();
  });

  it('strips leading mentions only', () => {
    expect(stripMentions('@juror-4 @juror-2 what about @juror-3?')).toBe('what about @juror-3?');
  });
});
