FROM node:20-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker-playwright/package.json apps/worker-playwright/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/ticketlog/package.json packages/ticketlog/package.json
COPY packages/whatsapp/package.json packages/whatsapp/package.json

RUN npm install --include=optional
RUN npm install @rolldown/binding-linux-x64-gnu@1.1.5 --no-save

COPY . .
RUN npm run build:web

CMD ["npm", "run", "start", "-w", "@ticketlog/web", "--", "--port", "3000"]
