import { formatCurrencyAmount } from "./marketConfig";

export default function formatPrice(amount, cityOrMarket) {
  return formatCurrencyAmount(amount, cityOrMarket);
}
