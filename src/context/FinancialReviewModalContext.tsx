import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { FinancialReviewModal } from "@/components/financialReview/FinancialReviewModal";

type FinancialReviewModalContextValue = {
  /** Opens the month-close flow immediately (e.g. from settings or tests). */
  openFinancialReviewModal: () => void;
};

const FinancialReviewModalContext = createContext<FinancialReviewModalContextValue | null>(
  null,
);

export function FinancialReviewModalHost({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openFinancialReviewModal = useCallback(() => setOpen(true), []);
  const value = useMemo(
    () => ({ openFinancialReviewModal }),
    [openFinancialReviewModal],
  );
  return (
    <FinancialReviewModalContext.Provider value={value}>
      {children}
      {open ? (
        <FinancialReviewModal open={open} onOpenChange={setOpen} />
      ) : null}
    </FinancialReviewModalContext.Provider>
  );
}

export function useFinancialReviewModal(): FinancialReviewModalContextValue {
  const ctx = useContext(FinancialReviewModalContext);
  if (!ctx) {
    throw new Error("useFinancialReviewModal must be used within FinancialReviewModalHost");
  }
  return ctx;
}
