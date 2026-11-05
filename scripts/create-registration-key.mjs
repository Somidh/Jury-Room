// Signs in to the local Switch Gateway and saves a registration key to .env.
// The key belongs to the admin account, so the agents registered with it do too.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'jury-room';

function readEnv(file) {
  if (!existsSync(file)) return {};
  const pairs = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1)];
    });
  return Object.fromEntries(pairs);
}

const stack = readEnv(join(root, 'infra', '.env'));
const envFile = join(root, '.env');
const app = readEnv(envFile);

if (app.SWITCH_REGISTRATION_KEY) {
  console.log('.env already has SWITCH_REGISTRATION_KEY. Nothing to do.');
  process.exit(0);
}

const apiUrl = `http://localhost:${stack.API_HOST_PORT ?? 8000}`;

const login = await fetch(`${apiUrl}/gateway/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: stack.GATEWAY_ADMIN_EMAIL,
    password: stack.GATEWAY_ADMIN_PASSWORD,
  }),
});
if (!login.ok) throw new Error(`Gateway sign-in failed with HTTP ${login.status}.`);

const cookie = login.headers
  .getSetCookie()
  .map((value) => value.split(';')[0])
  .find((value) => value.startsWith('switch_auth='));
if (!cookie) throw new Error('Gateway sign-in returned no session cookie.');

const created = await fetch(`${apiUrl}/gateway/api-keys`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ label: LABEL }),
});
if (!created.ok) throw new Error(`Creating the key failed with HTTP ${created.status}.`);

const { key } = await created.json();
const lines = [`SWITCH_REGISTRATION_KEY=${key}`];
if (!app.SWITCH_API_URL) lines.push(`SWITCH_API_URL=${apiUrl}`);
appendFileSync(envFile, `${lines.join('\n')}\n`);
console.log(`Saved registration key "${LABEL}" to .env.`);
