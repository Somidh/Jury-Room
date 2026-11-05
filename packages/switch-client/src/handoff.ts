// Every message code needs to read ends with machine-readable fields:
//   jury v1 type=turn trial=t3 turn=14 vote=guilty mood=irritated at=4 points=p5
// Values are URI-encoded, so a quote with spaces stays one field.
//
// A Switch message has no metadata, and Mattermost prints Markdown and HTML comments
// as text, so the fields go after the sentence in zero-width characters. Agents
// decode them from the room log. People only see the sentence.

export type Footer = {
  type: string;
  [key: string]: string | number | undefined;
};

const PREFIX = 'jury v1 ';
const START = '⁣';
const DIGITS = ['‌', '‍', '⁠', '⁢'] as const;
const LINE = /⁣([‌‍⁠⁢]+)\s*$/;

function hide(text: string): string {
  const digits = [...new TextEncoder().encode(text)].flatMap((byte) =>
    [6, 4, 2, 0].map((shift) => DIGITS[(byte >> shift) & 3]),
  );
  return START + digits.join('');
}

function reveal(hidden: string): string {
  const values = [...hidden].map((digit) => DIGITS.indexOf(digit as (typeof DIGITS)[number]));
  const bytes = new Uint8Array(Math.floor(values.length / 4));
  bytes.forEach((_, index) => {
    const [a, b, c, d] = values.slice(index * 4, index * 4 + 4) as [number, number, number, number];
    bytes[index] = (a << 6) | (b << 4) | (c << 2) | d;
  });
  return new TextDecoder().decode(bytes);
}

export function formatFooter(text: string, fields: Footer): string {
  const pairs = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`);
  return text + hide(PREFIX + pairs.join(' '));
}

export function parseFooter(body: string): Footer | null {
  const match = LINE.exec(body);
  if (!match?.[1]) return null;

  const line = reveal(match[1]);
  if (!line.startsWith(PREFIX)) return null;

  const fields: Record<string, string> = {};
  for (const pair of line.slice(PREFIX.length).trim().split(/\s+/)) {
    const at = pair.indexOf('=');
    if (at > 0) fields[pair.slice(0, at)] = decodeURIComponent(pair.slice(at + 1));
  }
  return fields.type ? { ...fields, type: fields.type } : null;
}

/** The readable part of a message, without the footer. */
export function stripFooter(body: string): string {
  return body.replace(LINE, '').trim();
}

/** The message text without its leading @mentions. */
export function stripMentions(body: string): string {
  return body.replace(/^(\s*@[a-z0-9._-]+\s*)+/i, '').trim();
}
