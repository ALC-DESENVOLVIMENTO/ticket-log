const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function formatRequestProtocol(requestId: string): string {
  const compact = String(requestId ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
  const short = compact.slice(0, 8) || "SEMID";
  return `TL-${short}`;
}

export function parseRequestLookup(input: string): {
  requestId?: string;
  compactPrefix?: string;
} {
  const raw = String(input ?? "").trim();
  if (!raw) return {};

  if (UUID_PATTERN.test(raw)) {
    return { requestId: raw.toLowerCase() };
  }

  const compact = raw.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const withoutPrefix = compact.startsWith("TL") ? compact.slice(2) : compact;
  if (/^[A-F0-9]{6,12}$/i.test(withoutPrefix)) {
    return { compactPrefix: withoutPrefix.toLowerCase() };
  }

  return {};
}
