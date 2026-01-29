import { Container } from '@cloudflare/containers';
import { env } from 'cloudflare:workers';

const DEFAULT_PORT = 18789;
const DEFAULT_BIND = 'lan';

const containerEnv = Object.fromEntries(Object.entries(env).filter(([, value]) => typeof value === 'string'));

function resolvePort(value?: string): number {
  if (!value) return DEFAULT_PORT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PORT;
  return parsed;
}

const resolvedPort = resolvePort(env.MOLTBOT_GATEWAY_PORT ?? env.CLAWDBOT_GATEWAY_PORT ?? env.PORT);
const resolvedBind = env.MOLTBOT_GATEWAY_BIND ?? env.CLAWDBOT_GATEWAY_BIND ?? DEFAULT_BIND;

export class MoltbotContainer extends Container {
  sleepAfter = '10m';
  defaultPort = resolvedPort;

  envVars = {
    ...containerEnv,
    PORT: resolvedPort.toString(),
    MOLTBOT_GATEWAY_PORT: resolvedPort.toString(),
    CLAWDBOT_GATEWAY_PORT: resolvedPort.toString(),
    MOLTBOT_GATEWAY_BIND: resolvedBind,
    CLAWDBOT_GATEWAY_BIND: resolvedBind,
  };
}

const SINGLETON_CONTAINER_ID = 'cf-singleton-moltbot';

export async function forwardRequestToContainer(request: Request) {
  const objectId = env.MOLTBOT_CONTAINER.idFromName(SINGLETON_CONTAINER_ID);
  const container = env.MOLTBOT_CONTAINER.get(objectId, {
    locationHint: 'wnam',
  });

  return container.fetch(request);
}
