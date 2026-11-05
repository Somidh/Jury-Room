// Every message code needs to read ends with one machine-readable line:
//   [jury v1 type=turn trial=t3 turn=14 vote=guilty mood=irritated at=4 points=p5]
// Values are URI-encoded, so a quote with spaces stays one field.

export type Footer = {
  type: string;
  [key: string]: string | number | undefined;
};

const LINE = /\[jury v1 ([^\]]*)\]\s*$/;

export function formatFooter(text: string, fields: Footer): string {
  const pairs = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`);
  return `${text}\n[jury v1 ${pairs.join(' ')}]`;
}

export function parseFooter(body: string): Footer | null {
  const match = LINE.exec(body);
  if (!match?.[1]) return null;

  const fields: Record<string, string> = {};
  for (const pair of match[1].trim().split(/\s+/)) {
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
