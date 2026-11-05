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
    expect(formatFooter('x', { type: 'turn', at: undefined, points: '' })).toBe(
      'x\n[jury v1 type=turn]',
    );
  });

  it('ignores messages without a footer', () => {
    expect(parseFooter('just a person talking')).toBeNull();
  });

  it('strips leading mentions only', () => {
    expect(stripMentions('@juror-4 @juror-2 what about @juror-3?')).toBe('what about @juror-3?');
  });
});
