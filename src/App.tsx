import { useCallback, useEffect, useState } from "react";
import { Dashboard } from "@/components/Dashboard";
import { Assets } from "@/components/Assets";
import { ExpenseEditShell } from "@/components/expense/ExpenseEditShell";
import { EntryForm } from "@/components/EntryForm";
import { History, type HistoryPreset } from "@/components/History";
import { AppShell, type AppView } from "@/components/layout/AppShell";
import { Settings } from "@/components/Settings";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { useAuth } from "@/context/AuthContext";
import type { Expense } from "@/data/mock";

export default function App() {
  const { user, loading, retryBootstrap, profileError } = useAuth();
  const [view, setView] = useState<AppView>("entry");
  const [editing, setEditing] = useState<Expense | null>(null);
  const [historyPreset, setHistoryPreset] = useState<HistoryPreset>(null);
  const [showRetry, setShowRetry] = useState(false);

  const consumeHistoryPreset = useCallback(() => setHistoryPreset(null), []);

  useEffect(() => {
    if (!loading) {
      setShowRetry(false);
      return;
    }
    const timer = window.setTimeout(() => setShowRetry(true), 6000);
    return () => window.clearTimeout(timer);
  }, [loading]);

  if (loading) {
    return (
      <div
        className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground"
        dir="rtl"
      >
        <p>טוען חשבון...</p>
        {showRetry ? (
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted/40"
            onClick={() => void retryBootstrap()}
          >
            נסה שוב
          </button>
        ) : null}
      </div>
    );
  }

  if (!user) return <AuthScreen />;

  return (
    <>
      {profileError ? (
        <div className="mx-auto mt-2 w-full max-w-lg rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {profileError}
        </div>
      ) : null}
      <AppShell view={view} onViewChange={setView}>
        {view === "entry" ? (
          <EntryForm />
        ) : view === "dashboard" ? (
          <Dashboard
            onEditExpense={setEditing}
            onCategoryDrillDown={(categoryId, month) => {
              setHistoryPreset({ month, categoryId });
              setView("history");
            }}
          />
        ) : view === "history" ? (
          <History
            preset={historyPreset}
            onPresetConsumed={consumeHistoryPreset}
            onEditExpense={setEditing}
          />
        ) : view === "assets" ? (
          <Assets />
        ) : (
          <Settings />
        )}
      </AppShell>
      <ExpenseEditShell
        expense={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </>
  );
}
