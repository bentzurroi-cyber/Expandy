import { CategoryGlyph } from "@/components/expense/FinanceGlyphs";
import { cn } from "@/lib/utils";
import { useI18n } from "@/context/I18nContext";

export const CATEGORY_ICON_KEYS = [
  "shopping-cart",
  "shopping-basket",
  "receipt",
  "credit-card",
  "wallet",
  "banknote",
  "home",
  "building",
  "coffee",
  "car",
  "bus",
  "train",
  "bike",
  "plane",
  "fuel",
  "utensils",
  "zap",
  "phone",
  "wifi",
  "tv",
  "gamepad-2",
  "film",
  "music",
  "heart-pulse",
  "pill",
  "stethoscope",
  "baby",
  "paw-print",
  "shirt",
  "gift",
  "book",
  "graduation-cap",
  "clapperboard",
  "briefcase",
  "dumbbell",
  "laptop",
  "tag",
] as const;

export type CategoryIconKey = (typeof CATEGORY_ICON_KEYS)[number];

export function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { dir } = useI18n();
  return (
    <div className="grid grid-cols-6 gap-2" dir={dir}>
      {CATEGORY_ICON_KEYS.map((k) => {
        const active = k === value;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            className={cn(
              "flex items-center justify-center rounded-lg border border-border/70 bg-background p-2 transition-colors",
              "hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active && "border-primary/50 bg-muted/30",
            )}
            aria-pressed={active}
            aria-label={k}
          >
            <CategoryGlyph iconKey={k} className="size-5 text-foreground" />
          </button>
        );
      })}
    </div>
  );
}

