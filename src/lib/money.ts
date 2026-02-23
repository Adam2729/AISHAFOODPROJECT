export function roundCurrency(amount: number) {
  return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
}
