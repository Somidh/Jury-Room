// Writes infra/.env for the local Switch stack, with fresh random secrets.
// Refuses to overwrite: new database passwords would lock out an existing volume.
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'infra', '.env');

if (existsSync(target)) {
  console.error('infra/.env already exists. Delete it and the stack volumes to start over.');
  process.exit(1);
}

const hex = (bytes) => randomBytes(bytes).toString('hex');

const values = {
  COMPOSE_PROJECT_NAME: 'curio-switch',
  COMPOSE_PROFILES: 'collab,gateway',
  SWITCH_REGISTRY: 'ghcr.io',
  SWITCH_IMAGE_NAMESPACE: 'sandbox-quantum',
  SWITCH_VERSION: '0.31.0',
  SWITCH_BIND_ADDR: '127.0.0.1',
  GATEWAY_HOST_PORT: '3000',
  API_HOST_PORT: '8000',
  MATTERMOST_HOST_PORT: '8065',
  POSTGRES_HOST_PORT: '55432',
  DB_USER: 'switch_app',
  DB_PASSWORD: hex(24),
  DB_OWNER_USER: 'postgres',
  DB_OWNER_PASSWORD: hex(24),
  DB_NAME: 'switch',
  AGENT_REGISTRATION_TOKEN: hex(24),
  SECRET_KEYS: `local:${hex(32)}`,
  GATEWAY_ADMIN_EMAIL: 'admin@switch.local',
  GATEWAY_ADMIN_PASSWORD: hex(24),
  FRONTEND_BASE_URL: 'http://localhost:3000',
  GATEWAY_PUBLIC_URL: 'http://localhost:8000',
  MATTERMOST_ADMIN_USER: 'admin',
  MATTERMOST_ADMIN_PASSWORD: hex(24),
  MATTERMOST_TEAM_NAME: 'switch',
  MATTERMOST_USER: 'user',
  MATTERMOST_USER_PASSWORD: hex(24),
  OUTBOUND_ALLOWED_PRIVATE_HOSTS: 'localhost',
  TELEMETRY_ENABLED: 'false',
};

const body = Object.entries(values)
  .map(([key, value]) => `${key}=${value}`)
  .join('\n');

writeFileSync(target, `${body}\n`, { mode: 0o600 });
console.log('Wrote infra/.env with fresh secrets.');
