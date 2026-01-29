FROM node:22-bookworm

ENV NODE_ENV=production

ARG TIGRISFS_VERSION=1.2.1
ARG MOLTBOT_VERSION=latest

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      fuse \
      ca-certificates \
      curl \
      git; \
    \
    curl -fsSL "https://github.com/tigrisdata/tigrisfs/releases/download/v${TIGRISFS_VERSION}/tigrisfs_${TIGRISFS_VERSION}_linux_amd64.deb" -o /tmp/tigrisfs.deb; \
    dpkg -i /tmp/tigrisfs.deb; \
    rm -f /tmp/tigrisfs.deb; \
    \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

RUN npm install -g "moltbot@${MOLTBOT_VERSION}"

COPY config /opt/config-init

RUN install -m 755 /dev/stdin /entrypoint.sh <<'SCRIPT'
#!/bin/bash
set -e

MOUNT_POINT="/root/s3"
STATE_DIR="${MOLTBOT_STATE_DIR:-$MOUNT_POINT/moltbot}"
WORKSPACE_DIR="${MOLTBOT_WORKSPACE_DIR:-$MOUNT_POINT/clawd}"
CONFIG_INIT_DIR="/opt/config-init/moltbot"
CONFIG_PATH="${MOLTBOT_CONFIG_PATH:-$STATE_DIR/moltbot.json}"

DEFAULT_PORT="${MOLTBOT_GATEWAY_PORT:-18789}"
DEFAULT_BIND="${MOLTBOT_GATEWAY_BIND:-lan}"

reset_mountpoint() {
  mountpoint -q "$MOUNT_POINT" 2>/dev/null && fusermount -u "$MOUNT_POINT" 2>/dev/null || true
  rm -rf "$MOUNT_POINT"
  mkdir -p "$MOUNT_POINT"
}

setup_dirs() {
  mkdir -p "$STATE_DIR" "$WORKSPACE_DIR"
  export MOLTBOT_STATE_DIR="$STATE_DIR"
  export CLAWDBOT_STATE_DIR="$STATE_DIR"
  export MOLTBOT_GATEWAY_PORT="$DEFAULT_PORT"
  export CLAWDBOT_GATEWAY_PORT="$DEFAULT_PORT"
  export MOLTBOT_GATEWAY_BIND="$DEFAULT_BIND"
  export CLAWDBOT_GATEWAY_BIND="$DEFAULT_BIND"
  export HOME="${HOME:-/root}"
  if [ ! -e "/root/.clawdbot" ]; then
    ln -s "$STATE_DIR" "/root/.clawdbot" 2>/dev/null || true
  fi
}

write_default_config() {
  if [ -n "$MOLTBOT_CONFIG_JSON" ]; then
    printf "%s" "$MOLTBOT_CONFIG_JSON" > "$CONFIG_PATH"
    return
  fi
  if [ -f "$CONFIG_INIT_DIR/moltbot.json" ]; then
    cp "$CONFIG_INIT_DIR/moltbot.json" "$CONFIG_PATH"
    return
  fi
  cat > "$CONFIG_PATH" <<EOF
{
  "gateway": {
    "mode": "local",
    "bind": "${DEFAULT_BIND}",
    "port": ${DEFAULT_PORT}
  },
  "agents": {
    "defaults": {
      "workspace": "${WORKSPACE_DIR}"
    }
  }
}
EOF
}

cleanup() {
  echo "[INFO] Shutting down..."
  if [ -n "$BOT_PID" ]; then
    kill -TERM "$BOT_PID" 2>/dev/null || true
    wait "$BOT_PID" 2>/dev/null || true
  fi
  if mountpoint -q "$MOUNT_POINT" 2>/dev/null; then
    fusermount -u "$MOUNT_POINT" 2>/dev/null || true
  fi
}

trap cleanup SIGTERM SIGINT

reset_mountpoint

if [ -z "$S3_ENDPOINT" ] || [ -z "$S3_BUCKET" ] || [ -z "$S3_ACCESS_KEY_ID" ] || [ -z "$S3_SECRET_ACCESS_KEY" ]; then
  echo "[WARN] Incomplete S3 config, using local directory mode"
else
  echo "[INFO] Mounting S3: ${S3_BUCKET} -> ${MOUNT_POINT}"

  export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
  export AWS_REGION="${S3_REGION:-auto}"
  export AWS_S3_PATH_STYLE="${S3_PATH_STYLE:-false}"

  /usr/bin/tigrisfs --endpoint "$S3_ENDPOINT" ${TIGRISFS_ARGS:-} -f "${S3_BUCKET}${S3_PREFIX:+:$S3_PREFIX}" "$MOUNT_POINT" &
  sleep 3

  if ! mountpoint -q "$MOUNT_POINT"; then
    echo "[ERROR] S3 mount failed"
    exit 1
  fi
  echo "[OK] S3 mounted successfully"
fi

setup_dirs

if [ ! -f "$CONFIG_PATH" ]; then
  write_default_config
fi

echo "[INFO] Starting Moltbot gateway..."
moltbot gateway --allow-unconfigured --bind "$DEFAULT_BIND" --port "$DEFAULT_PORT" $MOLTBOT_ARGS &
BOT_PID=$!
wait $BOT_PID
SCRIPT

WORKDIR /root/s3
EXPOSE 18789

CMD ["/entrypoint.sh"]
