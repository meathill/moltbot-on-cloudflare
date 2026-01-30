import { env } from 'cloudflare:workers';
import {
  DO_DIAGNOSTICS_ENDPOINT,
  SINGLETON_CONTAINER_ID,
  forwardRequestToContainer,
  getContainerDiagnostics,
} from './container';

export { MoltbotContainer } from './container';

const DIAGNOSTICS_PATH = '/__diag';
const DO_DIAGNOSTICS_PATH = '/__do';
const runtimeEnv: Record<string, unknown> = env as Record<string, unknown>;

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

function verifyBasicAuth(request: Request): Response | null {
  const password = env.SERVER_PASSWORD;
  if (!password) {
    return null;
  }

  const username = env.SERVER_USERNAME ?? 'moltbot';
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Basic ')) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Moltbot"' },
    });
  }

  const expected = btoa(`${username}:${password}`);
  const provided = authorization.slice(6);

  if (provided !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  return null;
}

let didLogWorkerConfig = false;

function logWorkerConfigOnce() {
  if (didLogWorkerConfig) return;
  didLogWorkerConfig = true;
  console.info('[worker] 基础鉴权配置摘要', {
    hasServerPassword: Boolean(env.SERVER_PASSWORD),
    hasServerUsername: Boolean(env.SERVER_USERNAME),
  });
}

function logRequest(request: Request) {
  const url = new URL(request.url);
  console.info('[worker] 收到请求', {
    method: request.method,
    path: url.pathname,
  });
}

function buildWorkerDiagnostics() {
  return {
    hasServerPassword: Boolean(env.SERVER_PASSWORD),
    hasServerUsername: Boolean(env.SERVER_USERNAME),
    diagnosticsEnabled: readEnvString('DIAGNOSTICS_ENABLED') === 'true',
  };
}

function isDiagnosticsRequest(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname === DIAGNOSTICS_PATH || url.searchParams.has('__diag');
}

function isDoDiagnosticsRequest(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname === DO_DIAGNOSTICS_PATH || url.searchParams.has('__do');
}

function isDiagnosticsEnabled(): boolean {
  return readEnvString('DIAGNOSTICS_ENABLED') === 'true';
}

async function handleDoDiagnostics(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') ?? 'state';
  const objectId = env.MOLTBOT_CONTAINER.idFromName(SINGLETON_CONTAINER_ID);
  const container = env.MOLTBOT_CONTAINER.get(objectId, {
    locationHint: 'wnam',
  });
  const doUrl = new URL(request.url);
  doUrl.pathname = DO_DIAGNOSTICS_ENDPOINT;
  doUrl.search = `action=${encodeURIComponent(action)}`;
  return container.fetch(
    new Request(doUrl.toString(), {
      method: 'GET',
    }),
  );
}

async function handleFetch(request: Request) {
  logWorkerConfigOnce();
  logRequest(request);
  const authError = verifyBasicAuth(request);
  if (authError) {
    return authError;
  }
  if (isDoDiagnosticsRequest(request)) {
    if (!isDiagnosticsEnabled()) {
      return new Response('Diagnostics disabled', { status: 404 });
    }
    return handleDoDiagnostics(request);
  }
  if (isDiagnosticsRequest(request)) {
    if (!isDiagnosticsEnabled()) {
      return new Response('Diagnostics disabled', { status: 404 });
    }
    const payload = {
      worker: buildWorkerDiagnostics(),
      container: getContainerDiagnostics(),
    };
    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  return forwardRequestToContainer(request);
}

export default {
  fetch: handleFetch,
} satisfies ExportedHandler<Cloudflare.Env>;
