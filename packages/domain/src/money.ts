export function parseMoney(input: string): number {
  const normalized = input
    .trim()
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new Error("INVALID_MONEY");
  return Math.round(value * 100) / 100;
}

export function assertPositiveAmount(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("INVALID_AMOUNT");
  }
}

export function formatCurrencyInput(value: number): string {
  return value.toFixed(2).replace(".", ",");
}
