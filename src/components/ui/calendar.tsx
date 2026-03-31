import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { cn } from "@/lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, ...props }: CalendarProps) {
  return (
    <DayPicker
      className={cn("p-3 text-foreground", className)}
      classNames={{
        root: cn("w-full"),
        months: "relative flex flex-col gap-4 sm:flex-row",
        month: "w-full gap-2",
        month_caption: "relative z-[2] mx-10 mb-1 flex h-9 items-center justify-center",
        caption_dropdowns: "flex items-center gap-2",
        dropdown_root: "relative z-[10002]",
        months_dropdown:
          "h-9 min-w-[7.5rem] rounded-xl border border-muted/30 bg-popover px-3 py-1.5 text-start text-sm font-medium text-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        years_dropdown:
          "h-9 min-w-[5.5rem] rounded-xl border border-muted/30 bg-popover px-3 py-1.5 text-start text-sm font-medium text-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        caption_label: "text-sm font-medium text-foreground",
        nav: "absolute top-0 flex w-full justify-between",
        button_previous:
          "inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
        button_next:
          "inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-9 text-center text-sm font-normal leading-relaxed text-muted-foreground",
        week: "mt-2 flex w-full",
        day: "relative z-0 h-9 w-9 p-0 text-center text-sm",
        day_button:
          // Layer above cell chrome so numerals stay readable; touch targets unchanged.
          "relative z-[1] inline-flex size-9 items-center justify-center rounded-xl bg-transparent font-normal text-foreground hover:bg-[#334155] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected:
          // Force high-contrast selected day in all themes.
          "!bg-[#2563eb] !text-white hover:!bg-[#1d4ed8] hover:!text-white",
        today:
          // Distinct and readable "today" marker, different from selected state.
          "bg-[#0f172a] text-white ring-1 ring-[#475569]",
        outside: "text-muted-foreground opacity-40",
        disabled: "text-muted-foreground opacity-30",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chClass }) => {
          const Icon = orientation === "left" ? ChevronLeft : ChevronRight;
          return <Icon className={cn("size-4", chClass)} aria-hidden />;
        },
      }}
      captionLayout="dropdown"
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
