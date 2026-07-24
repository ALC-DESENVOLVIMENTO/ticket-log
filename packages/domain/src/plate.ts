const OLD_BR_PLATE = /^[A-Z]{3}[0-9]{4}$/;
const MERCOSUL_PLATE = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/;

export function normalizePlate(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function isValidBrazilianPlate(input: string): boolean {
  const plate = normalizePlate(input);
  return OLD_BR_PLATE.test(plate) || MERCOSUL_PLATE.test(plate);
}

export function maskPlate(input: string): string {
  const plate = normalizePlate(input);
  if (plate.length < 4) return "***";
  return `${plate.slice(0, 3)}***${plate.slice(-1)}`;
}
