import { formatIlsWholeCeil } from "@/lib/format";
import type { SurplusAllocation } from "@/lib/monthlySurplusInsights";

export type SurplusAdviceStrings = {
  monthlyInsightAdviceSplit: string;
  monthlyInsightAdviceSavings: string;
  monthlyInsightAdviceInv: string;
  monthlyInsightAdviceGeneric: string;
};

export function surplusAdviceFromT(
  t: SurplusAdviceStrings,
  allocation: SurplusAllocation,
  surplus: number,
): string {
  const { savingsGoal, amountToSavings, investmentGoal, amountToInvestment } = allocation;
  const y = formatIlsWholeCeil(amountToSavings);
  const rest = formatIlsWholeCeil(amountToInvestment);
  const s = formatIlsWholeCeil(surplus);
  if (savingsGoal && investmentGoal && amountToSavings > 0.009 && amountToInvestment > 0.009) {
    return t.monthlyInsightAdviceSplit
      .replace("{{y}}", y)
      .replace("{{sav}}", savingsGoal.name)
      .replace("{{rest}}", rest)
      .replace("{{inv}}", investmentGoal.name);
  }
  if (savingsGoal && amountToSavings > 0.009) {
    return t.monthlyInsightAdviceSavings.replace("{{y}}", y).replace("{{sav}}", savingsGoal.name);
  }
  if (investmentGoal && amountToInvestment > 0.009) {
    return t.monthlyInsightAdviceInv.replace("{{surplus}}", s).replace("{{inv}}", investmentGoal.name);
  }
  return t.monthlyInsightAdviceGeneric;
}
