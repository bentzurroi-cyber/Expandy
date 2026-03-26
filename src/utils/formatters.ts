import type { CurrencyDef } from "@/data/mock";
import { currencyOptionLabel, formatCurrencyCompact, formatIls } from "@/lib/format";
import { formatNumericInput, parseNumericInput } from "@/lib/numericInput";

export {
  currencyOptionLabel,
  formatCurrencyCompact,
  formatIls,
  formatNumericInput,
  parseNumericInput,
};

export function safeCurrencyOption(
  currencies: CurrencyDef[],
  code: string,
): CurrencyDef {
  return (
    currencies.find((x) => x.code === code) ?? {
      code,
      labelHe: code,
      symbol: "¤",
      iconKey: "badge-cent",
    }
  );
}

