import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { downloadExpensesCsv, type CsvLookup } from "@/lib/exportCsv";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoryGlyph } from "@/components/expense/FinanceGlyphs";
import { ColorBadge } from "@/components/expense/ColorBadge";
import { IconPicker } from "@/components/settings/IconPicker";
import { useAssets } from "@/context/AssetsContext";
import { useBudgets } from "@/context/BudgetContext";
import { useExpenses } from "@/context/ExpensesContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { downloadExpensesXlsx, type XlsxLookup } from "@/lib/exportXlsx";
import {
  downloadEmptyImportCsvTemplate,
  parseExpensesCsv,
} from "@/lib/importCsv";
import {
  ALL_TIME_EXPORT,
  collectYearMonthsFromExpenses,
  formatYearMonth,
  hebrewMonthYearLabel,
  type YearMonth,
} from "@/lib/month";
import { useI18n } from "@/context/I18nContext";
import { cn } from "@/lib/utils";
import { formatNumericInput, parseNumericInput } from "@/utils/formatters";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { InstallAppCard } from "@/components/settings/InstallAppCard";
import { SortableSettingsCategoryList } from "@/components/settings/SortableSettingsCategoryList";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  doesHouseholdCodeExist,
  isValidHouseholdCode,
  normalizeHouseholdCode,
} from "@/lib/household";

async function countProfilesForHousehold(householdId: string): Promise<number> {
  const { count, error } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("household_id", householdId);
  if (error) {
    console.error("[Settings] countProfilesForHousehold", error);
    return -1;
  }
  return count ?? 0;
}

/** Sum of rows across shared tables for this household (expenses, assets, categories, settings). */
async function countHouseholdSharedDataRows(householdId: string): Promise<number> {
  const tables = ["expenses", "assets", "categories", "settings"] as const;
  let sum = 0;
  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    if (error) {
      console.error(`[Settings] countHouseholdSharedDataRows ${table}`, error);
      return Number.POSITIVE_INFINITY;
    }
    sum += count ?? 0;
  }
  return sum;
}

export function SettingsView() {
  const { lang, setLang, t, dir } = useI18n();
  const { user, profile, refreshProfile } = useAuth();
  const { getBudget, setBudget, clearAllUserData: clearBudgetData } =
    useBudgets();
  const {
    clearAllUserData: clearAssetsData,
    assetTypes,
    addAssetType,
    updateAssetType,
    deleteAssetType,
  } = useAssets();
  const {
    expenses,
    expenseCategories,
    incomeSources,
    destinationAccounts,
    paymentMethods,
    currencies,
    addManagedCurrency,
    removeManagedCurrency,
    importData,
    clearAllUserData: clearExpensesData,
    updateExpenseCategory,
    deleteExpenseCategory,
    reorderExpenseCategories,
    reorderIncomeSources,
    updateIncomeSource,
    deleteIncomeSource,
  } = useExpenses();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [moveToId, setMoveToId] = useState<string>("");
  const [deleteIncomeOpen, setDeleteIncomeOpen] = useState(false);
  const [deleteIncomeId, setDeleteIncomeId] = useState<string | null>(null);
  const [moveToIncomeId, setMoveToIncomeId] = useState<string>("");
  const [exportPeriod, setExportPeriod] = useState<
    YearMonth | typeof ALL_TIME_EXPORT
  >(ALL_TIME_EXPORT);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showAllBudgetSettings, setShowAllBudgetSettings] = useState(false);
  const [assetTypesOpen, setAssetTypesOpen] = useState(false);
  const [newAssetTypeName, setNewAssetTypeName] = useState("");
  const [assetDeleteOpen, setAssetDeleteOpen] = useState(false);
  const [assetDeleteId, setAssetDeleteId] = useState<string | null>(null);
  const [moveAssetTypeTo, setMoveAssetTypeTo] = useState("");
  const [showAllExpenseCategoriesSettings, setShowAllExpenseCategoriesSettings] =
    useState(false);
  const [showAllIncomeCategoriesSettings, setShowAllIncomeCategoriesSettings] =
    useState(false);
  const [showAllAssetTypesSettings, setShowAllAssetTypesSettings] = useState(false);
  const [newCurrencyCode, setNewCurrencyCode] = useState("");
  const [joinHouseholdId, setJoinHouseholdId] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [householdMembers, setHouseholdMembers] = useState<string[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [autoFixingHouseholdCode, setAutoFixingHouseholdCode] = useState(false);
  const [displayHouseholdCode, setDisplayHouseholdCode] = useState("");
  const [joinConfirmOpen, setJoinConfirmOpen] = useState(false);
  const [pendingJoinCode, setPendingJoinCode] = useState("");
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [leaveDialogMemberCount, setLeaveDialogMemberCount] = useState<number | null>(null);

  function randomHouseholdCode6(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 6; i += 1) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }

  async function allocateNewHouseholdCode(userId: string): Promise<string> {
    for (let i = 0; i < 40; i += 1) {
      const code = randomHouseholdCode6();
      const { error } = await supabase.from("households").insert({
        code,
        created_by: userId,
      });
      if (!error) return code;
      console.error("[Settings] households insert failed", {
        attempt: i + 1,
        code,
        error: error.message,
      });
      if (error.code === "23505") continue;
      throw new Error(error.message);
    }
    throw new Error("Could not allocate new household code");
  }

  useEffect(() => {
    setDisplayHouseholdCode(normalizeHouseholdCode(profile?.household_id ?? ""));
  }, [profile?.household_id]);

  useEffect(() => {
    if (!leaveConfirmOpen) {
      setLeaveDialogMemberCount(null);
      return;
    }
    const code = normalizeHouseholdCode(profile?.household_id ?? "");
    if (!code) {
      setLeaveDialogMemberCount(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const n = await countProfilesForHousehold(code);
      if (!cancelled && n >= 0) setLeaveDialogMemberCount(n);
    })();
    return () => {
      cancelled = true;
    };
  }, [leaveConfirmOpen, profile?.household_id]);

  const loadHouseholdMembers = useCallback(async () => {
    const code = normalizeHouseholdCode(profile?.household_id ?? "");
    if (!isValidHouseholdCode(code)) {
      setHouseholdMembers([]);
      setMembersError(null);
      setMembersLoading(false);
      return;
    }
    setMembersLoading(true);
    setMembersError(null);
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("household_id", code)
      .order("email", { ascending: true });
    if (error) {
      setHouseholdMembers([]);
      setMembersError(
        lang === "he"
          ? `טעינת חברי משק הבית נכשלה: ${error.message}`
          : `Failed to load household members: ${error.message}`,
      );
      setMembersLoading(false);
      return;
    }
    const emails = (data ?? [])
      .map((row) => (typeof row.email === "string" ? row.email.trim() : ""))
      .filter(Boolean);
    setHouseholdMembers(emails);
    setMembersLoading(false);
  }, [lang, profile?.household_id]);

  useEffect(() => {
    if (!user?.id) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (t !== undefined) clearTimeout(t);
      t = setTimeout(() => {
        void loadHouseholdMembers();
      }, 400);
    };
    const channel = supabase
      .channel(`profiles-members-sync-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        schedule,
      )
      .subscribe();
    return () => {
      if (t !== undefined) clearTimeout(t);
      void supabase.removeChannel(channel);
    };
  }, [user?.id, loadHouseholdMembers]);

  useEffect(() => {
    void loadHouseholdMembers();
  }, [loadHouseholdMembers]);

  useEffect(() => {
    if (!profile?.household_id) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadHouseholdMembers();
    };
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => void loadHouseholdMembers(), 25000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [profile?.household_id, loadHouseholdMembers]);

  useEffect(() => {
    async function migrateLegacyHouseholdCode() {
      if (!user?.id || !profile?.household_id) return;
      if (isValidHouseholdCode(profile.household_id)) return;
      setAutoFixingHouseholdCode(true);
      try {
        const newCode = await allocateNewHouseholdCode(user.id);
        const { error } = await supabase
          .from("profiles")
          .update({ household_id: newCode })
          .eq("id", user.id);
        if (error) {
          console.error("[Settings] legacy household code migration failed", {
            userId: user.id,
            error: error.message,
          });
          return;
        }
        await refreshProfile();
      } catch (err) {
        console.error("[Settings] auto-fix household code crashed", err);
      } finally {
        setAutoFixingHouseholdCode(false);
      }
    }
    void migrateLegacyHouseholdCode();
  }, [profile?.household_id, refreshProfile, user?.id]);

  const csvLookup = useMemo<CsvLookup>(
    () => ({
      categoryName(type, id) {
        const list = type === "income" ? incomeSources : expenseCategories;
        return list.find((c) => c.id === id)?.name ?? id;
      },
      paymentName(type, id) {
        const list =
          type === "income" ? destinationAccounts : paymentMethods;
        return list.find((p) => p.id === id)?.name ?? id;
      },
    }),
    [expenseCategories, incomeSources, destinationAccounts, paymentMethods],
  );

  const sorted = useMemo(() => [...expenseCategories], [expenseCategories]);

  const expenseCountByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of expenses) {
      if (e.type !== "expense") continue;
      m.set(e.categoryId, (m.get(e.categoryId) ?? 0) + 1);
    }
    return m;
  }, [expenses]);

  const incomeCountByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of expenses) {
      if (e.type !== "income") continue;
      m.set(e.categoryId, (m.get(e.categoryId) ?? 0) + 1);
    }
    return m;
  }, [expenses]);

  const sortedIncome = useMemo(() => [...incomeSources], [incomeSources]);

  const budgetRowsVisible = useMemo(() => {
    if (showAllBudgetSettings || sorted.length <= 5) return sorted;
    return sorted.slice(0, 5);
  }, [sorted, showAllBudgetSettings]);

  const exportMonthOptions = useMemo(() => {
    const cur = formatYearMonth(new Date());
    const from = collectYearMonthsFromExpenses(expenses.map((e) => e.date));
    const uniq = new Set<YearMonth>([cur, ...from]);
    return [...uniq].sort((a, b) => b.localeCompare(a));
  }, [expenses]);

  const xlsxLookup = useMemo<XlsxLookup>(
    () => ({
      categoryName(type, id) {
        const list = type === "income" ? incomeSources : expenseCategories;
        return list.find((c) => c.id === id)?.name ?? id;
      },
      paymentName(type, id) {
        const list =
          type === "income" ? destinationAccounts : paymentMethods;
        return list.find((p) => p.id === id)?.name ?? id;
      },
    }),
    [expenseCategories, incomeSources, destinationAccounts, paymentMethods],
  );

  function exportRowsForPeriod() {
    return exportPeriod === ALL_TIME_EXPORT
      ? expenses
      : expenses.filter((e) => e.date.startsWith(exportPeriod));
  }

  function onExportXlsx() {
    const rows = exportRowsForPeriod();
    const suffix =
      exportPeriod === ALL_TIME_EXPORT ? "kol-hazman" : exportPeriod;
    downloadExpensesXlsx(
      rows,
      `expandy-hozaot-${suffix}.xlsx`,
      currencies,
      xlsxLookup,
    );
  }

  function onExportCsv() {
    const rows = exportRowsForPeriod();
    const suffix =
      exportPeriod === ALL_TIME_EXPORT ? "kol-hazman" : exportPeriod;
    downloadExpensesCsv(rows, `expandy-hozaot-${suffix}.csv`, csvLookup);
  }

  function onDownloadTemplate() {
    downloadEmptyImportCsvTemplate();
  }

  function onPickCsvFile() {
    fileInputRef.current?.click();
  }

  function onCsvFileSelected(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      window.alert("נא לבחור קובץ CSV תקין (.csv).");
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      window.alert("לא הצלחנו לקרוא את הקובץ. נסו שוב.");
    };
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const { rows, missingHeaders, errors } = parseExpensesCsv(text);
        if (missingHeaders.length) {
          window.alert(
            `קובץ ה-CSV לא בפורמט הנכון. חסרים העמודות: ${missingHeaders.join(", ")}`,
          );
          return;
        }
        if (errors.length) {
          window.alert(`שגיאת CSV: ${errors[0]}`);
        }

        if (!rows.length) {
          window.alert("לא נמצאו שורות תקינות לייבוא. בדקו את הקובץ.");
          return;
        }
        const res = importData(rows);
        window.alert(
          `הייבוא הושלם: ${res.imported} שורות נוספות. ${
            res.skipped ? `(${res.skipped} שורות נדחו)` : ""
          }${res.newCategories ? ` · נוספו ${res.newCategories} קטגוריות` : ""}${
            res.newMethods ? ` · נוספו ${res.newMethods} אמצעי תשלום/חשבונות` : ""
          }`,
        );
      } catch {
        window.alert("אירעה שגיאה בזמן ייבוא. נסו קובץ אחר.");
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };

    reader.readAsText(file, "utf-8");
  }

  async function onClearAllData() {
    await clearExpensesData();
    clearAssetsData();
    clearBudgetData();
    window.alert(t.clearAllDataSuccess);
    window.location.reload();
  }

  async function onCopyHouseholdId() {
    const id = profile?.household_id?.trim();
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      window.alert(lang === "he" ? "מזהה משק הבית הועתק." : "Household ID copied.");
    } catch {
      window.alert(id);
    }
  }

  async function onJoinHousehold() {
    const nextId = normalizeHouseholdCode(joinHouseholdId);
    if (!nextId || !user?.id) return;
    if (!/^[A-Z0-9]{6}$/.test(nextId)) {
      window.alert(
        lang === "he"
          ? "אנא הזן קוד משק בית תקין בן 6 תווים."
          : "Please enter a valid 6-character household code.",
      );
      return;
    }
    setJoinLoading(true);
    try {
      const exists = await doesHouseholdCodeExist(nextId);
      if (!exists) {
        window.alert(
          lang === "he"
            ? "לא מצאנו משק בית עם הקוד הזה. אפשר לנסות שוב בנחת."
            : "We could not find a household with this code. Please try again.",
        );
        return;
      }
      setPendingJoinCode(nextId);
      setJoinConfirmOpen(true);
    } catch {
      window.alert(
        lang === "he"
          ? "לא הצלחנו לאמת את הקוד כרגע. נסה שוב בעוד רגע."
          : "Could not validate the code right now. Please try again.",
      );
    } finally {
      setJoinLoading(false);
    }
  }

  async function handleJoinHousehold(importPreviousData: boolean) {
    const nextId = pendingJoinCode;
    const oldHouseholdId = normalizeHouseholdCode(profile?.household_id ?? "");
    if (!nextId || !user?.id) return;
    setJoinLoading(true);
    try {
      const exists = await doesHouseholdCodeExist(nextId);
      if (!exists) {
        window.alert(lang === "he" ? "הקוד כבר לא קיים. נסה שוב." : "Code no longer exists.");
        return;
      }
      // Move expenses first while profile.household_id still matches those rows (RLS).
      if (importPreviousData && oldHouseholdId && oldHouseholdId !== nextId) {
        const { error: migrateError } = await supabase
          .from("expenses")
          .update({ household_id: nextId })
          .eq("user_id", user.id)
          .eq("household_id", oldHouseholdId);
        if (migrateError) {
          window.alert(
            lang === "he"
              ? `ייבוא הנתונים נכשל: ${migrateError.message}`
              : `Could not import your expenses: ${migrateError.message}`,
          );
          return;
        }
      }
      const { error: updateProfileError } = await supabase
        .from("profiles")
        .update({ household_id: nextId })
        .eq("id", user.id);
      if (updateProfileError) {
        window.alert(
          lang === "he"
            ? `הצטרפות למשק הבית נכשלה: ${updateProfileError.message}`
            : `Failed to join household: ${updateProfileError.message}`,
        );
        return;
      }
      await refreshProfile();
      const { data: refreshedProfile } = await supabase
        .from("profiles")
        .select("household_id")
        .eq("id", user.id)
        .maybeSingle();
      if (normalizeHouseholdCode(refreshedProfile?.household_id ?? "") !== nextId) {
        window.alert(
          lang === "he"
            ? "ההצטרפות עוד לא הסתנכרנה. נסה שוב בעוד רגע."
            : "Join has not synced yet. Please try again in a moment.",
        );
        return;
      }
      setDisplayHouseholdCode(nextId);
      setJoinHouseholdId("");
      setPendingJoinCode("");
      setJoinConfirmOpen(false);
      void loadHouseholdMembers();
      window.alert(
        lang === "he"
          ? "הצטרפת בהצלחה למשק הבית. הנתונים המשותפים מוכנים."
          : "Joined household successfully. Shared data is ready.",
      );
    } finally {
      setJoinLoading(false);
    }
  }

  async function handleLogout() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      window.location.href = "/";
    } catch (err) {
      console.error("[Settings] handleLogout crashed", err);
      window.alert(
        `Logout Error: ${err instanceof Error ? err.message : "Unknown logout error"}`,
      );
    }
  }

  async function handleLeaveHousehold(mode: "fresh" | "take-data") {
    if (!user?.id) return;
    setLeaveLoading(true);
    try {
      const oldHouseholdId = normalizeHouseholdCode(profile?.household_id ?? "");
      if (!oldHouseholdId) {
        window.alert(
          lang === "he" ? "אין משק בית פעיל." : "No active household.",
        );
        return;
      }

      const memberCount = await countProfilesForHousehold(oldHouseholdId);
      if (memberCount < 0) {
        window.alert(
          lang === "he"
            ? "לא הצלחנו לבדוק את מספר החברים. נסה שוב."
            : "Could not verify household members. Please try again.",
        );
        return;
      }

      const newCode = await allocateNewHouseholdCode(user.id);
      if (mode === "take-data") {
        if (oldHouseholdId && oldHouseholdId !== newCode) {
          const { error: migrateMineError } = await supabase
            .from("expenses")
            .update({ household_id: newCode })
            .eq("user_id", user.id)
            .eq("household_id", oldHouseholdId);
          if (migrateMineError) {
            window.alert(`Update Error: ${migrateMineError.message}`);
            return;
          }
        }
      }

      const dataFootprint = await countHouseholdSharedDataRows(oldHouseholdId);
      const lastMemberAlone = memberCount === 1;
      const canDeleteEmptyHouseholdRow =
        lastMemberAlone && dataFootprint === 0;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ household_id: newCode })
        .eq("id", user.id);
      if (updateError) {
        window.alert(`Update Error: ${updateError.message}`);
        return;
      }

      if (canDeleteEmptyHouseholdRow) {
        const { error: delErr } = await supabase
          .from("households")
          .delete()
          .eq("code", oldHouseholdId);
        if (delErr) {
          console.warn("[Settings] leave: could not remove empty household row", delErr);
        }
      }

      setDisplayHouseholdCode(newCode);
      await refreshProfile();
      setLeaveConfirmOpen(false);
      void loadHouseholdMembers();
      window.alert(
        lang === "he"
          ? `עודכן קוד משק בית חדש: ${newCode}`
          : `New household code updated: ${newCode}`,
      );
    } catch (err) {
      console.error("[Settings] handleLeaveHousehold failed", {
        userId: user?.id,
        err,
      });
      window.alert(
        `Leave Household Error: ${
          err instanceof Error ? err.message : "Unknown household leave error"
        }`,
      );
    } finally {
      setLeaveLoading(false);
    }
  }

  async function handleLeaveMode(mode: "fresh" | "take-data") {
    if (!user?.id) return;
    await handleLeaveHousehold(mode);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-border/80 shadow-none">
        <CardHeader className="space-y-1">
          <CardTitle>{t.settingsTitle}</CardTitle>
          <CardDescription>{t.settingsSubtitleLead}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1 rounded-lg border border-border/70 px-3 py-2">
            <p className="text-sm leading-relaxed text-muted-foreground">Email</p>
            <p className="text-base leading-relaxed">{user?.email ?? "-"}</p>
          </div>
          <div className="space-y-1 rounded-lg border border-border/70 px-3 py-2">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {lang === "he" ? "מזהה משק בית" : "Household ID"}
            </p>
            <div className="flex items-center justify-between gap-2 text-right">
              <p className="text-base leading-relaxed">
                {autoFixingHouseholdCode
                  ? lang === "he"
                    ? "מעדכן קוד..."
                    : "Updating code..."
                  : displayHouseholdCode
                    ? displayHouseholdCode
                    : "-"}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void onCopyHouseholdId()}
                disabled={!profile?.household_id}
              >
                {lang === "he" ? "העתק" : "Copy"}
              </Button>
            </div>
          </div>
          <div className="space-y-2 rounded-lg border border-border/70 px-3 py-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {lang === "he" ? "הצטרפות למשק בית קיים" : "Join Household"}
            </p>
            <div className="flex gap-2">
              <Input
                value={joinHouseholdId}
                onChange={(e) => setJoinHouseholdId(normalizeHouseholdCode(e.target.value))}
                placeholder={lang === "he" ? "הכנס קוד משק בית (6 תווים)" : "Enter 6-character household code"}
                maxLength={6}
              />
              <Button
                type="button"
                onClick={() => void onJoinHousehold()}
                disabled={joinLoading || !joinHouseholdId.trim() || !user?.id}
              >
                {joinLoading
                  ? lang === "he"
                    ? "מצטרף..."
                    : "Joining..."
                  : lang === "he"
                    ? "הצטרפות למשק בית קיים"
                    : "Join Household"}
              </Button>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {lang === "he"
                ? profile?.household_id
                  ? "מצב סנכרון: פעיל ומחובר"
                  : "מצב סנכרון: לא מחובר"
                : profile?.household_id
                  ? `Household Active: Linked (#${profile.household_id})`
                  : "Household Active: Not linked"}
            </p>
          </div>
          <div className="space-y-2 rounded-lg border border-border/70 px-3 py-3" dir="rtl">
            <p className="text-sm leading-relaxed text-muted-foreground">חברי משק הבית</p>
            {membersLoading ? (
              <p className="text-base leading-relaxed text-muted-foreground">טוען חברים...</p>
            ) : membersError ? (
              <p className="text-base leading-relaxed text-destructive">{membersError}</p>
            ) : householdMembers.length === 0 ? (
              <p className="text-base leading-relaxed text-muted-foreground">אין חברים להצגה כרגע.</p>
            ) : (
              <ul className="space-y-1">
                {householdMembers.map((email) => (
                  <li
                    key={email}
                    className="rounded-md border border-border/60 px-2.5 py-2 text-base leading-relaxed"
                  >
                    {email}
                    {user?.email?.trim().toLowerCase() === email.trim().toLowerCase()
                      ? " (אני)"
                      : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button type="button" variant="outline" onClick={() => void handleLogout()}>
            {lang === "he" ? "התנתקות" : "Logout"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setLeaveConfirmOpen(true)}
            disabled={leaveLoading || !user?.id}
          >
            {lang === "he" ? (leaveLoading ? "יוצא..." : "עזיבת משק בית") : leaveLoading ? "Leaving..." : "Leave Household"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-none">
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">
            {lang === "he" ? "שפה" : "Language"}
          </CardTitle>
          <CardDescription>
            {lang === "he"
              ? "בחירת שפת ממשק וכיוון כתיבה (RTL/LTR)."
              : "Choose UI language and writing direction (RTL/LTR)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="lang">{lang === "he" ? "שפה" : "Language"}</Label>
          <Select value={lang} onValueChange={(v) => setLang(v as "he" | "en")}>
            <SelectTrigger id="lang" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="he" textValue="עברית">
                <SelectItemText>עברית</SelectItemText>
              </SelectItem>
              <SelectItem value="en" textValue="English">
                <SelectItemText>English</SelectItemText>
              </SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <InstallAppCard />

      <Card className="border-border/80 shadow-none">
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">
            {lang === "he" ? "מטבעות מנוהלים" : "Managed Currencies"}
          </CardTitle>
          <CardDescription>
            {lang === "he"
              ? "הוספה/הסרה של קודי מטבע שישמשו בבחירת מטבע בטפסים."
              : "Add/remove currency codes used across selectors."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={newCurrencyCode}
              onChange={(e) => setNewCurrencyCode(e.target.value.toUpperCase())}
              placeholder="USD"
              dir="ltr"
            />
            <Button
              type="button"
              onClick={() => {
                const code = addManagedCurrency(newCurrencyCode);
                if (!code) return;
                setNewCurrencyCode("");
              }}
            >
              {t.add}
            </Button>
          </div>
          <div className="space-y-2">
            {currencies.map((c) => {
              const isBuiltin = ["ILS", "USD", "EUR", "GBP"].includes(c.code);
              return (
                <div
                  key={c.code}
                  className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2"
                >
                  <span className="text-sm tabular-nums">{c.code}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isBuiltin}
                    onClick={() => removeManagedCurrency(c.code)}
                  >
                    {t.deleteCategory}
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-none">
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">{t.exportCsv}</CardTitle>
          <CardDescription>{t.settingsExportDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          <div className="space-y-2">
            <Label htmlFor="export-period">{t.exportPeriodLabel}</Label>
            <Select
              value={exportPeriod}
              onValueChange={(v) =>
                setExportPeriod(
                  v === ALL_TIME_EXPORT ? ALL_TIME_EXPORT : (v as YearMonth),
                )
              }
            >
              <SelectTrigger id="export-period" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem
                  value={ALL_TIME_EXPORT}
                  textValue={t.exportAllTime}
                >
                  <SelectItemText>{t.exportAllTime}</SelectItemText>
                </SelectItem>
                {exportMonthOptions.map((k) => (
                  <SelectItem
                    key={k}
                    value={k}
                    textValue={hebrewMonthYearLabel(k)}
                  >
                    <SelectItemText>{hebrewMonthYearLabel(k)}</SelectItemText>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2 sm:w-auto"
              onClick={onExportXlsx}
            >
              <Download className="size-4" aria-hidden />
              {t.exportCsv}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2 sm:w-auto"
              onClick={onExportCsv}
            >
              <Download className="size-4" aria-hidden />
              {t.exportCsvDownload}
            </Button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => onCsvFileSelected(e.target.files?.[0] ?? null)}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={onPickCsvFile}
              >
                ייבוא נתונים
              </Button>
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground underline"
                onClick={onDownloadTemplate}
              >
                הורדת תבנית ריקה
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-none">
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">{t.manageCategories}</CardTitle>
          <CardDescription>{t.manageCategoriesDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SortableSettingsCategoryList
            categories={sorted}
            showAll={showAllExpenseCategoriesSettings}
            visibleCount={5}
            onReorder={reorderExpenseCategories}
            dragLabel={t.settingsDragReorderCategory}
            renderItem={(c, handle) => (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {handle}
                    <CategoryGlyph iconKey={c.iconKey} className="size-4" />
                    <ColorBadge color={c.color} />
                    <span className="min-w-0 truncate text-sm font-medium">
                      {c.name}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <input
                      type="color"
                      value={c.color}
                      onChange={(e) =>
                        updateExpenseCategory(c.id, { color: e.target.value })
                      }
                      className="h-9 w-10 cursor-pointer rounded-md border border-border bg-transparent p-1"
                      aria-label={`Pick color — ${c.name}`}
                    />
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button type="button" variant="outline" size="sm">
                          {t.pickIcon}
                        </Button>
                      </DialogTrigger>
                      <DialogContent dir={lang === "he" ? "rtl" : "ltr"}>
                        <DialogHeader>
                          <DialogTitle>{t.pickIcon}</DialogTitle>
                          <DialogDescription>{c.name}</DialogDescription>
                        </DialogHeader>
                        <IconPicker
                          value={c.iconKey}
                          onChange={(k) =>
                            updateExpenseCategory(c.id, { iconKey: k })
                          }
                        />
                      </DialogContent>
                    </Dialog>
                    {sorted.length > 1 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={t.deleteCategory}
                        onClick={() => {
                          const count = expenseCountByCategory.get(c.id) ?? 0;
                          if (count <= 0) {
                            if (!window.confirm(t.deleteCategoryConfirm)) return;
                            deleteExpenseCategory(c.id);
                            return;
                          }
                          setDeleteId(c.id);
                          const fallback =
                            sorted.find((x) => x.id !== c.id)?.id ?? "";
                          setMoveToId(fallback);
                          setDeleteOpen(true);
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3">
                  <Label htmlFor={`cat-name-${c.id}`} className="sr-only">
                    {t.categoryNameLabel}
                  </Label>
                  <Input
                    id={`cat-name-${c.id}`}
                    value={c.name}
                    onChange={(e) =>
                      updateExpenseCategory(c.id, { name: e.target.value })
                    }
                  />
                </div>
              </>
            )}
          />
          {sorted.length > 5 ? (
            <div className="border-t border-border/50 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-sm leading-relaxed text-muted-foreground"
                onClick={() =>
                  setShowAllExpenseCategoriesSettings((v) => !v)
                }
              >
                {showAllExpenseCategoriesSettings
                  ? t.dashboardShowLessCategories
                  : t.dashboardShowAllCategories}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-none">
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">ניהול קטגוריות הכנסה</CardTitle>
          <CardDescription>
            עריכה, שינוי אייקון/צבע ומחיקה של קטגוריות הכנסה.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SortableSettingsCategoryList
            categories={sortedIncome}
            showAll={showAllIncomeCategoriesSettings}
            visibleCount={5}
            onReorder={reorderIncomeSources}
            dragLabel={t.settingsDragReorderIncome}
            renderItem={(c, handle) => (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {handle}
                    <CategoryGlyph iconKey={c.iconKey} className="size-4" />
                    <ColorBadge color={c.color} />
                    <span className="min-w-0 truncate text-sm font-medium">
                      {c.name}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <input
                      type="color"
                      value={c.color}
                      onChange={(e) =>
                        updateIncomeSource(c.id, { color: e.target.value })
                      }
                      className="h-9 w-10 cursor-pointer rounded-md border border-border bg-transparent p-1"
                      aria-label={`Pick color — ${c.name}`}
                    />
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button type="button" variant="outline" size="sm">
                          {t.pickIcon}
                        </Button>
                      </DialogTrigger>
                      <DialogContent dir={lang === "he" ? "rtl" : "ltr"}>
                        <DialogHeader>
                          <DialogTitle>{t.pickIcon}</DialogTitle>
                          <DialogDescription>{c.name}</DialogDescription>
                        </DialogHeader>
                        <IconPicker
                          value={c.iconKey}
                          onChange={(k) => updateIncomeSource(c.id, { iconKey: k })}
                        />
                      </DialogContent>
                    </Dialog>
                    {sortedIncome.length > 1 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={t.deleteCategory}
                        onClick={() => {
                          const count = incomeCountByCategory.get(c.id) ?? 0;
                          if (count <= 0) {
                            if (!window.confirm(t.deleteCategoryConfirm)) return;
                            deleteIncomeSource(c.id);
                            return;
                          }
                          setDeleteIncomeId(c.id);
                          const fallback =
                            sortedIncome.find((x) => x.id !== c.id)?.id ?? "";
                          setMoveToIncomeId(fallback);
                          setDeleteIncomeOpen(true);
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3">
                  <Label htmlFor={`inc-name-${c.id}`} className="sr-only">
                    {t.categoryNameLabel}
                  </Label>
                  <Input
                    id={`inc-name-${c.id}`}
                    value={c.name}
                    onChange={(e) =>
                      updateIncomeSource(c.id, { name: e.target.value })
                    }
                  />
                </div>
              </>
            )}
          />
          {sortedIncome.length > 5 ? (
            <div className="border-t border-border/50 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-sm leading-relaxed text-muted-foreground"
                onClick={() =>
                  setShowAllIncomeCategoriesSettings((v) => !v)
                }
              >
                {showAllIncomeCategoriesSettings
                  ? t.dashboardShowLessCategories
                  : t.dashboardShowAllCategories}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-none">
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">{t.manageAssetTypes}</CardTitle>
          <CardDescription>{t.manageAssetTypesDesc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Dialog
            open={assetTypesOpen}
            onOpenChange={(o) => {
              setAssetTypesOpen(o);
              if (!o) setShowAllAssetTypesSettings(false);
            }}
          >
            <DialogTrigger asChild>
              <Button type="button" variant="outline" className="w-full">
                {t.manageAssetTypes}
              </Button>
            </DialogTrigger>
            <DialogContent dir={dir}>
              <DialogHeader>
                <DialogTitle>{t.manageAssetTypes}</DialogTitle>
                <DialogDescription>{t.manageAssetTypesDesc}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="settings-asset-type-new">{t.assetTypeNameLabel}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="settings-asset-type-new"
                      value={newAssetTypeName}
                      onChange={(e) => setNewAssetTypeName(e.target.value)}
                      placeholder={t.promptNewAssetType}
                    />
                    <Button
                      type="button"
                      onClick={() => {
                        const id = addAssetType(newAssetTypeName);
                        if (id) setNewAssetTypeName("");
                      }}
                    >
                      {t.addAssetType}
                    </Button>
                  </div>
                </div>

                <ul className="space-y-2">
                  {(showAllAssetTypesSettings || assetTypes.length <= 5
                    ? assetTypes
                    : assetTypes.slice(0, 5)
                  ).map((type) => (
                    <li key={type.id} className="rounded-lg border border-border/70 p-3">
                      <div className="flex items-center gap-2">
                        <Input
                          value={type.name}
                          onChange={(e) =>
                            updateAssetType(type.id, e.target.value)
                          }
                        />
                        {assetTypes.length > 1 ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setAssetDeleteId(type.id);
                              const fallback =
                                assetTypes.find((x) => x.id !== type.id)?.id ?? "";
                              setMoveAssetTypeTo(fallback);
                              setAssetDeleteOpen(true);
                            }}
                          >
                            {t.deleteAssetType}
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
                {assetTypes.length > 5 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full text-sm leading-relaxed text-muted-foreground"
                    onClick={() =>
                      setShowAllAssetTypesSettings((v) => !v)
                    }
                  >
                    {showAllAssetTypesSettings
                      ? t.dashboardShowLessCategories
                      : t.dashboardShowAllCategories}
                  </Button>
                ) : null}
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-none">
        <CardHeader className="space-y-1 px-4 pb-2 pt-4">
          <CardTitle className="text-base">{t.settingsBudgetsSection}</CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            {t.settingsBudgetsSectionDesc}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5">
          <ul
            className="divide-y divide-border/50 rounded-xl border border-border/60 bg-muted/10"
            dir={dir}
          >
            {budgetRowsVisible.map((c) => {
              const amount = getBudget(c.id);
              const tint =
                /^#[0-9a-fA-F]{6}$/.test(c.color.trim()) ? `${c.color}1A` : undefined;
              return (
                <li key={c.id} style={tint ? { backgroundColor: tint } : undefined}>
                  <div className="flex min-h-[2.75rem] items-center justify-between gap-3 px-4 py-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <CategoryGlyph
                        iconKey={c.iconKey}
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="truncate text-sm font-medium leading-tight">
                        {c.name}
                      </span>
                    </div>
                    <input
                      id={`budget-${c.id}`}
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      value={formatNumericInput(Number.isFinite(amount) ? String(amount) : "0")}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw.trim() === "") {
                          setBudget(c.id, 0);
                          return;
                        }
                        const n = parseNumericInput(raw);
                        if (n != null && Number.isFinite(n) && n >= 0) setBudget(c.id, n);
                      }}
                      aria-label={`${t.settingsBudgetLabel} — ${c.name}`}
                      className={cn(
                        "w-[6rem] shrink-0 rounded-md border-0 border-b border-transparent bg-transparent py-1.5 text-end text-sm tabular-nums text-foreground transition-colors",
                        "placeholder:text-muted-foreground/50",
                        "hover:bg-muted/30 hover:border-border/50",
                        "focus:border-primary focus:bg-muted/30 focus:outline-none focus:ring-0",
                      )}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          {sorted.length > 5 ? (
            <div className="border-t border-border/50 px-4 py-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-sm leading-relaxed text-muted-foreground"
                onClick={() => setShowAllBudgetSettings((v) => !v)}
              >
                {showAllBudgetSettings
                  ? t.dashboardShowLessCategories
                  : t.dashboardShowAllCategories}
              </Button>
            </div>
          ) : null}
          <p className="border-t border-border/50 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            {t.settingsSaveNote}
          </p>
        </CardContent>
      </Card>

      <Card className="border-destructive/40 shadow-none">
        <CardHeader className="space-y-1">
          <CardTitle className="text-base text-destructive">
            {t.settingsDangerZone}
          </CardTitle>
          <CardDescription>{t.settingsDangerZoneDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                className="w-full sm:w-auto"
              >
                {t.clearAllData}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>האם אתה בטוח?</AlertDialogTitle>
                <AlertDialogDescription>
                  פעולה זו תמחק את כל הנתונים ולא ניתנת לביטול.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>ביטול</AlertDialogCancel>
                <AlertDialogAction onClick={onClearAllData}>
                  {t.clearAllData}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lang === "he"
                ? "יש תנועות בקטגוריה"
                : "This category has transactions"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lang === "he"
                ? "לאן להעביר אותן לפני המחיקה?"
                : "Where should we move them before deleting?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="move-to">
              {lang === "he" ? "העבר לקטגוריה" : "Move to category"}
            </Label>
            <Select value={moveToId} onValueChange={setMoveToId}>
              <SelectTrigger id="move-to" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {sorted
                  .filter((c) => c.id !== deleteId)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id} textValue={c.name}>
                      <SelectItemText>{c.name}</SelectItemText>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteId || !moveToId) return;
                deleteExpenseCategory(deleteId, moveToId);
                setDeleteOpen(false);
              }}
            >
              {t.deleteCategory}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={joinConfirmOpen} onOpenChange={setJoinConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>אישור הצטרפות</AlertDialogTitle>
            <AlertDialogDescription>
              האם תרצה לייבא את הנתונים הקודמים שלך למשק הבית המשותף?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={joinLoading}>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleJoinHousehold(false);
              }}
              disabled={joinLoading}
            >
              לא, רק להצטרף
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                void handleJoinHousehold(true);
              }}
              disabled={joinLoading}
            >
              כן, לייבא נתונים
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={leaveConfirmOpen} onOpenChange={setLeaveConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>איך תרצה לעזוב?</AlertDialogTitle>
            <AlertDialogDescription>
              בחר אם להתחיל דף חדש או לקחת איתך את הנתונים שיצרת.
            </AlertDialogDescription>
            {leaveDialogMemberCount !== null && leaveDialogMemberCount > 1 ? (
              <p className="mt-3 border-t border-border pt-3 text-sm leading-relaxed text-muted-foreground">
                {lang === "he" ? (
                  <>
                    שים לב: שאר חברי משק הבית יישארו בבית זה ויוכלו להמשיך לראות את המידע שלא בחרת
                    לקחת איתך.
                  </>
                ) : (
                  <>
                    Note: Other household members will stay in this home and can keep seeing data
                    you did not choose to take with you.
                  </>
                )}
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaveLoading}>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleLeaveMode("fresh");
              }}
              disabled={leaveLoading}
            >
              התחל דף חדש
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                void handleLeaveMode("take-data");
              }}
              disabled={leaveLoading}
            >
              קח את הנתונים שלי
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={assetDeleteOpen} onOpenChange={setAssetDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lang === "he" ? "מחיקת סוג נכס" : "Delete asset type"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lang === "he"
                ? "נכסים מסוג זה יועברו לסוג היעד לפני המחיקה."
                : "Accounts of this type will move to the target type before deletion."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="move-asset-type">
              {lang === "he" ? "העבר לסוג" : "Move to type"}
            </Label>
            <Select value={moveAssetTypeTo} onValueChange={setMoveAssetTypeTo}>
              <SelectTrigger id="move-asset-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="z-[10050]">
                {assetTypes
                  .filter((x) => x.id !== assetDeleteId)
                  .map((x) => (
                    <SelectItem key={x.id} value={x.id} textValue={x.name}>
                      <SelectItemText>{x.name}</SelectItemText>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!assetDeleteId || !moveAssetTypeTo) return;
                deleteAssetType(assetDeleteId, moveAssetTypeTo);
                setAssetDeleteOpen(false);
              }}
            >
              {t.deleteAssetType}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteIncomeOpen} onOpenChange={setDeleteIncomeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lang === "he"
                ? "יש תנועות בקטגוריית ההכנסה"
                : "This income category has transactions"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lang === "he"
                ? "לאן להעביר אותן לפני המחיקה?"
                : "Where should we move them before deleting?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="move-to-income">
              {lang === "he" ? "העבר לקטגוריית הכנסה" : "Move to income category"}
            </Label>
            <Select value={moveToIncomeId} onValueChange={setMoveToIncomeId}>
              <SelectTrigger id="move-to-income" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {sortedIncome
                  .filter((c) => c.id !== deleteIncomeId)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id} textValue={c.name}>
                      <SelectItemText>{c.name}</SelectItemText>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteIncomeId || !moveToIncomeId) return;
                deleteIncomeSource(deleteIncomeId, moveToIncomeId);
                setDeleteIncomeOpen(false);
              }}
            >
              {t.deleteCategory}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
