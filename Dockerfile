FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV NPM_CONFIG_LOGLEVEL=info

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    git \
    g++ \
    make \
    python3 \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g clawdbot@latest

COPY container-status/entrypoint.js /app/entrypoint.js
COPY container-status/status-server.js /app/status-server.js

EXPOSE 18789

CMD ["node", "/app/entrypoint.js"]
