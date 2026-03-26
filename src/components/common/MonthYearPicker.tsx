import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatYearMonth, type YearMonth } from "@/lib/month";
import { cn } from "@/lib/utils";

type MonthYearPickerProps = {
  id?: string;
  value: YearMonth | "all";
  onChange: (v: YearMonth | "all") => void;
  label: string;
  allTimeLabel?: string;
  dir?: "rtl" | "ltr";
  triggerClassName?: string;
};

export function MonthYearPicker({
  id,
  value,
  onChange,
  label,
  allTimeLabel,
  dir = "rtl",
  triggerClassName,
}: MonthYearPickerProps) {
  const baseDate = value === "all" ? new Date() : new Date(`${value}-01`);
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(baseDate.getFullYear());

  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const d = new Date(year, i, 1);
        const ym = formatYearMonth(d);
        const name = d.toLocaleDateString("he-IL", { month: "short" });
        return { ym, name };
      }),
    [year],
  );

  const display =
    value === "all"
      ? allTimeLabel ?? label
      : new Date(`${value}-01`).toLocaleDateString("he-IL", {
          month: "long",
          year: "numeric",
        });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className={cn("w-full justify-between", triggerClassName)}
        >
          <span>{display}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent dir={dir} className="w-[min(92vw,22rem)] p-3">
        <div className="mb-2 flex items-center justify-between">
          <Button type="button" size="icon" variant="ghost" onClick={() => setYear((y) => y - 1)}>
            <ChevronRight className="size-4" />
          </Button>
          <span className="text-sm font-medium tabular-nums">{year}</span>
          <Button type="button" size="icon" variant="ghost" onClick={() => setYear((y) => y + 1)}>
            <ChevronLeft className="size-4" />
          </Button>
        </div>
        {allTimeLabel ? (
          <Button
            type="button"
            variant={value === "all" ? "secondary" : "ghost"}
            className="mb-2 w-full"
            onClick={() => {
              onChange("all");
              setOpen(false);
            }}
          >
            {allTimeLabel}
          </Button>
        ) : null}
        <div className="grid grid-cols-3 gap-2">
          {months.map((m) => (
            <Button
              key={m.ym}
              type="button"
              variant={value === m.ym ? "secondary" : "ghost"}
              className="h-9"
              onClick={() => {
                onChange(m.ym);
                setOpen(false);
              }}
            >
              {m.name}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

