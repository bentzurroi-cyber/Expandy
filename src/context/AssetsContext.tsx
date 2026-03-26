import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";

const STORAGE_DELETED_BUILTIN_ASSET_TYPES = "expandy-deleted-builtin-asset-types-v1";

export type AssetTypeOption = {
  id: string;
  name: string;
};

type AssetsContextValue = {
  snapshots: AssetSnapshot[];
  currentMonth: YearMonth;
  setCurrentMonth: (ym: YearMonth) => void;
  currentAssets: AssetAccount[];
  setBalance: (id: string, balance: number) => void;
  setAccountCurrency: (id: string, currency: string) => void;
  updateAccountMeta: (id: string, patch: { name?: string; color?: string }) => void;
  deleteAccount: (id: string) => void;
  addSnapshotAccount: (
    ym: YearMonth,
    input: Omit<AssetAccount, "id">,
  ) => void;
  assetTypes: AssetTypeOption[];
  assetNamePresetsFor: (type: AssetTypeId) => AssetNamePreset[];
  registerAssetName: (type: AssetTypeId, name: string) => string | null;
  addAssetType: (name: string) => string | null;
  updateAssetType: (id: string, name: string) => void;
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

const DEFAULT_ASSET_TYPES: AssetTypeOption[] = [
  { id: "liquid", name: "חשבונות נזילים" },
  { id: "portfolio", name: "תיקי השקעות" },
  { id: "pension", name: "פנסיה / השתלמות" },
];


export function AssetsProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [snapshots, setSnapshots] = useState<AssetSnapshot[]>([]);
  const [assetTypes, setAssetTypes] = useState<AssetTypeOption[]>(() => [...DEFAULT_ASSET_TYPES]);
  const [deletedBuiltinAssetTypeIds, setDeletedBuiltinAssetTypeIds] =
    useState<Set<string>>(() => new Set());
  const [labelPresets, setLabelPresets] = useState<AssetNamePreset[]>([]);
  const [currentMonth, setCurrentMonth] = useState<YearMonth>(() =>
    formatYearMonth(new Date()),
  );

  useEffect(() => {
    async function loadAssetsFromSupabase() {
      if (!profile?.household_id) {
        setSnapshots([]);
        return;
      }
      const { data, error } = await supabase
        .from("assets")
        .select("id, name, type, balance, date, color, currency")
        .eq("household_id", profile.household_id);
      if (error || !data) {
        setSnapshots([]);
        return;
      }
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
    }
    void loadAssetsFromSupabase();
  }, [profile?.household_id]);


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
      return [...byId.values()];
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
    setAssetTypes((prev) => [...prev, { id, name: n }]);
    return id;
  }, [assetTypes]);

  const updateAssetType = useCallback((id: string, name: string) => {
    const n = name.trim();
    if (!n) return;
    setAssetTypes((prev) =>
      prev.map((t) => (t.id === id ? { ...t, name: n } : t)),
    );
  }, []);

  const deleteAssetType = useCallback(
    (id: string, moveToTypeId?: string) => {
      const others = assetTypes.filter((t) => t.id !== id);
      const target = moveToTypeId ?? others[0]?.id;
      if (!target) return;

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
    [assetTypes],
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
      const next = Math.max(0, Math.round(balance));
      setSnapshots((prev) => {
        const idx = prev.findIndex((s) => s.ym === currentMonth);
        if (idx === -1) {
          const base = [...currentAssets];
          const updated = base.map((a) =>
            a.id === id ? { ...a, balance: next } : a,
          );
          return [...prev, { ym: currentMonth, accounts: updated }];
        }
        return prev.map((s, i) =>
          i === idx
            ? {
                ...s,
                accounts: s.accounts.map((a) =>
                  a.id === id ? { ...a, balance: next } : a,
                ),
              }
            : s,
        );
      });
    },
    [currentAssets, currentMonth],
  );

  const setAccountCurrency = useCallback(
    (id: string, currency: string) => {
      setSnapshots((prev) => {
        const idx = prev.findIndex((s) => s.ym === currentMonth);
        if (idx === -1) {
          const base = [...currentAssets];
          const updated = base.map((a) =>
            a.id === id ? { ...a, currency } : a,
          );
          return [...prev, { ym: currentMonth, accounts: updated }];
        }
        return prev.map((s, i) =>
          i === idx
            ? {
                ...s,
                accounts: s.accounts.map((a) =>
                  a.id === id ? { ...a, currency } : a,
                ),
              }
            : s,
        );
      });
    },
    [currentAssets, currentMonth],
  );

  const updateAccountMeta = useCallback(
    (id: string, patch: { name?: string; color?: string }) => {
      const nextName = typeof patch.name === "string" ? patch.name.trim() : undefined;
      const nextColor = typeof patch.color === "string" ? patch.color.trim() : undefined;
      setSnapshots((prev) =>
        prev.map((s) => ({
          ...s,
          accounts: s.accounts.map((a) =>
            a.id === id
              ? { ...a, name: nextName ?? a.name, color: nextColor ?? a.color }
              : a,
          ),
        })),
      );
    },
    [],
  );

  const deleteAccount = useCallback((id: string) => {
    setSnapshots((prev) =>
      prev.map((s) => ({ ...s, accounts: s.accounts.filter((a) => a.id !== id) })),
    );
    setLabelPresets((prev) => prev.filter((p) => p.id !== id));
  }, []);

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
    (ym: YearMonth, input: Omit<AssetAccount, "id">) => {
      const id = newId();
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
      registerAssetName(row.type, row.name);
    },
    [registerAssetName],
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
      assetTypes,
      assetNamePresetsFor,
      registerAssetName,
      addAssetType,
      updateAssetType,
      deleteAssetType,
      clearAllUserData,
    ],
  );
  return <AssetsContext.Provider value={value}>{children}</AssetsContext.Provider>;
}

export function useAssets() {
  const ctx = useContext(AssetsContext);
  if (!ctx) throw new Error("useAssets must be used within AssetsProvider");
  return ctx;
}
