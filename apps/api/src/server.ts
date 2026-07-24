import Fastify from "fastify";
import cors from "@fastify/cors";
import { approvalRoutes } from "./routes/approvals.js";
import { authRoutes } from "./routes/authRoutes.js";
import { healthRoutes } from "./routes/health.js";
import { requestRoutes } from "./routes/requests.js";
import { whatsappRoutes } from "./routes/whatsapp.js";
import { registerRawJsonParser } from "./rawJson.js";
import { config } from "./config.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
  },
});

registerRawJsonParser(app);

await app.register(cors, {
  origin: true,
  credentials: true,
});

await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(requestRoutes);
await app.register(approvalRoutes);
await app.register(whatsappRoutes);

app.setErrorHandler((error, _request, reply) => {
  const statusCode = (error as any).statusCode ?? 500;
  app.log.error(error);
  reply.code(statusCode).send({
    error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
  });
});

await app.listen({ port: config.port, host: "0.0.0.0" });
