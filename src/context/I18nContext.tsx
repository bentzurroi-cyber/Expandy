import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { he, type HeStrings } from "@/i18n/he";
import { en, type EnStrings } from "@/i18n/en";

export type Language = "he" | "en";
export type Strings = HeStrings | EnStrings;

type I18nContextValue = {
  lang: Language;
  setLang: (l: Language) => void;
  toggleLang: () => void;
  t: Strings;
  dir: "rtl" | "ltr";
};

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "expandy-lang";

function readStoredLang(): Language {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "he" || v === "en") return v;
  } catch {
    /* ignore */
  }
  return "he";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => readStoredLang());

  const dir: "rtl" | "ltr" = lang === "he" ? "rtl" : "ltr";
  const t = (lang === "he" ? he : en) as Strings;

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = dir;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
  }, [lang, dir]);

  const setLang = useCallback((l: Language) => setLangState(l), []);
  const toggleLang = useCallback(
    () => setLangState((prev) => (prev === "he" ? "en" : "he")),
    [],
  );

  const value = useMemo(
    () => ({ lang, setLang, toggleLang, t, dir }),
    [lang, setLang, toggleLang, t, dir],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

