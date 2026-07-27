import { access, readdir } from "node:fs/promises";

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

function isRailwayRuntime(): boolean {
  return Boolean(process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
}
