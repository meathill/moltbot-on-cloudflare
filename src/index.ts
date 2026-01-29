import { env } from 'cloudflare:workers';
import { forwardRequestToContainer } from './container';

export { MoltbotContainer } from './container';

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

async function handleFetch(request: Request) {
  const authError = verifyBasicAuth(request);
  if (authError) {
    return authError;
  }
  return forwardRequestToContainer(request);
}

export default {
  fetch: handleFetch,
} satisfies ExportedHandler<Cloudflare.Env>;
