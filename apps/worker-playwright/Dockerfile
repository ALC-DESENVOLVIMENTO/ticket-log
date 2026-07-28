FROM mcr.microsoft.com/playwright:v1.61.1-jammy
WORKDIR /app

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify nginx \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker-playwright/package.json apps/worker-playwright/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/ticketlog/package.json packages/ticketlog/package.json
COPY packages/whatsapp/package.json packages/whatsapp/package.json

RUN npm install

COPY . .
RUN npm run build:worker
RUN chmod +x apps/worker-playwright/start-station.sh

CMD ["bash", "apps/worker-playwright/start-station.sh"]
