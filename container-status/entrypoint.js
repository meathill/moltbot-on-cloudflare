'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_PORT = 18789;
const DEFAULT_BIND_MODE = 'lan';
const DEFAULT_CONFIG_PATH = '/root/.clawdbot/moltbot.json';
const DEFAULT_R2_MOUNT_POINT = '/root/s3';
const DEFAULT_STATE_SUBDIR = '.clawdbot';
const DEFAULT_WORKSPACE_SUBDIR = 'workspace';
const DEFAULT_AUTO_APPROVE_INTERVAL = 4000;
let didLogNetInfo = false;

function readEnvString(key) {
  const value = process.env[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

function parsePort(value) {
  if (!value) return DEFAULT_PORT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PORT;
  return parsed;
}

function parseBoolean(value) {
  if (!value) return false;
  return value.toLowerCase() === 'true';
}

function parseInterval(value) {
  if (!value) return DEFAULT_AUTO_APPROVE_INTERVAL;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AUTO_APPROVE_INTERVAL;
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeConfigFile(configPath, configBody) {
  const targetDir = path.dirname(configPath);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(configPath, configBody, 'utf8');
}

function recordProbe(probe) {
  globalThis.__moltbotProbe = probe;
  try {
    process.env.MOLTBOT_PROBE_JSON = JSON.stringify(probe);
  } catch (error) {
    process.env.MOLTBOT_PROBE_JSON = JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function recordStartError(error) {
  const payload = {
    message: error instanceof Error ? error.message : String(error),
  };
  if (error instanceof Error && error.stack) {
    payload.stack = error.stack;
  }
  globalThis.__moltbotStartError = payload;
  try {
    process.env.MOLTBOT_START_ERROR = JSON.stringify(payload);
  } catch (err) {
    process.env.MOLTBOT_START_ERROR = JSON.stringify({
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function recordMountStatus(status) {
  globalThis.__moltbotR2Mount = status;
  try {
    process.env.MOLTBOT_R2_MOUNT_STATUS = JSON.stringify(status);
  } catch (error) {
    process.env.MOLTBOT_R2_MOUNT_STATUS = JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function runSync(command, args) {
  const result = spawnSync(command, args, {
    env: process.env,
    encoding: 'utf8',
  });
  const error =
    result.error && result.error instanceof Error
      ? { message: result.error.message, code: result.error.code }
      : result.error
        ? { message: String(result.error) }
        : null;
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error,
  };
}

function resolveNpmGlobalBin() {
  const result = runSync('npm', ['bin', '-g']);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || { message: 'npm bin -g failed' },
      stdout: result.stdout,
      stderr: result.stderr,
      value: null,
    };
  }
  return {
    ok: true,
    value: result.stdout.trim(),
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function resolveNpmGlobalRoot() {
  const result = runSync('npm', ['root', '-g']);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || { message: 'npm root -g failed' },
      stdout: result.stdout,
      stderr: result.stderr,
      value: null,
    };
  }
  return {
    ok: true,
    value: result.stdout.trim(),
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function resolveMountPoint() {
  return readEnvString('S3_MOUNT_POINT') || DEFAULT_R2_MOUNT_POINT;
}

function listMissingS3Keys(config) {
  const missing = [];
  if (!config.endpoint) missing.push('S3_ENDPOINT');
  if (!config.bucket) missing.push('S3_BUCKET');
  if (!config.accessKeyId) missing.push('S3_ACCESS_KEY_ID');
  if (!config.secretAccessKey) missing.push('S3_SECRET_ACCESS_KEY');
  return missing;
}

function readS3Config() {
  return {
    endpoint: readEnvString('S3_ENDPOINT'),
    bucket: readEnvString('S3_BUCKET'),
    accessKeyId: readEnvString('S3_ACCESS_KEY_ID'),
    secretAccessKey: readEnvString('S3_SECRET_ACCESS_KEY'),
    region: readEnvString('S3_REGION') || 'auto',
    pathStyle: readEnvString('S3_PATH_STYLE') || 'false',
    prefix: readEnvString('S3_PREFIX'),
  };
}

function normalizePrefix(prefix) {
  if (!prefix) return undefined;
  return prefix.replace(/^\/+/, '');
}

function buildBucketSpec(config) {
  const prefix = normalizePrefix(config.prefix);
  if (prefix) return `${config.bucket}:${prefix}`;
  return config.bucket;
}

function isMountPoint(mountPoint) {
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8');
    const lines = mounts.split('\n');
    for (const line of lines) {
      if (!line) continue;
      const parts = line.split(' ');
      if (parts.length < 2) continue;
      const mountedPath = parts[1].replace(/\\040/g, ' ');
      if (mountedPath === mountPoint) return true;
    }
  } catch (error) {
    return false;
  }
  return false;
}

function unmountIfMounted(mountPoint) {
  if (!isMountPoint(mountPoint)) return;
  const result = runSync('fusermount', ['-u', mountPoint]);
  if (!result.ok) {
    runSync('umount', [mountPoint]);
  }
}

function ensureCleanMountPoint(mountPoint) {
  unmountIfMounted(mountPoint);
  fs.rmSync(mountPoint, { recursive: true, force: true });
  fs.mkdirSync(mountPoint, { recursive: true });
}

function applyPersistentPaths(mountPoint) {
  const stateDir =
    readEnvString('CLAWDBOT_STATE_DIR') || path.join(mountPoint, DEFAULT_STATE_SUBDIR);
  const workspaceDir =
    readEnvString('MOLTBOT_WORKSPACE_DIR') ||
    readEnvString('CLAWDBOT_WORKSPACE_DIR') ||
    path.join(mountPoint, DEFAULT_WORKSPACE_SUBDIR);

  process.env.CLAWDBOT_STATE_DIR = stateDir;
  process.env.MOLTBOT_WORKSPACE_DIR = workspaceDir;
  if (!readEnvString('CLAWDBOT_CONFIG_PATH')) {
    process.env.CLAWDBOT_CONFIG_PATH = path.join(stateDir, 'moltbot.json');
  }

  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });

  return { stateDir, workspaceDir };
}

function parseExtraArgs(value) {
  if (!value) return [];
  return value.trim().split(/\s+/).filter(Boolean);
}

async function mountR2IfConfigured() {
  const mountPoint = resolveMountPoint();
  const s3Config = readS3Config();
  const missing = listMissingS3Keys(s3Config);
  const mountRequiredValue = readEnvString('S3_MOUNT_REQUIRED');
  const mountRequired =
    mountRequiredValue === undefined
      ? DEFAULT_MOUNT_REQUIRED
      : parseBoolean(mountRequiredValue);

  if (missing.length > 0) {
    recordMountStatus({
      enabled: false,
      mountPoint,
      missing,
    });
    return { mounted: false, skipped: true };
  }

  ensureCleanMountPoint(mountPoint);

  process.env.AWS_ACCESS_KEY_ID = s3Config.accessKeyId;
  process.env.AWS_SECRET_ACCESS_KEY = s3Config.secretAccessKey;
  process.env.AWS_REGION = s3Config.region;
  process.env.AWS_S3_PATH_STYLE = s3Config.pathStyle;

  const bucketSpec = buildBucketSpec(s3Config);
  const tigrisArgs = [
    '--endpoint',
    s3Config.endpoint,
    ...parseExtraArgs(readEnvString('TIGRISFS_ARGS')),
    '-f',
    bucketSpec,
    mountPoint,
  ];

  console.log('[entrypoint] 挂载 R2', {
    bucket: s3Config.bucket,
    prefix: normalizePrefix(s3Config.prefix),
    mountPoint,
  });

  const child = spawn('/usr/bin/tigrisfs', tigrisArgs, {
    env: process.env,
    stdio: 'inherit',
  });
  let spawnError = null;
  child.on('error', (error) => {
    spawnError = error;
  });

  for (let i = 0; i < MOUNT_CHECK_RETRIES; i += 1) {
    if (isMountPoint(mountPoint)) {
      const paths = applyPersistentPaths(mountPoint);
      recordMountStatus({
        enabled: true,
        mounted: true,
        mountPoint,
        bucket: s3Config.bucket,
        prefix: normalizePrefix(s3Config.prefix),
        stateDir: paths.stateDir,
        workspaceDir: paths.workspaceDir,
      });
      console.log('[entrypoint] R2 挂载成功', { mountPoint });
      return { mounted: true };
    }
    await sleep(MOUNT_CHECK_INTERVAL_MS);
  }

  const error = new Error(
    spawnError
      ? `R2 挂载失败：${spawnError instanceof Error ? spawnError.message : String(spawnError)}`
      : 'R2 挂载失败：未检测到挂载点',
  );
  recordMountStatus({
    enabled: true,
    mounted: false,
    mountPoint,
    bucket: s3Config.bucket,
    prefix: normalizePrefix(s3Config.prefix),
    error: error.message,
  });

  if (mountRequired) {
    child.kill('SIGTERM');
    throw error;
  }

  console.warn('[entrypoint] R2 挂载失败，将继续使用本地目录', {
    mountPoint,
  });
  return { mounted: false };
}

function probeCommand(command) {
  const result = runSync(command, ['--version']);
  return {
    command,
    ok: result.ok,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
}

function loadPackageBin(npmRoot, packageName) {
  if (!npmRoot) return null;
  const packageDir = path.join(npmRoot, packageName);
  const manifestPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const bin = manifest.bin;
    if (!bin) {
      return {
        packageName,
        bin: null,
        binPath: null,
        manifestBinType: typeof bin,
        manifestName: manifest.name,
        manifestVersion: manifest.version,
      };
    }
    if (typeof bin === 'string') {
      return {
        packageName,
        bin,
        binPath: path.join(packageDir, bin),
        manifestName: manifest.name,
        manifestVersion: manifest.version,
      };
    }
    if (typeof bin === 'object') {
      const preferredKeys = ['moltbot', 'clawdbot', 'clawd'];
      const binKeys = Object.keys(bin);
      const selectedKey = preferredKeys.find((key) => key in bin) ?? binKeys[0];
      if (!selectedKey) {
        return {
          packageName,
          bin,
          binPath: null,
          manifestName: manifest.name,
          manifestVersion: manifest.version,
        };
      }
      return {
        packageName,
        bin,
        binPath: path.join(packageDir, bin[selectedKey]),
        manifestName: manifest.name,
        manifestVersion: manifest.version,
      };
    }
  } catch (error) {
    return {
      packageName,
      bin: null,
      binPath: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return null;
}

function resolvePackageEntry(npmRoot, packageName) {
  if (!npmRoot) return null;
  const packageDir = path.join(npmRoot, packageName);
  const entryPath = path.join(packageDir, 'moltbot.mjs');
  if (!fs.existsSync(entryPath)) {
    return { packageName, entryPath, exists: false };
  }
  return { packageName, entryPath, exists: true };
}

function resolveMoltbotCommand() {
  const explicit = readEnvString('MOLTBOT_CLI');
  const npmBin = resolveNpmGlobalBin();
  const npmRoot = resolveNpmGlobalRoot();
  const pathValue = process.env.PATH || '';
  const binCandidates = [];
  if (npmBin.ok && npmBin.value) {
    binCandidates.push(
      path.join(npmBin.value, 'moltbot'),
      path.join(npmBin.value, 'clawdbot'),
      path.join(npmBin.value, 'clawd'),
    );
  }

  const commandCandidates = explicit
    ? [explicit]
    : ['moltbot', 'clawdbot', 'clawd', ...binCandidates];

  const probes = [];
  for (const candidate of commandCandidates) {
    const probe = probeCommand(candidate);
    probes.push(probe);
    if (probe.ok) {
      return {
        command: candidate,
        argsPrefix: [],
        probes,
        npmGlobalBin: npmBin,
        npmGlobalRoot: npmRoot,
        path: pathValue,
      };
    }
  }

  const entryProbe = resolvePackageEntry(npmRoot.ok ? npmRoot.value : null, 'moltbot');
  if (entryProbe?.exists) {
    return {
      command: 'node',
      argsPrefix: [entryProbe.entryPath],
      probes,
      npmGlobalBin: npmBin,
      npmGlobalRoot: npmRoot,
      path: pathValue,
      packageEntry: entryProbe,
    };
  }

  const packageCandidates = ['moltbot', 'clawdbot', '@moltbot/cli', '@clawdbot/cli'];
  const packageBins = packageCandidates
    .map((name) => loadPackageBin(npmRoot.ok ? npmRoot.value : null, name))
    .filter(Boolean);

  for (const entry of packageBins) {
    if (entry && entry.binPath && fs.existsSync(entry.binPath)) {
      return {
        command: 'node',
        argsPrefix: [entry.binPath],
        probes,
        npmGlobalBin: npmBin,
        npmGlobalRoot: npmRoot,
        path: pathValue,
        packageBins,
      };
    }
  }

  return {
    command: null,
    argsPrefix: [],
    probes,
    npmGlobalBin: npmBin,
    npmGlobalRoot: npmRoot,
    path: pathValue,
    packageBins,
  };
}

function buildCliArgs(resolved, extraArgs) {
  const prefix = resolved.argsPrefix ?? [];
  return [...prefix, ...extraArgs];
}

function resolveGatewayPort() {
  return parsePort(
    readEnvString('CLAWDBOT_GATEWAY_PORT') ||
    readEnvString('MOLTBOT_GATEWAY_PORT') ||
    readEnvString('CONTAINER_PORT') ||
    readEnvString('PORT'),
  );
}

function resolveGatewayUrl() {
  const explicit = readEnvString('CLAWDBOT_GATEWAY_URL') || readEnvString('MOLTBOT_GATEWAY_URL');
  if (explicit) return explicit;
  const bindMode =
    readEnvString('CLAWDBOT_GATEWAY_BIND') ||
    readEnvString('MOLTBOT_GATEWAY_BIND') ||
    DEFAULT_BIND_MODE;
  const port = resolveGatewayPort();
  if (bindMode === 'loopback') {
    return `ws://127.0.0.1:${port}`;
  }
  const lanAddress = resolveLanAddress();
  if (lanAddress) {
    return `ws://${lanAddress}:${port}`;
  }
  return `ws://127.0.0.1:${port}`;
}

function resolveLanAddress() {
  const interfaces = os.networkInterfaces();
  const preferred = ['eth0', 'ens5', 'ens4', 'en0'];
  for (const name of preferred) {
    const addrs = interfaces[name];
    if (!Array.isArray(addrs)) continue;
    const addr = addrs.find((item) => item && item.family === 'IPv4' && !item.internal);
    if (addr?.address) return addr.address;
  }
  for (const addrs of Object.values(interfaces)) {
    if (!Array.isArray(addrs)) continue;
    for (const addr of addrs) {
      if (addr && addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return undefined;
}

function logNetworkInfoOnce() {
  if (didLogNetInfo) return;
  didLogNetInfo = true;
  if (readEnvString('DIAGNOSTICS_ENABLED') !== 'true') return;
  try {
    const interfaces = os.networkInterfaces();
    console.log('[entrypoint] 网络接口摘要', {
      interfaces,
      resolvedLanAddress: resolveLanAddress(),
    });
  } catch (error) {
    console.warn('[entrypoint] 网络接口摘要失败', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function collectPendingRequestIds(payload) {
  const ids = new Set();
  if (!payload) return [];
  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (typeof item === 'string') {
        ids.add(item);
        continue;
      }
      if (item && typeof item === 'object') {
        const requestId = item.requestId || item.id;
        if (typeof requestId === 'string') {
          ids.add(requestId);
        }
      }
    }
    return Array.from(ids);
  }
  if (typeof payload === 'object') {
    const listCandidates = [
      payload.pending,
      payload.requests,
      payload.nodes,
      payload.items,
      payload.list,
    ].filter(Boolean);
    for (const list of listCandidates) {
      ids.add(...collectPendingRequestIds(list));
    }
    if (payload.pending && typeof payload.pending === 'object' && !Array.isArray(payload.pending)) {
      for (const key of Object.keys(payload.pending)) {
        ids.add(key);
      }
    }
  }
  return Array.from(ids);
}

function runCli(command, args, onDone) {
  const child = spawn(command, args, {
    env: process.env,
  });
  let stdout = '';
  let stderr = '';
  if (child.stdout) {
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
  }
  if (child.stderr) {
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
  }
  child.on('close', (code) => {
    onDone(code ?? 1, stdout, stderr);
  });
}

function startAutoApproveDevices(resolved) {
  const explicitDevices = readEnvString('CLAWDBOT_AUTO_APPROVE_DEVICES');
  const legacyNodes = readEnvString('CLAWDBOT_AUTO_APPROVE_NODES');
  const enabled = parseBoolean(explicitDevices ?? legacyNodes);
  if (!enabled) return;
  const interval = parseInterval(readEnvString('CLAWDBOT_AUTO_APPROVE_INTERVAL_MS'));
  const gatewayUrl = resolveGatewayUrl();
  const gatewayToken = readEnvString('CLAWDBOT_GATEWAY_TOKEN');
  if (explicitDevices === undefined && legacyNodes !== undefined) {
    console.log('[entrypoint] CLAWDBOT_AUTO_APPROVE_NODES 已弃用，建议改用 CLAWDBOT_AUTO_APPROVE_DEVICES');
  }
  console.log('[entrypoint] 自动配对设备已开启', { interval, gatewayUrl });

  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    const pendingArgs = buildCliArgs(resolved, ['devices', 'list', '--json', '--url', gatewayUrl]);
    if (gatewayToken) {
      pendingArgs.push('--token', gatewayToken);
    }
    runCli(resolved.command, pendingArgs, (code, stdout, stderr) => {
      running = false;
      if (code !== 0) {
        console.warn('[entrypoint] 读取设备配对列表失败', { code, stderr: stderr.trim() });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(stdout);
      } catch (error) {
        console.warn('[entrypoint] 设备配对列表输出非 JSON', {
          error: error instanceof Error ? error.message : String(error),
          stdout: stdout.trim(),
        });
        return;
      }
      const ids = collectPendingRequestIds(payload);
      if (ids.length === 0) {
        return;
      }
      for (const id of ids) {
        const approveArgs = buildCliArgs(resolved, ['devices', 'approve', id, '--url', gatewayUrl]);
        if (gatewayToken) {
          approveArgs.push('--token', gatewayToken);
        }
        runCli(resolved.command, approveArgs, (approveCode, approveOut, approveErr) => {
          if (approveCode === 0) {
            console.log('[entrypoint] 已自动配对设备', { id });
            return;
          }
          console.warn('[entrypoint] 自动配对设备失败', {
            id,
            code: approveCode,
            stderr: approveErr.trim(),
            stdout: approveOut.trim(),
          });
        });
      }
    });
  }, interval);
}

function buildDefaultConfig() {
  const bindMode =
    readEnvString('CLAWDBOT_GATEWAY_BIND') ||
    readEnvString('MOLTBOT_GATEWAY_BIND') ||
    DEFAULT_BIND_MODE;
  const port = resolveGatewayPort();
  const authMode = readEnvString('MOLTBOT_GATEWAY_AUTH_MODE') || 'token';
  const token = readEnvString('CLAWDBOT_GATEWAY_TOKEN');
  const password = readEnvString('CLAWDBOT_GATEWAY_PASSWORD');
  const workspaceDir =
    readEnvString('MOLTBOT_WORKSPACE_DIR') || readEnvString('CLAWDBOT_WORKSPACE_DIR');

  if (bindMode !== 'loopback') {
    if (authMode === 'password' && !password) {
      throw new Error('CLAWDBOT_GATEWAY_PASSWORD 未设置，无法在非 loopback 绑定下启动');
    }
    if (authMode !== 'password' && !token) {
      throw new Error('CLAWDBOT_GATEWAY_TOKEN 未设置，无法在非 loopback 绑定下启动');
    }
  }

  const auth =
    authMode === 'password'
      ? { mode: 'password', password }
      : { mode: 'token', token };

  const config = {
    gateway: {
      mode: 'local',
      bind: bindMode,
      port,
      auth,
    },
  };

  if (workspaceDir) {
    config.agents = {
      defaults: {
        workspace: workspaceDir,
      },
    };
  }

  return JSON.stringify(config, null, 2);
}

function startStatusServer() {
  require('./status-server');
}

function startMoltbot() {
  logNetworkInfoOnce();
  const resolved = resolveMoltbotCommand();
  recordProbe(resolved);
  if (!resolved.command) {
    recordStartError(new Error('未找到 Moltbot CLI，可用命令均不可执行'));
    console.error('[entrypoint] 未找到 Moltbot CLI', resolved.probes);
    startStatusServer();
    return;
  }
  const configPath = readEnvString('CLAWDBOT_CONFIG_PATH') || DEFAULT_CONFIG_PATH;
  const configJson = readEnvString('MOLTBOT_CONFIG_JSON') || buildDefaultConfig();

  writeConfigFile(configPath, configJson);
  process.env.CLAWDBOT_CONFIG_PATH = configPath;
  process.env.MOLTBOT_CONFIG_PATH = configPath;

  const args = [...(resolved.argsPrefix ?? []), 'gateway'];
  if (readEnvString('MOLTBOT_GATEWAY_VERBOSE') === 'true') {
    args.push('--verbose');
  }
  if (readEnvString('MOLTBOT_ALLOW_UNCONFIGURED') === 'true') {
    args.push('--allow-unconfigured');
  }

  console.log('[entrypoint] 启动 Moltbot Gateway', {
    configPath,
    bind:
      readEnvString('CLAWDBOT_GATEWAY_BIND') ||
      readEnvString('MOLTBOT_GATEWAY_BIND') ||
      DEFAULT_BIND_MODE,
    port: resolveGatewayPort(),
    command: resolved.command,
    argsPrefix: resolved.argsPrefix,
  });

  const child = spawn(resolved.command, args, {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('error', (error) => {
    console.error('[entrypoint] 无法启动 moltbot', {
      message: error instanceof Error ? error.message : String(error),
    });
    recordStartError(error);
    startStatusServer();
  });

  child.on('exit', (code) => {
    if (code === 0) {
      process.exit(0);
    }
    recordStartError(new Error(`Moltbot 已退出，退出码 ${code ?? 'unknown'}`));
    startStatusServer();
  });

  startAutoApproveDevices(resolved);

  ['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => {
      child.kill(signal);
    });
  });
}

const mode = (readEnvString('CONTAINER_MODE') || 'status').toLowerCase();

if (mode === 'probe') {
  const resolved = resolveMoltbotCommand();
  recordProbe(resolved);
  startStatusServer();
} else if (mode === 'moltbot') {
  startMoltbot().catch((error) => {
    console.error('[entrypoint] Moltbot 启动失败', {
      message: error instanceof Error ? error.message : String(error),
    });
    recordStartError(error);
    startStatusServer();
  });
} else {
  startStatusServer();
}
