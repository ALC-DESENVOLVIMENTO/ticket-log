FROM mcr.microsoft.com/playwright:v1.46.1-jammy
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/worker-playwright/package.json apps/worker-playwright/package.json
COPY packages packages
RUN npm install
COPY . .
RUN npm run build
CMD ["npm", "run", "start", "-w", "@ticketlog/worker-playwright"]
