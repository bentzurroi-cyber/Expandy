export type GoalForAllocation = {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  isInvestmentPortfolio: boolean;
  color: string;
  icon: string;
  /** Lower = chosen first when splitting partial surplus. */
  priority: number;
  targetMode?: "fixed" | "open";
};

export type MonthSurplusRow = {
  type: string;
  amount?: number;
  currency?: string;
};

/** Income minus expenses for the month in ILS (caller supplies convertToILS). */
export function computeMonthSurplusIls(
  rows: MonthSurplusRow[],
  rateDateIso: string,
  convertToILS: (amount: number, currency: string, rateDate: string) => number,
): number {
  let inc = 0;
  let exp = 0;
  for (const e of rows) {
    if (!e || typeof e.amount !== "number" || !Number.isFinite(e.amount)) continue;
    const ils = convertToILS(e.amount, e.currency ?? "ILS", rateDateIso);
    if (e.type === "income") inc += ils;
    else exp += ils;
  }
  return Math.round((inc - exp) * 100) / 100;
}

export type SurplusAllocation = {
  surplus: number;
  /** Non-investment goal with room below target (largest gap first). */
  savingsGoal: GoalForAllocation | null;
  amountToSavings: number;
  /** First investment-portfolio goal, if any. */
  investmentGoal: GoalForAllocation | null;
  amountToInvestment: number;
};

function savingsGap(g: GoalForAllocation): number {
  if (g.targetMode === "open") return Number.POSITIVE_INFINITY;
  return Math.max(0, g.targetAmount - g.currentAmount);
}

function sortSavingsCandidates(
  a: { g: GoalForAllocation; gap: number; pri: number },
  b: { g: GoalForAllocation; gap: number; pri: number },
): number {
  if (a.pri !== b.pri) return a.pri - b.pri;
  const aInf = !Number.isFinite(a.gap);
  const bInf = !Number.isFinite(b.gap);
  if (aInf && !bInf) return -1;
  if (!aInf && bInf) return 1;
  if (aInf && bInf) return a.g.id.localeCompare(b.g.id);
  return b.gap - a.gap;
}

/**
 * Split surplus: fill largest savings gap first, remainder to the first investment goal by priority (if any).
 */
export function allocateSurplusToGoals(
  surplus: number,
  goals: GoalForAllocation[],
): SurplusAllocation {
  const s = Math.max(0, Math.round(surplus * 100) / 100);
  if (s <= 0 || !goals.length) {
    return {
      surplus: s,
      savingsGoal: null,
      amountToSavings: 0,
      investmentGoal: null,
      amountToInvestment: 0,
    };
  }

  const savingCandidates = goals
    .filter((g) => !g.isInvestmentPortfolio)
    .map((g) => ({
      g,
      gap: savingsGap(g),
      pri: Number.isFinite(g.priority) ? g.priority : 50,
    }))
    .filter((x) => x.gap > 0.009)
    .sort(sortSavingsCandidates);

  const primary = savingCandidates[0]?.g ?? null;
  const gapPrimary = primary ? savingsGap(primary) : 0;
  const toSavings = primary
    ? Number.isFinite(gapPrimary)
      ? Math.min(s, gapPrimary)
      : s
    : 0;
  const rest = Math.max(0, Math.round((s - toSavings) * 100) / 100);

  const invCandidates = goals
    .filter((g) => g.isInvestmentPortfolio)
    .slice()
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));
  const inv = invCandidates[0] ?? null;
  const toInv = inv && rest > 0.009 ? rest : 0;

  return {
    surplus: s,
    savingsGoal: primary,
    amountToSavings: Math.round(toSavings * 100) / 100,
    investmentGoal: inv,
    amountToInvestment: Math.round(toInv * 100) / 100,
  };
}

/** Goal row used only for monthly catch-up sequencing (surplus step). */
export type MonthlyCatchUpGoalInput = {
  id: string;
  monthlyContribution: number;
  monthlyCurrent: number;
  targetAmount: number;
  currentAmount: number;
  /** Lower = filled first when surplus only partially covers monthly gaps. */
  priority: number;
  monthlyMode: "fixed" | "surplus";
  targetMode: "fixed" | "open";
};

/**
 * Consume surplus sequentially for monthly-plan gaps (priority first, then largest monthly gap),
 * then return what is left for the surplus compass (`allocateSurplusToGoals`).
 */
export function allocateSurplusToMonthlyGapsFirst(
  surplus: number,
  goalsBehindMonthly: MonthlyCatchUpGoalInput[],
): { surplusAfterMonthly: number; monthlyByGoalId: Record<string, number> } {
  const monthlyByGoalId: Record<string, number> = {};
  let remaining = Math.max(0, Math.round(surplus * 100) / 100);
  const ordered = [...goalsBehindMonthly].sort((a, b) => {
    const pa = Number.isFinite(a.priority) ? a.priority : 50;
    const pb = Number.isFinite(b.priority) ? b.priority : 50;
    if (pa !== pb) return pa - pb;
    const ga =
      a.monthlyMode === "surplus"
        ? remaining
        : Math.max(0, Math.ceil(a.monthlyContribution - a.monthlyCurrent));
    const gb =
      b.monthlyMode === "surplus"
        ? remaining
        : Math.max(0, Math.ceil(b.monthlyContribution - b.monthlyCurrent));
    return gb - ga;
  });
  for (const g of ordered) {
    const gapMonth =
      g.monthlyMode === "surplus"
        ? remaining
        : Math.max(0, Math.ceil(g.monthlyContribution - g.monthlyCurrent));
    const gapTarget =
      g.targetMode === "open"
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Math.ceil(g.targetAmount - g.currentAmount));
    const cap = Number.isFinite(gapTarget) ? Math.min(gapMonth, gapTarget) : gapMonth;
    const y = Math.min(cap, remaining);
    if (y > 0.009) {
      monthlyByGoalId[g.id] = (monthlyByGoalId[g.id] ?? 0) + y;
      remaining = Math.max(0, Math.round((remaining - y) * 100) / 100);
    }
  }
  return { surplusAfterMonthly: remaining, monthlyByGoalId };
}
