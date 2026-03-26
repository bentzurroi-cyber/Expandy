import type { CSSProperties } from "react";

/** פס מפוספס אדום + צבע הקטגוריה כשעוברים את התקציב */
export function overBudgetStripeStyle(categoryHex: string): CSSProperties {
  const red = "#dc2626";
  return {
    backgroundImage: `repeating-linear-gradient(
      -45deg,
      ${red} 0 5px,
      ${categoryHex} 5px 10px
    )`,
    backgroundColor: categoryHex,
  };
}
