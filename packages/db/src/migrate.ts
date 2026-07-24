import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, closePool } from "./client.js";

const here = dirname(fileURLToPath(import.meta.url));

async function resolveSchemaPath(): Promise<string> {
  const candidates = [
    join(here, "schema.sql"),
    join(here, "..", "src", "schema.sql"),
    join(here, "..", "..", "src", "schema.sql"),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error("schema.sql not found");
}

async function main() {
  const schemaPath = await resolveSchemaPath();
  const sql = await readFile(schemaPath, "utf8");
  await getPool().query(sql);
  await closePool();
}

main().catch(async (error) => {
  console.error(error);
  await closePool();
  process.exit(1);
});
