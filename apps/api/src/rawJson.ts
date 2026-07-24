import type { FastifyInstance } from "fastify";

export function registerRawJsonParser(app: FastifyInstance): void {
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    try {
      (request as any).rawBody = body;
      const parsed = body.length ? JSON.parse(body.toString("utf8")) : {};
      done(null, parsed);
    } catch (error) {
      done(error as Error);
    }
  });
}
