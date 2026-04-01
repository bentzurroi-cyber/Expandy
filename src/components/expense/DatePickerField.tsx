import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDateDDMMYYYY } from "@/lib/format";
import { formatLocalIsoDate, parseLocalIsoDate } from "@/lib/month";
import { cn } from "@/lib/utils";
import { useI18n } from "@/context/I18nContext";
import { useState } from "react";

type DatePickerFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (iso: string) => void;
  variant?: "form" | "row" | "entryMonochrome";
  hideLabel?: boolean;
  /** Merged onto the default trigger (form / row popover button). */
  triggerClassName?: string;
};

export function DatePickerField({
  id,
  label,
  value,
  onChange,
  variant = "form",
  hideLabel = false,
  triggerClassName,
}: DatePickerFieldProps) {
  const date = parseLocalIsoDate(value);
  const { dir } = useI18n();
  const [open, setOpen] = useState(false);

  const calendar = (
    <Calendar
      mode="single"
      selected={date}
      defaultMonth={date ?? new Date()}
      onSelect={(d) => {
        if (d) {
          onChange(formatLocalIsoDate(d));
          setOpen(false);
        }
      }}
      initialFocus
      className="rounded-xl bg-muted/40 p-2 text-foreground dark:bg-muted/30"
    />
  );

  if (variant === "entryMonochrome") {
    return (
      <div className="w-full box-border">
        <button
          id={id}
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "flex w-full items-center justify-between gap-3 border-b border-zinc-300 bg-transparent py-3 text-start text-base leading-relaxed transition-colors",
            "hover:border-zinc-400 focus-visible:outline-none focus-visible:ring-0",
            "dark:border-zinc-700 dark:hover:border-zinc-600",
            !date && "text-zinc-500 dark:text-zinc-500",
            date && "text-zinc-900 dark:text-zinc-100",
          )}
        >
          <span className="flex min-w-0 items-center gap-2 text-zinc-500 dark:text-zinc-400">
            <CalendarIcon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </span>
          <span dir="ltr" className="shrink-0 tabular-nums text-zinc-900 dark:text-zinc-100">
            {value ? formatDateDDMMYYYY(value) : "—"}
          </span>
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            className="max-w-[min(100vw-1.5rem,22rem)] gap-0 border border-border bg-popover p-0 text-popover-foreground shadow-2xl backdrop-blur-xl"
            dir={dir}
          >
            <DialogHeader className="border-b border-border px-4 py-3 text-start">
              <DialogTitle className="text-base font-medium text-foreground">
                {label}
              </DialogTitle>
            </DialogHeader>
            <div className="p-3">{calendar}</div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="w-full box-border space-y-2">
      {!hideLabel ? <Label htmlFor={id}>{label}</Label> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className={cn(
              variant === "row"
                ? "h-auto min-h-[3.5rem] w-full items-center justify-between rounded-none border-0 bg-transparent px-5 py-5 text-base font-normal leading-relaxed"
                : "h-10 w-full justify-start ps-3 text-start text-base font-normal leading-relaxed",
              !date && "text-muted-foreground",
              triggerClassName,
            )}
          >
            {variant === "row" ? (
              dir === "rtl" ? (
                <>
                  <span dir="ltr" className="tabular-nums text-foreground">
                    {value ? formatDateDDMMYYYY(value) : "—"}
                  </span>
                  <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                    <CalendarIcon className="size-4 shrink-0" />
                    <span className="truncate">{label}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                    <CalendarIcon className="size-4 shrink-0" />
                    <span className="truncate">{label}</span>
                  </div>
                  <span dir="ltr" className="tabular-nums text-foreground">
                    {value ? formatDateDDMMYYYY(value) : "—"}
                  </span>
                </>
              )
            ) : (
              <>
                <CalendarIcon className="me-2 size-4 shrink-0 text-muted-foreground" />
                <span dir="ltr" className="tabular-nums">
                  {value ? formatDateDDMMYYYY(value) : "—"}
                </span>
              </>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="z-[10020] w-auto border border-muted/30 bg-popover p-2 shadow-xl"
          align="end"
          dir={dir}
        >
          <Calendar
            mode="single"
            selected={date}
            defaultMonth={date ?? new Date()}
            onSelect={(d) => {
              if (d) {
                onChange(formatLocalIsoDate(d));
                setOpen(false);
              }
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
