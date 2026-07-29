const DEFAULT_APP_TIME_ZONE = "America/Sao_Paulo";

export function appTimeZone(env: Record<string, string | undefined> = process.env): string {
  return env.APP_TIME_ZONE ?? env.TZ ?? DEFAULT_APP_TIME_ZONE;
}

export function formatAppDateTime(
  value: Date | string | number,
  env: Record<string, string | undefined> = process.env,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: appTimeZone(env),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}
