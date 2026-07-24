FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
RUN npm install
COPY . .
RUN npm run build -w @ticketlog/web
CMD ["npm", "run", "start", "-w", "@ticketlog/web", "--", "--port", "3000"]
