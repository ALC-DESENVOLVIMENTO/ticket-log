function normalizeMoneyInput(input: string): string {
  return input.trim().replace(/[R$\s]/gi, "");
}

export function parseMoneyToCents(input: string): number {
  const normalized = normalizeMoneyInput(input);
  if (!normalized) throw new Error("INVALID_MONEY");

  const value =
    /^[0-9]{1,9},[0-9]{2}$/.test(normalized)
      ? normalized.replace(/\./g, "").replace(",", ".")
      : /^[0-9]{1,9}(\.[0-9]{2})?$/.test(normalized)
        ? normalized
        : /^[0-9]{1,3}(\.[0-9]{3})*(,[0-9]{2})$/.test(normalized)
          ? normalized.replace(/\./g, "").replace(",", ".")
          : null;

  if (!value) throw new Error("INVALID_MONEY");

  const [integerPart, decimalPart = "00"] = value.split(".");
  const cents = Number(integerPart) * 100 + Number(decimalPart.padEnd(2, "0").slice(0, 2));
  if (!Number.isInteger(cents) || cents <= 0) throw new Error("INVALID_AMOUNT");
  return cents;
}

export function centsToAmount(valueInCents: number): number {
  if (!Number.isInteger(valueInCents) || valueInCents < 0) {
    throw new Error("INVALID_AMOUNT");
  }
  return valueInCents / 100;
}

export function parseMoney(input: string): number {
  return centsToAmount(parseMoneyToCents(input));
}

export function assertPositiveAmount(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("INVALID_AMOUNT");
  }
}

export function formatCurrencyInput(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

export function formatMoneyFromCents(valueInCents: number): string {
  return formatCurrencyInput(centsToAmount(valueInCents));
}
