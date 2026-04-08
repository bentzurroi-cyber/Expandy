/** Months to reach target from current_amount with fixed monthly_contribution (ILS). */
export function monthsToReachSavingsGoal(
  currentAmount: number,
  targetAmount: number,
  monthlyContribution: number,
): number | null {
  if (!Number.isFinite(currentAmount) || !Number.isFinite(targetAmount)) return null;
  if (targetAmount <= currentAmount) return 0;
  if (!Number.isFinite(monthlyContribution) || monthlyContribution <= 0) return null;
  const remaining = targetAmount - currentAmount;
  return Math.ceil(remaining / monthlyContribution);
}

export function formatSavingsEtaMonths(
  months: number | null,
  lang: "he" | "en",
): string {
  if (months === null) {
    return lang === "he" ? "לא ניתן להעריך (הוסיפו הפרשה חודשית)" : "Add a monthly amount to estimate";
  }
  if (months === 0) {
    return lang === "he" ? "הגעת ליעד" : "Goal reached";
  }
  if (months === 1) {
    return lang === "he" ? "כ־חודש אחד" : "~1 month";
  }
  if (lang === "he") {
    if (months >= 12) {
      const y = Math.floor(months / 12);
      const m = months % 12;
      const parts: string[] = [];
      if (y > 0) parts.push(y === 1 ? "שנה" : `${y} שנים`);
      if (m > 0) parts.push(`${m} חודשים`);
      return `כ־${parts.join(" ו־")}`;
    }
    return `כ־${months} חודשים`;
  }
  if (months >= 12) {
    const y = Math.floor(months / 12);
    const m = months % 12;
    const yPart = y === 1 ? "~1 year" : `~${y} years`;
    if (m === 0) return yPart;
    return `~${y} yr ${m} mo`;
  }
  return `~${months} months`;
}
