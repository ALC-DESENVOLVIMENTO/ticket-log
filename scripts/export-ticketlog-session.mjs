import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const storageStatePath =
  process.argv[2] ??
  "C:/Users/Wesley/Documents/Dev Alc/Projetos/ticket-log-abastecimento/packages/ticketlog/.secrets/ticketlog-storage.json";

const bytes = await readFile(storageStatePath);
const gzipBase64 = gzipSync(bytes).toString("base64");
const sha256 = createHash("sha256").update(bytes).digest("hex");

console.log(
  JSON.stringify(
    {
      storageStatePath,
      bytes: bytes.length,
      sha256,
      gzipBase64Length: gzipBase64.length,
      gzipBase64,
    },
    null,
    2,
  ),
);
