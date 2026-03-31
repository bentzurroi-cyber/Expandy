import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Download } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/context/I18nContext";
import { cn } from "@/lib/utils";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia("(display-mode: standalone)");
  if (mq.matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

export function InstallAppCard() {
  const { t, dir } = useI18n();
  const [standalone, setStandalone] = useState(() => isStandaloneDisplay());
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);
  const [canInstallViaPrompt, setCanInstallViaPrompt] = useState(false);
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    setStandalone(isStandaloneDisplay());
  }, []);

  useEffect(() => {
    const onDisplayMode = () => setStandalone(isStandaloneDisplay());
    const mql = window.matchMedia("(display-mode: standalone)");
    mql.addEventListener("change", onDisplayMode);
    return () => mql.removeEventListener("change", onDisplayMode);
  }, []);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredRef.current = e as BeforeInstallPromptEvent;
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () =>
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  const onInstallClick = useCallback(async () => {
    if (standalone) return;
    const ev = deferredRef.current;
    if (!ev) return;
    await ev.prompt();
    try {
      await ev.userChoice;
    } catch {
      /* ignore */
    }
    deferredRef.current = null;
    setCanInstallViaPrompt(false);
  }, [standalone]);

  const showAndroidInstall = !standalone && isAndroid();

  return (
    <>
      <Card className="rounded-2xl border-border/80 bg-zinc-100 p-1 shadow-none dark:bg-zinc-900">
        <CardHeader className="space-y-1 px-4 pb-2 pt-4">
          <CardTitle className="text-base">{t.installAppSectionTitle}</CardTitle>
          <CardDescription className="text-base leading-relaxed">
            {t.installAppSectionDesc}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-4 pb-6 pt-0">
          {standalone ? (
            <p className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-base leading-relaxed text-muted-foreground">
              {t.installAppAlreadyInstalled}
            </p>
          ) : isIOS() ? (
            <div className="space-y-4">
              <p className="text-base font-medium leading-relaxed text-foreground">
                {t.installAppIosOnlyIntro}
              </p>
              <section className="space-y-3">
                <h3 className="text-base font-semibold leading-relaxed text-foreground">
                  {t.installAppSafariSectionTitle}
                </h3>
                <ul className="list-none space-y-3 text-pretty text-base leading-relaxed text-muted-foreground">
                  <li>{t.installAppSafariBullet1}</li>
                  <li>{t.installAppSafariBullet2}</li>
                </ul>
              </section>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Button
                type="button"
                variant="ghost"
                className={cn(
                  "h-11 w-full gap-2 text-base font-medium leading-relaxed text-muted-foreground",
                  "hover:bg-muted/40 hover:text-foreground",
                )}
                onClick={() => setGuidelinesOpen(true)}
              >
                <BookOpen className="size-5 shrink-0 opacity-80" aria-hidden />
                {t.installAppGuidelinesButton}
              </Button>

              {showAndroidInstall ? (
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "h-12 w-full gap-2 border-border/80 text-base font-medium leading-relaxed",
                      "shadow-sm transition-colors hover:bg-accent/60",
                    )}
                    onClick={() => void onInstallClick()}
                    disabled={!canInstallViaPrompt}
                  >
                    <Download className="size-5 shrink-0 opacity-80" aria-hidden />
                    {t.installAppButton}
                  </Button>
                  <p className="text-center text-sm leading-relaxed text-muted-foreground">
                    {t.installAppAndroidChromeNote}
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={guidelinesOpen} onOpenChange={setGuidelinesOpen}>
        <DialogContent
          className="max-h-[min(90vh,32rem)] max-w-md gap-0 overflow-y-auto p-0 no-scrollbar sm:max-w-md"
          dir={dir}
        >
          <DialogHeader className="border-b border-border/60 px-5 py-4 text-start">
            <DialogTitle className="text-lg font-semibold leading-relaxed">
              {t.installAppDialogTitle}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t.installAppInstructionsLead} {t.installAppChromeSectionTitle}.{" "}
              {t.installAppSafariSectionTitle}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-10 px-5 py-6">
            <p className="text-base font-medium leading-relaxed text-foreground">
              {t.installAppInstructionsLead}
            </p>

            <section className="space-y-4">
              <h3 className="text-base font-semibold leading-relaxed text-foreground">
                {t.installAppChromeSectionTitle}
              </h3>
              <ul className="list-none space-y-3 text-pretty text-base leading-relaxed text-muted-foreground">
                <li>{t.installAppChromeBullet1}</li>
                <li>{t.installAppChromeBullet2}</li>
              </ul>
            </section>

            <section className="space-y-4">
              <h3 className="text-base font-semibold leading-relaxed text-foreground">
                {t.installAppSafariSectionTitle}
              </h3>
              <ul className="list-none space-y-3 text-pretty text-base leading-relaxed text-muted-foreground">
                <li>{t.installAppSafariBullet1}</li>
                <li>{t.installAppSafariBullet2}</li>
              </ul>
            </section>
          </div>

          <DialogFooter className="border-t border-border/60 px-5 py-4 sm:justify-center">
            <Button
              type="button"
              variant="secondary"
              className="w-full text-base leading-relaxed sm:w-auto"
              onClick={() => setGuidelinesOpen(false)}
            >
              {t.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
