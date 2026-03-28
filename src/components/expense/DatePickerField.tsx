import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
  variant?: "form" | "row";
  hideLabel?: boolean;
};

export function DatePickerField({
  id,
  label,
  value,
  onChange,
  variant = "form",
  hideLabel = false,
}: DatePickerFieldProps) {
  const date = parseLocalIsoDate(value);
  const { dir } = useI18n();
  const [open, setOpen] = useState(false);

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
            )}
          >
            {variant === "row" ? (
              <>
                <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <CalendarIcon className="size-4 shrink-0" />
                  <span className="truncate">{label}</span>
                </div>
                <span dir="ltr" className="tabular-nums text-foreground">
                  {value ? formatDateDDMMYYYY(value) : "—"}
                </span>
              </>
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
