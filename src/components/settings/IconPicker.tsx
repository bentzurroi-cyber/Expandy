import { useMemo, useState } from "react";
import { CategoryGlyph } from "@/components/expense/FinanceGlyphs";
import { Button } from "@/components/ui/button";
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
  "piggy-bank",
  "trending-up",
] as const;

export type CategoryIconKey = (typeof CATEGORY_ICON_KEYS)[number];

const INITIAL_ICON_COUNT = 5;

function collapsedIconKeys(value: string): readonly CategoryIconKey[] {
  const first = CATEGORY_ICON_KEYS.slice(0, INITIAL_ICON_COUNT);
  const sel = CATEGORY_ICON_KEYS.includes(value as CategoryIconKey)
    ? (value as CategoryIconKey)
    : undefined;
  if (!sel || first.includes(sel)) return first;
  return [...first.slice(0, INITIAL_ICON_COUNT - 1), sel];
}

export function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { dir, t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const keys = useMemo(
    () => (expanded ? CATEGORY_ICON_KEYS : collapsedIconKeys(value)),
    [expanded, value],
  );
  const showToggle = CATEGORY_ICON_KEYS.length > INITIAL_ICON_COUNT;

  return (
    <div className="space-y-2" dir={dir}>
      <div className="grid grid-cols-6 gap-2">
        {keys.map((k) => {
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
      {showToggle ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? t.iconPickerHide : t.iconPickerShowMore}
        </Button>
      ) : null}
    </div>
  );
}

