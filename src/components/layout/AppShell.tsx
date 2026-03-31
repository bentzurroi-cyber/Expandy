import { History, Landmark, LayoutDashboard, PlusCircle, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/context/I18nContext";
import { ThemeToggle } from "./ThemeToggle";

export type AppView = "entry" | "dashboard" | "history" | "assets" | "settings";

type AppShellProps = {
  view: AppView;
  onViewChange: (v: AppView) => void;
  children: React.ReactNode;
};

const tabClass = (active: boolean) =>
  cn(
    "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-sm font-medium leading-relaxed transition-colors sm:gap-1 sm:py-3",
    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
  );

export function AppShell({ view, onViewChange, children }: AppShellProps) {
  const { t, lang } = useI18n();
  const headerDir = lang === "en" ? "ltr" : "rtl";
  return (
    <div className="flex min-h-dvh flex-col bg-white pb-[calc(4.25rem+env(safe-area-inset-bottom))] text-zinc-900 dark:bg-zinc-950 dark:text-white">
      <header
        className="sticky top-0 z-40 border-b border-border/80 bg-white/85 backdrop-blur-md dark:bg-zinc-950/85"
        dir={headerDir}
      >
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <img
              src="/logo-internal.png"
              alt=""
              className="h-[3rem] w-auto shrink-0 object-contain opacity-45 dark:opacity-50"
              aria-hidden
            />
            <div
              className={cn(
                "min-w-0",
                lang === "en" ? "text-left" : "text-right",
              )}
            >
              <p className="truncate text-sm font-semibold tracking-tight">
                {t.appName}
              </p>
              <p className="truncate text-sm leading-relaxed text-muted-foreground">
                {t.appTagline}
              </p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col px-4 py-4">
        {children}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border/80 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md dark:bg-zinc-950/95"
        aria-label={t.navMain}
      >
        <div className="mx-auto flex max-w-lg">
          <button
            type="button"
            onClick={() => onViewChange("entry")}
            className={tabClass(view === "entry")}
          >
            <PlusCircle
              className={cn("size-5 sm:size-6", view === "entry" && "text-primary")}
              strokeWidth={view === "entry" ? 2.25 : 1.75}
            />
            {t.navEntry}
          </button>
          <button
            type="button"
            onClick={() => onViewChange("dashboard")}
            className={tabClass(view === "dashboard")}
          >
            <LayoutDashboard
              className={cn(
                "size-5 sm:size-6",
                view === "dashboard" && "text-primary",
              )}
              strokeWidth={view === "dashboard" ? 2.25 : 1.75}
            />
            {t.navDashboard}
          </button>
          <button
            type="button"
            onClick={() => onViewChange("history")}
            className={tabClass(view === "history")}
          >
            <History
              className={cn(
                "size-5 sm:size-6",
                view === "history" && "text-primary",
              )}
              strokeWidth={view === "history" ? 2.25 : 1.75}
            />
            {t.navHistory}
          </button>
          <button
            type="button"
            onClick={() => onViewChange("assets")}
            className={tabClass(view === "assets")}
          >
            <Landmark
              className={cn(
                "size-5 sm:size-6",
                view === "assets" && "text-primary",
              )}
              strokeWidth={view === "assets" ? 2.25 : 1.75}
            />
            {t.navAssets}
          </button>
          <button
            type="button"
            onClick={() => onViewChange("settings")}
            className={tabClass(view === "settings")}
          >
            <Settings2
              className={cn(
                "size-5 sm:size-6",
                view === "settings" && "text-primary",
              )}
              strokeWidth={view === "settings" ? 2.25 : 1.75}
            />
            {t.navSettings}
          </button>
        </div>
      </nav>
    </div>
  );
}
