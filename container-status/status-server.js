'use strict';

const http = require('http');

const port = Number(process.env.PORT || process.env.CONTAINER_PORT || 18789);
const host = process.env.CONTAINER_BIND || '0.0.0.0';
const startedAt = new Date().toISOString();

function buildStatus() {
  let probe = globalThis.__moltbotProbe;
  if (!probe && process.env.MOLTBOT_PROBE_JSON) {
    try {
      probe = JSON.parse(process.env.MOLTBOT_PROBE_JSON);
    } catch (error) {
      probe = { error: String(error) };
    }
  }
  let startError = globalThis.__moltbotStartError;
  if (!startError && process.env.MOLTBOT_START_ERROR) {
    try {
      startError = JSON.parse(process.env.MOLTBOT_START_ERROR);
    } catch (error) {
      startError = { message: String(error) };
    }
  }
  let r2Mount = globalThis.__moltbotR2Mount;
  if (!r2Mount && process.env.MOLTBOT_R2_MOUNT_STATUS) {
    try {
      r2Mount = JSON.parse(process.env.MOLTBOT_R2_MOUNT_STATUS);
    } catch (error) {
      r2Mount = { error: String(error) };
    }
  }

  return {
    ok: true,
    message: process.env.CONTAINER_STATUS_MESSAGE || 'ok',
    version: process.env.CONTAINER_VERSION || 'dev',
    mode: process.env.CONTAINER_MODE || 'status',
    probe,
    r2Mount,
    startError,
    pid: process.pid,
    uptime: Math.round(process.uptime()),
    startedAt,
  };
}

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith('/healthz')) {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('ok');
    return;
  }

  if (req.url && req.url.startsWith('/__status')) {
    const body = JSON.stringify(buildStatus());
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(body);
    return;
  }

  const body = JSON.stringify(buildStatus());
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(body);
});

server.listen(port, host, () => {
  console.log(`[status] listening on ${host}:${port}`);
});
