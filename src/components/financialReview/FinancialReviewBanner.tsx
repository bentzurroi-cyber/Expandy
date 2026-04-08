import { useCallback, useMemo, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { useFinancialReviewModal } from "@/context/FinancialReviewModalContext";
import { useI18n } from "@/context/I18nContext";
import {
  dismissStorageKey,
  isFinancialReviewDayToday,
  todayYmdLocal,
} from "@/lib/financialReviewDay";
import { cn } from "@/lib/utils";

export function FinancialReviewBanner() {
  const { profile } = useAuth();
  const { t, dir } = useI18n();
  const { openFinancialReviewModal } = useFinancialReviewModal();
  const [dismissed, setDismissed] = useState(false);

  const ymd = useMemo(() => todayYmdLocal(), []);

  const show = useMemo(() => {
    if (dismissed) return false;
    if (typeof window === "undefined") return false;
    try {
      if (window.localStorage.getItem(dismissStorageKey(ymd)) === "1") return false;
    } catch {
      /* ignore */
    }
    return isFinancialReviewDayToday(profile?.review_day ?? null);
  }, [dismissed, profile?.review_day, ymd]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(dismissStorageKey(ymd), "1");
    } catch {
      /* ignore */
    }
  }, [ymd]);

  return (
    <>
      {show ? (
      <div
        className={cn(
          "relative mb-2 overflow-hidden rounded-3xl border border-border/40",
          "bg-gradient-to-br from-violet-500/10 via-background to-teal-500/10",
          "px-5 py-6 shadow-sm",
        )}
        dir={dir}
      >
        <div className="pointer-events-none absolute -end-10 -top-10 size-36 rounded-full bg-violet-400/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-12 -start-12 size-40 rounded-full bg-teal-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-700 dark:text-violet-300">
                <Sparkles className="size-5" aria-hidden />
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  {t.financialReviewBannerKicker}
                </p>
                <p className="text-base font-semibold leading-snug text-foreground">
                  {t.financialReviewBannerTitle}
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t.financialReviewBannerSubtitle}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              aria-label={t.financialReviewBannerDismiss}
            >
              <X className="size-4" />
            </button>
          </div>
          <Button
            type="button"
            className="h-11 w-full rounded-2xl text-sm font-medium sm:w-auto sm:self-end"
            onClick={() => openFinancialReviewModal()}
          >
            {t.financialReviewBannerCta}
          </Button>
        </div>
      </div>
      ) : null}
    </>
  );
}
