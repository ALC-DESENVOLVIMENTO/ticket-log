FROM node:20-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages packages
RUN npm install
COPY . .
RUN npm run build
CMD ["npm", "run", "start", "-w", "@ticketlog/api"]
