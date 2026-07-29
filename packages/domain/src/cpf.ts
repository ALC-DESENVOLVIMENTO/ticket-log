function onlyDigits(input: string): string {
  return input.replace(/\D/g, "");
}

export function normalizeCpf(input: string): string {
  return onlyDigits(input);
}

export function maskCpf(input: string): string {
  const cpf = normalizeCpf(input);
  if (cpf.length !== 11) return "***.***.***-**";
  return `${cpf.slice(0, 3)}.***.***-${cpf.slice(-2)}`;
}

export function isValidCpf(input: string): boolean {
  const cpf = normalizeCpf(input);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split("").map(Number);

  const calculateDigit = (sliceLength: number) => {
    const total = digits
      .slice(0, sliceLength)
      .reduce((sum, digit, index) => sum + digit * (sliceLength + 1 - index), 0);
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calculateDigit(9) === digits[9] && calculateDigit(10) === digits[10];
}
