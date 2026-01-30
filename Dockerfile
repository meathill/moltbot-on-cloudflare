FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV NPM_CONFIG_LOGLEVEL=info

ARG TIGRISFS_VERSION=1.2.1

WORKDIR /app

RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    fuse \
    git \
    g++ \
    make \
    python3 \
    util-linux; \
  \
  curl -fsSL "https://github.com/tigrisdata/tigrisfs/releases/download/v${TIGRISFS_VERSION}/tigrisfs_${TIGRISFS_VERSION}_linux_amd64.deb" -o /tmp/tigrisfs.deb; \
  dpkg -i /tmp/tigrisfs.deb; \
  rm -f /tmp/tigrisfs.deb; \
  \
  rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

RUN npm install -g clawdbot@latest

COPY container-status/entrypoint.js /app/entrypoint.js
COPY container-status/status-server.js /app/status-server.js

EXPOSE 18789

CMD ["node", "/app/entrypoint.js"]
