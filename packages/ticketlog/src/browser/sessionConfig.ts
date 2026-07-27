import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const railwaySessionDir = "/data/ticketlog-session";

export function resolveUserDataDir(): string | undefined {
  return process.env.TICKETLOG_USER_DATA_DIR || (isRailwayRuntime() ? `${railwaySessionDir}/profile` : undefined);
}

export function resolveStorageStatePath(): string | undefined {
  return process.env.TICKETLOG_SESSION_STORAGE_PATH || (isRailwayRuntime() ? `${railwaySessionDir}/storage-state.json` : undefined);
}

export async function hasStorageStateFile(): Promise<boolean> {
  const storageState = resolveStorageStatePath();
  if (!storageState) return false;

  try {
    await access(storageState);
    return true;
  } catch {
    return false;
  }
}

export async function hasUserDataDirState(): Promise<boolean> {
  const userDataDir = resolveUserDataDir();
  if (!userDataDir) return false;

  try {
    const entries = await readdir(userDataDir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

export async function hydrateStorageStateFromEnv(): Promise<"written" | "skipped" | "missing_path"> {
  const storageStatePath = resolveStorageStatePath();
  if (!storageStatePath) return "missing_path";

  const rawBase64 = process.env.TICKETLOG_SESSION_STORAGE_B64?.trim();
  if (!rawBase64) return "skipped";

  const forceWrite = process.env.TICKETLOG_SESSION_STORAGE_FORCE === "true";
  if (!forceWrite && (await hasStorageStateFile())) {
    return "skipped";
  }

  const normalizedBase64 = rawBase64.replace(/\s+/g, "");
  const storageStateBytes = Buffer.from(normalizedBase64, "base64");
  if (storageStateBytes.length === 0) {
    throw new Error("TICKETLOG_SESSION_STORAGE_B64 is empty after base64 decoding");
  }

  await mkdir(dirname(storageStatePath), { recursive: true });
  await writeFile(storageStatePath, storageStateBytes);
  return "written";
}

function isRailwayRuntime(): boolean {
  return Boolean(process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
}
