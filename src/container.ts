import { Container } from '@cloudflare/containers';
import type { StopParams } from '@cloudflare/containers';
import { env } from 'cloudflare:workers';

const DEFAULT_PORT = 18789;
const DEFAULT_BIND = '0.0.0.0';

const EXPLICIT_ENV_KEYS = [
  'CONTAINER_MODE',
  'CONTAINER_STATUS_MESSAGE',
  'CONTAINER_VERSION',
  'CONTAINER_PORT',
  'CONTAINER_BIND',
  'MOLTBOT_GATEWAY_PORT',
  'MOLTBOT_GATEWAY_BIND',
  'MOLTBOT_GATEWAY_AUTH_MODE',
  'MOLTBOT_GATEWAY_VERBOSE',
  'MOLTBOT_ALLOW_UNCONFIGURED',
  'MOLTBOT_CLI',
  'MOLTBOT_WORKSPACE_DIR',
  'CLAWDBOT_WORKSPACE_DIR',
  'CLAWDBOT_STATE_DIR',
  'CLAWDBOT_AUTO_APPROVE_DEVICES',
  'CLAWDBOT_AUTO_APPROVE_NODES',
  'CLAWDBOT_AUTO_APPROVE_INTERVAL_MS',
  'MOLTBOT_CONFIG_JSON',
  'CLAWDBOT_CONFIG_PATH',
  'CLAWDBOT_GATEWAY_TOKEN',
  'CLAWDBOT_GATEWAY_PASSWORD',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_REGION',
  'S3_PATH_STYLE',
  'S3_PREFIX',
  'S3_MOUNT_POINT',
  'S3_MOUNT_REQUIRED',
  'TIGRISFS_ARGS',
] as const;

const runtimeEnv: Record<string, unknown> = env as Record<string, unknown>;
let didLogContainerConfig = false;

type ContainerDiagnostics = {
  bind: string;
  port: number;
  bindSource: string;
  portSource: string;
  explicitEnvKeys: string[];
  containerEnvKeyCount: number;
  containerEnvKeys: string[];
};

function readEnvString(key: string): string | undefined {
  const value = runtimeEnv[key];
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function listStringEnvEntries(): [string, string][] {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (typeof value === 'string') {
      entries.push([key, value]);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      entries.push([key, String(value)]);
    }
  }
  return entries;
}

function listPresentEnvKeys(keys: readonly string[]): string[] {
  const present: string[] = [];
  for (const key of keys) {
    if (readEnvString(key)) {
      present.push(key);
    }
  }
  return present;
}

function resolvePortSource(): string {
  if (readEnvString('CONTAINER_PORT')) return 'CONTAINER_PORT';
  if (readEnvString('PORT')) return 'PORT';
  return 'default';
}

function resolveBindSource(): string {
  if (readEnvString('CONTAINER_BIND')) return 'CONTAINER_BIND';
  return 'default';
}

function resolvePort(value?: string): number {
  if (!value) return DEFAULT_PORT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PORT;
  return parsed;
}

function buildContainerEnv(): Record<string, string> {
  const entries = listStringEnvEntries();
  for (const key of EXPLICIT_ENV_KEYS) {
    const value = readEnvString(key);
    if (value !== undefined) {
      entries.push([key, value]);
    }
  }
  return Object.fromEntries(entries);
}

const containerEnv = buildContainerEnv();
const resolvedPort = resolvePort(env.CONTAINER_PORT ?? env.PORT);
const resolvedBind = env.CONTAINER_BIND ?? DEFAULT_BIND;

function getContainerDiagnostics(): ContainerDiagnostics {
  const containerEnvKeys = Object.keys(containerEnv).sort();
  return {
    bind: resolvedBind,
    port: resolvedPort,
    bindSource: resolveBindSource(),
    portSource: resolvePortSource(),
    explicitEnvKeys: listPresentEnvKeys(EXPLICIT_ENV_KEYS),
    containerEnvKeyCount: containerEnvKeys.length,
    containerEnvKeys,
  };
}

function logContainerConfigOnce() {
  if (didLogContainerConfig) return;
  didLogContainerConfig = true;
  console.info('[worker] 容器环境摘要', getContainerDiagnostics());
}

export class MoltbotContainer extends Container {
  sleepAfter = '10m';
  defaultPort = resolvedPort;
  entrypoint = ['node', '/app/entrypoint.js'];

  envVars = {
    ...containerEnv,
    PORT: resolvedPort.toString(),
    CONTAINER_PORT: resolvedPort.toString(),
    CONTAINER_BIND: resolvedBind,
  };

  async onStart() {
    logContainerConfigOnce();
    console.info('[do] 容器已启动', {
      bind: resolvedBind,
      port: resolvedPort,
    });
  }

  async onStop(params: StopParams) {
    console.warn('[do] 容器已停止', params);
  }

  onError(error: unknown) {
    if (error instanceof Error) {
      console.error('[do] 容器错误', {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
      return error;
    }
    console.error('[do] 容器错误', { error: String(error) });
    return error;
  }
}

const SINGLETON_CONTAINER_ID = 'cf-singleton-moltbot';

export async function forwardRequestToContainer(request: Request) {
  logContainerConfigOnce();
  const url = new URL(request.url);
  console.info('[worker] 转发到容器', {
    method: request.method,
    path: url.pathname,
  });
  const objectId = env.MOLTBOT_CONTAINER.idFromName(SINGLETON_CONTAINER_ID);
  const container = env.MOLTBOT_CONTAINER.get(objectId, {
    locationHint: 'wnam',
  });

  try {
    return await container.fetch(request);
  } catch (error) {
    let details: Record<string, unknown> | undefined;
    if (error instanceof Error) {
      details = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
    console.error('[worker] 转发容器失败', {
      message: String(error),
      details,
    });
    throw error;
  }
}
