import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BUILTIN_ASSET_TYPE_IDS,
  type AssetAccount,
  type AssetTypeId,
  type AssetNamePreset,
  type AssetSnapshot,
} from "@/data/mock";
import { formatYearMonth, type YearMonth } from "@/lib/month";
import { pickDistinctImportCategoryColor } from "@/lib/categoryColors";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { isValidHouseholdCode, normalizeHouseholdCode } from "@/lib/household";
import { toast } from "sonner";

const STORAGE_DELETED_BUILTIN_ASSET_TYPES = "expandy-deleted-builtin-asset-types-v1";

export type AssetTypeOption = {
  id: string;
  name: string;
  /** Accent for charts and cards — shared by all assets of this type */
  color: string;
};

type AssetsContextValue = {
  snapshots: AssetSnapshot[];
  currentMonth: YearMonth;
  setCurrentMonth: (ym: YearMonth) => void;
  currentAssets: AssetAccount[];
  setBalance: (id: string, balance: number) => void;
  setAccountCurrency: (id: string, currency: string) => void;
  updateAccountMeta: (id: string, patch: { name?: string }) => void;
  deleteAccount: (id: string) => void;
  addSnapshotAccount: (
    ym: YearMonth,
    input: Omit<AssetAccount, "id">,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Batch insert asset snapshot rows for given months; persists to Supabase. */
  bulkImportAssets: (
    rows: Array<{
      ym: YearMonth;
      name: string;
      type: string;
      balance: number;
      currency: string;
    }>,
  ) => Promise<{ ok: true; count: number } | { ok: false; error: string }>;
  assetTypes: AssetTypeOption[];
  assetNamePresetsFor: (type: AssetTypeId) => AssetNamePreset[];
  registerAssetName: (type: AssetTypeId, name: string) => string | null;
  addAssetType: (name: string) => string | null;
  updateAssetType: (id: string, patch: { name?: string; color?: string }) => void;
  deleteAssetType: (id: string, moveToTypeId?: string) => void;
  /** Clear snapshots, presets, and reset types to built-ins (used with full data clear). */
  clearAllUserData: () => void;
};

const AssetsContext = createContext<AssetsContextValue | null>(null);

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `asset-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function normalizeTypeId(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || `asset-type-${Date.now().toString(36)}`;
}

/** DB row id suffix: one row per (logical asset, month), matching migration `id__YYYY-MM`. */
function assetBaseId(rowId: string): string {
  const m = /^(.+)__(\d{4}-\d{2})$/.exec(rowId);
  return m ? m[1]! : rowId;
}

function rowIdForMonth(accountId: string, ym: YearMonth): string {
  if (/__\d{4}-\d{2}$/.test(accountId)) return accountId;
  return `${assetBaseId(accountId)}__${ym}`;
}

function findAccountInSnapshot(
  snaps: AssetSnapshot[],
  ym: YearMonth,
  rawId: string,
): AssetAccount | undefined {
  const s = snaps.find((x) => x.ym === ym);
  if (!s) return undefined;
  const want = rowIdForMonth(rawId, ym);
  return s.accounts.find((a) => a.id === rawId || a.id === want);
}

const DEFAULT_ASSET_TYPES: AssetTypeOption[] = [
  { id: "liquid", name: "חשבונות נזילים", color: "#22c55e" },
  { id: "portfolio", name: "תיקי השקעות", color: "#3b82f6" },
  { id: "pension", name: "פנסיה / השתלמות", color: "#a855f7" },
];

type PersistCtx = {
  householdId: string;
  userId: string;
};

function showSupabaseInsertError(error: unknown) {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Database write failed";
  toast.error(msg);
}

async function upsertAssetRow(
  ctx: PersistCtx | null,
  ym: YearMonth,
  acc: AssetAccount,
): Promise<{ error: string } | null> {
  if (!ctx || !isValidHouseholdCode(ctx.householdId)) {
    return { error: "Missing household_id. Cannot save data." };
  }
  const rowId = rowIdForMonth(acc.id, ym);
  const row = {
    id: rowId,
    user_id: ctx.userId,
    household_id: ctx.householdId,
    name: acc.name,
    type: acc.type,
    balance: acc.balance,
    date: `${ym}-01`,
    color: null,
    currency: acc.currency ?? "ILS",
  };
  try {
    const { error } = await supabase.from("assets").upsert(row, { onConflict: "id" });
    if (error) {
      showSupabaseInsertError(error);
      return { error: error.message };
    }
  } catch (error) {
    showSupabaseInsertError(error);
    return { error: error instanceof Error ? error.message : "Asset upsert failed" };
  }
  return null;
}

async function deleteAssetRowsFromDb(ctx: PersistCtx | null, accountId: string) {
  if (!ctx || !isValidHouseholdCode(ctx.householdId)) return;
  const base = assetBaseId(accountId);
  await supabase.from("assets").delete().eq("id", base).eq("household_id", ctx.householdId);
  await supabase
    .from("assets")
    .delete()
    .eq("household_id", ctx.householdId)
    .like("id", `${base}__%`);
}

async function updateAssetMetaInDb(
  ctx: PersistCtx | null,
  accountId: string,
  patch: { name?: string },
) {
  if (!ctx || !isValidHouseholdCode(ctx.householdId)) return;
  const base = assetBaseId(accountId);
  const { data, error: selErr } = await supabase
    .from("assets")
    .select("id")
    .eq("household_id", ctx.householdId)
    .or(`id.eq.${base},id.like.${base}__%`);
  if (selErr) {
    return;
  }
  const updates: Record<string, string | null> = {};
  if (typeof patch.name === "string") updates.name = patch.name.trim();
  if (!Object.keys(updates).length) return;
  for (const r of data ?? []) {
    const id = String((r as { id?: string }).id ?? "");
    if (!id) continue;
    await supabase.from("assets").update(updates).eq("id", id);
  }
}

async function updateAssetTypeInDb(
  ctx: PersistCtx | null,
  baseId: string,
  newType: string,
) {
  if (!ctx || !isValidHouseholdCode(ctx.householdId)) return;
  const base = assetBaseId(baseId);
  const { data, error: selErr } = await supabase
    .from("assets")
    .select("id")
    .eq("household_id", ctx.householdId)
    .or(`id.eq.${base},id.like.${base}__%`);
  if (selErr) {
    return;
  }
  for (const r of data ?? []) {
    const id = String((r as { id?: string }).id ?? "");
    if (!id) continue;
    await supabase.from("assets").update({ type: newType }).eq("id", id);
  }
}

export function AssetsProvider({ children }: { children: ReactNode }) {
  const { profile, user, session, loading: authLoading } = useAuth();
  const [snapshots, setSnapshots] = useState<AssetSnapshot[]>([]);
  const [assetTypes, setAssetTypes] = useState<AssetTypeOption[]>(() => [...DEFAULT_ASSET_TYPES]);
  const [deletedBuiltinAssetTypeIds, setDeletedBuiltinAssetTypeIds] =
    useState<Set<string>>(() => new Set());
  const [labelPresets, setLabelPresets] = useState<AssetNamePreset[]>([]);
  const [currentMonth, setCurrentMonth] = useState<YearMonth>(() =>
    formatYearMonth(new Date()),
  );

  const snapshotsRef = useRef(snapshots);
  snapshotsRef.current = snapshots;

  const persistCtx = useMemo((): PersistCtx | null => {
    const householdId = normalizeHouseholdCode(profile?.household_id ?? "");
    const userId = user?.id;
    if (!userId || !isValidHouseholdCode(householdId)) return null;
    return { householdId, userId };
  }, [profile?.household_id, user?.id]);

  const loadAssetsFromSupabase = useCallback(async () => {
    if (authLoading || !session || !user?.id) {
      return;
    }
    const hm = normalizeHouseholdCode(profile?.household_id ?? "");
    if (!isValidHouseholdCode(hm)) {
      return;
    }
    try {
      const { data, error } = await supabase
        .from("assets")
        .select("id, name, type, balance, date, color, currency")
        .eq("household_id", hm);
      if (error) {
        return;
      }
      if (!data) return;
      const byYm = new Map<string, AssetAccount[]>();
      for (const row of data as Array<Record<string, unknown>>) {
        const rawDate = String(row.date ?? "");
        const ym = rawDate.slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(ym)) continue;
        const next: AssetAccount = {
          id: String(row.id ?? ""),
          name: String(row.name ?? ""),
          type: String(row.type ?? ""),
          balance: Number(row.balance ?? 0),
          color: typeof row.color === "string" ? row.color : undefined,
          currency: typeof row.currency === "string" ? row.currency : "ILS",
        };
        const bucket = byYm.get(ym) ?? [];
        bucket.push(next);
        byYm.set(ym, bucket);
      }
      const nextSnapshots = [...byYm.entries()]
        .map(([ym, accounts]) => ({ ym: ym as YearMonth, accounts }))
        .sort((a, b) => a.ym.localeCompare(b.ym));
      setSnapshots(nextSnapshots);
    } catch {
      /* ignore load failures */
    }
  }, [authLoading, profile?.household_id, session, user?.id]);

  useEffect(() => {
    void loadAssetsFromSupabase();
  }, [loadAssetsFromSupabase]);

  useEffect(() => {
    const hm = normalizeHouseholdCode(profile?.household_id ?? "");
    if (authLoading || !session || !user?.id || !isValidHouseholdCode(hm)) return;
    const channel = supabase
      .channel(`assets-realtime-${hm}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "assets", filter: `household_id=eq.${hm}` },
        () => {
          void loadAssetsFromSupabase();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [authLoading, loadAssetsFromSupabase, profile?.household_id, session, user?.id]);

  useEffect(() => {
    const typeIds = new Set(assetTypes.map((t) => t.id));
    const missingBuiltin = BUILTIN_ASSET_TYPE_IDS.some(
      (id) => !typeIds.has(id) && !deletedBuiltinAssetTypeIds.has(id),
    );
    if (!missingBuiltin) return;
    setAssetTypes((prev) => {
      const byId = new Map(prev.map((t) => [t.id, t] as const));
      for (const bid of BUILTIN_ASSET_TYPE_IDS) {
        if (byId.has(bid) || deletedBuiltinAssetTypeIds.has(bid)) continue;
        const def = DEFAULT_ASSET_TYPES.find((t) => t.id === bid);
        if (def) byId.set(bid, def);
      }
      return [...byId.values()].map((t) => {
        const fallback = DEFAULT_ASSET_TYPES.find((d) => d.id === t.id);
        const color =
          typeof t.color === "string" && /^#[0-9a-fA-F]{6}$/.test(t.color.trim())
            ? t.color.trim()
            : (fallback?.color ?? "#94a3b8");
        return { ...t, color };
      });
    });
  }, [assetTypes, deletedBuiltinAssetTypeIds]);

  const registerAssetName = useCallback((type: AssetTypeId, name: string) => {
    const n = name.trim();
    if (!n) return null;
    const existing = labelPresets.find((p) => p.type === type && p.name === n);
    if (existing) return existing.id;
    const id = newId();
    setLabelPresets((prev) => {
      if (prev.some((p) => p.type === type && p.name === n)) return prev;
      return [...prev, { id, type, name: n }];
    });
    return id;
  }, [labelPresets]);

  const addAssetType = useCallback((name: string) => {
    const n = name.trim();
    if (!n) return null;
    const existing = assetTypes.find((t) => t.name === n);
    if (existing) return existing.id;
    let id = normalizeTypeId(n);
    const exists = new Set(assetTypes.map((t) => t.id));
    while (exists.has(id)) id = `${id}-${Math.floor(Math.random() * 10000)}`;
    const nextColor = pickDistinctImportCategoryColor(assetTypes.map((t) => t.color));
    setAssetTypes((prev) => [...prev, { id, name: n, color: nextColor }]);
    return id;
  }, [assetTypes]);

  const updateAssetType = useCallback((id: string, patch: { name?: string; color?: string }) => {
    setAssetTypes((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t };
        if (patch.name !== undefined) {
          const n = patch.name.trim();
          if (n) next.name = n;
        }
        if (patch.color !== undefined) {
          const c = patch.color.trim();
          if (/^#[0-9a-fA-F]{6}$/i.test(c)) next.color = c;
        }
        return next;
      }),
    );
  }, []);

  const deleteAssetType = useCallback(
    (id: string, moveToTypeId?: string) => {
      const others = assetTypes.filter((t) => t.id !== id);
      const target = moveToTypeId ?? others[0]?.id;
      if (!target) return;

      const prevSnaps = snapshotsRef.current;
      for (const s of prevSnaps) {
        for (const a of s.accounts) {
          if (a.type === id) {
            void updateAssetTypeInDb(persistCtx, a.id, target);
          }
        }
      }

      setSnapshots((prev) =>
        prev.map((s) => ({
          ...s,
          accounts: s.accounts.map((a) =>
            a.type === id ? { ...a, type: target as AssetTypeId } : a,
          ),
        })),
      );

      setLabelPresets((prev) =>
        prev.map((p) =>
          p.type === id ? { ...p, type: target as AssetTypeId } : p,
        ),
      );

      if (BUILTIN_ASSET_TYPE_IDS.includes(id as (typeof BUILTIN_ASSET_TYPE_IDS)[number])) {
        setDeletedBuiltinAssetTypeIds((prev) => new Set([...prev, id]));
      }

      setAssetTypes((prev) => prev.filter((t) => t.id !== id));
    },
    [persistCtx],
  );

  const assetNamePresetsFor = useCallback(
    (type: AssetTypeId) =>
      labelPresets.filter((p) => p.type === type).sort((a, b) => a.name.localeCompare(b.name, "he")),
    [labelPresets],
  );

  const currentAssets = useMemo(() => {
    const found = snapshots.find((s) => s.ym === currentMonth);
    if (found) return found.accounts;
    const latest = [...snapshots].sort((a, b) => b.ym.localeCompare(a.ym))[0];
    return latest?.accounts ?? [];
  }, [snapshots, currentMonth]);

  const setBalance = useCallback(
    (id: string, balance: number) => {
      const nextBal = Math.max(0, Math.round(balance));
      const want = rowIdForMonth(id, currentMonth);
      setSnapshots((prev) => {
        const idx = prev.findIndex((s) => s.ym === currentMonth);
        let next: AssetSnapshot[];
        if (idx === -1) {
          const updated = [...currentAssets].map((a) => {
            const rid = rowIdForMonth(a.id, currentMonth);
            return rid === want || a.id === id ? { ...a, balance: nextBal } : a;
          });
          next = [...prev, { ym: currentMonth, accounts: updated }];
        } else {
          next = prev.map((s, i) =>
            i === idx
              ? {
                  ...s,
                  accounts: s.accounts.map((a) => {
                    const rid = rowIdForMonth(a.id, currentMonth);
                    return rid === want || a.id === id ? { ...a, balance: nextBal } : a;
                  }),
                }
              : s,
          );
        }
        const acc = findAccountInSnapshot(next, currentMonth, id);
        if (acc) void upsertAssetRow(persistCtx, currentMonth, acc);
        return next;
      });
    },
    [currentAssets, currentMonth, persistCtx],
  );

  const setAccountCurrency = useCallback(
    (id: string, currency: string) => {
      const want = rowIdForMonth(id, currentMonth);
      setSnapshots((prev) => {
        const idx = prev.findIndex((s) => s.ym === currentMonth);
        let next: AssetSnapshot[];
        if (idx === -1) {
          const updated = [...currentAssets].map((a) => {
            const rid = rowIdForMonth(a.id, currentMonth);
            return rid === want || a.id === id ? { ...a, currency } : a;
          });
          next = [...prev, { ym: currentMonth, accounts: updated }];
        } else {
          next = prev.map((s, i) =>
            i === idx
              ? {
                  ...s,
                  accounts: s.accounts.map((a) => {
                    const rid = rowIdForMonth(a.id, currentMonth);
                    return rid === want || a.id === id ? { ...a, currency } : a;
                  }),
                }
              : s,
          );
        }
        const acc = findAccountInSnapshot(next, currentMonth, id);
        if (acc) void upsertAssetRow(persistCtx, currentMonth, acc);
        return next;
      });
    },
    [currentAssets, currentMonth, persistCtx],
  );

  const updateAccountMeta = useCallback(
    (id: string, patch: { name?: string }) => {
      const nextName = typeof patch.name === "string" ? patch.name.trim() : undefined;
      setSnapshots((prev) =>
        prev.map((s) => ({
          ...s,
          accounts: s.accounts.map((a) => {
            const same = a.id === id || assetBaseId(a.id) === assetBaseId(id);
            if (!same) return a;
            return {
              ...a,
              name: nextName ?? a.name,
            };
          }),
        })),
      );
      void updateAssetMetaInDb(persistCtx, id, { name: nextName });
    },
    [persistCtx],
  );

  const deleteAccount = useCallback(
    (id: string) => {
      void deleteAssetRowsFromDb(persistCtx, id);
      setSnapshots((prev) =>
        prev.map((s) => ({
          ...s,
          accounts: s.accounts.filter((a) => {
            const sameBase = assetBaseId(a.id) === assetBaseId(id);
            return !sameBase && a.id !== id;
          }),
        })),
      );
      setLabelPresets((prev) => prev.filter((p) => p.id !== id));
    },
    [persistCtx],
  );

  const clearAllUserData = useCallback(() => {
    setSnapshots([]);
    setLabelPresets([]);
    setAssetTypes([...DEFAULT_ASSET_TYPES]);
    setDeletedBuiltinAssetTypeIds(new Set());
    setCurrentMonth(formatYearMonth(new Date()));
    try {
      localStorage.removeItem(STORAGE_DELETED_BUILTIN_ASSET_TYPES);
    } catch {
      /* ignore */
    }
  }, []);

  const addSnapshotAccount = useCallback(
    async (ym: YearMonth, input: Omit<AssetAccount, "id">) => {
      if (!persistCtx || !isValidHouseholdCode(persistCtx.householdId)) {
        return { ok: false as const, error: "אין חיבור לענן. נסה שוב בעוד רגע." };
      }
      const base = newId();
      const id = `${base}__${ym}`;
      const bal = Math.max(0, Math.round(input.balance * 100) / 100);
      const row: AssetAccount = {
        id,
        ...input,
        name: input.name.trim(),
        currency: input.currency || "ILS",
        balance: bal,
      };
      setSnapshots((prev) => {
        const idx = prev.findIndex((s) => s.ym === ym);
        if (idx === -1) {
          return [...prev, { ym, accounts: [row] }];
        }
        return prev.map((s, i) =>
          i === idx ? { ...s, accounts: [...s.accounts, row] } : s,
        );
      });
      const persistErr = await upsertAssetRow(persistCtx, ym, row);
      if (persistErr) {
        setSnapshots((prev) =>
          prev.map((s) => ({
            ...s,
            accounts: s.accounts.filter((a) => a.id !== row.id),
          })),
        );
        return { ok: false as const, error: persistErr.error };
      }
      registerAssetName(row.type, row.name);
      return { ok: true as const };
    },
    [persistCtx, registerAssetName],
  );

  const bulkImportAssets = useCallback(
    async (
      rows: Array<{
        ym: YearMonth;
        name: string;
        type: string;
        balance: number;
        currency: string;
      }>,
    ) => {
      try {
        if (!rows.length) return { ok: true as const, count: 0 };
        if (!persistCtx) {
          return { ok: false as const, error: "אין חיבור לענן. נסה שוב בעוד רגע." };
        }
        const ctx = persistCtx;
        const typeById = new Map(assetTypes.map((t) => [t.id, t] as const));
        const typeRows = [...new Set(rows.map((r) => r.type.trim()).filter(Boolean))].map((typeId) => {
          const local = typeById.get(typeId);
          return {
            ...(isUuidLike(typeId) ? { id: typeId } : {}),
            user_id: ctx.userId,
            type: "asset" as const,
            name: local?.name ?? typeId,
            color: local?.color ?? "#94a3b8",
            icon: "tag",
          };
        });
        if (typeRows.length) {
          const { error: typeUpsertError } = await supabase
            .from("categories")
            .upsert(typeRows, { onConflict: "user_id,name,type" });
          if (typeUpsertError) {
            return { ok: false as const, error: typeUpsertError.message };
          }
        }
        const inserts: Array<{ ym: YearMonth; account: AssetAccount }> = [];
        const dbRows: Array<Record<string, unknown>> = [];
        for (const r of rows) {
          const base = newId();
          const id = `${base}__${r.ym}`;
          const bal = Math.max(0, Math.round(r.balance * 100) / 100);
          const account: AssetAccount = {
            id,
            name: r.name.trim(),
            type: r.type,
            balance: bal,
            currency: (r.currency || "ILS").trim(),
          };
          inserts.push({ ym: r.ym, account });
          dbRows.push({
            id,
            user_id: ctx.userId,
            household_id: ctx.householdId,
            name: account.name,
            type: account.type,
            balance: account.balance,
            date: `${r.ym}-01`,
            color: null,
            currency: account.currency,
          });
        }
        const optimisticIds = new Set(inserts.map((x) => x.account.id));
        setSnapshots((prev) => {
          const byYm = new Map<YearMonth, AssetAccount[]>();
          for (const s of prev) {
            byYm.set(s.ym, [...s.accounts]);
          }
          for (const { ym, account } of inserts) {
            const list = byYm.get(ym) ?? [];
            list.push(account);
            byYm.set(ym, list);
          }
          return [...byYm.entries()]
            .map(([ym, accounts]) => ({ ym, accounts }))
            .sort((a, b) => a.ym.localeCompare(b.ym));
        });
        try {
          const { error } = await supabase.from("assets").insert(dbRows);
          if (error) {
            showSupabaseInsertError(error);
            setSnapshots((prev) =>
              prev.map((s) => ({
                ...s,
                accounts: s.accounts.filter((a) => !optimisticIds.has(a.id)),
              })),
            );
            return { ok: false as const, error: error.message };
          }
        } catch (error) {
          showSupabaseInsertError(error);
          setSnapshots((prev) =>
            prev.map((s) => ({
              ...s,
              accounts: s.accounts.filter((a) => !optimisticIds.has(a.id)),
            })),
          );
          return {
            ok: false as const,
            error: error instanceof Error ? error.message : "Asset import failed",
          };
        }
        for (const { account } of inserts) {
          registerAssetName(account.type as AssetTypeId, account.name);
        }
        return { ok: true as const, count: inserts.length };
      } catch (err) {
        return {
          ok: false as const,
          error:
            err instanceof Error
              ? err.message
              : "ייבוא נכסים נכשל בשל שגיאה לא צפויה.",
        };
      }
    },
    [persistCtx, registerAssetName, assetTypes],
  );

  const value = useMemo(
    () => ({
      snapshots,
      currentMonth,
      setCurrentMonth,
      currentAssets,
      setBalance,
      setAccountCurrency,
      updateAccountMeta,
      deleteAccount,
      addSnapshotAccount,
      bulkImportAssets,
      assetTypes,
      assetNamePresetsFor,
      registerAssetName,
      addAssetType,
      updateAssetType,
      deleteAssetType,
      clearAllUserData,
    }),
    [
      snapshots,
      currentMonth,
      currentAssets,
      setBalance,
      setAccountCurrency,
      updateAccountMeta,
      deleteAccount,
      addSnapshotAccount,
      bulkImportAssets,
      assetTypes,
      assetNamePresetsFor,
      registerAssetName,
      addAssetType,
      updateAssetType,
      deleteAssetType,
    ],
  );
  return <AssetsContext.Provider value={value}>{children}</AssetsContext.Provider>;
}

export function useAssets() {
  const ctx = useContext(AssetsContext);
  if (!ctx) throw new Error("useAssets must be used within AssetsProvider");
  return ctx;
}
