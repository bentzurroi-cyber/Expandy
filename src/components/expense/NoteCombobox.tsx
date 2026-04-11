import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MAX_SUGGESTIONS = 5;

/** Match if the note starts with `q` or any whitespace-separated word starts with `q`. */
export function noteSuggestionMatchesPrefix(note: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const s = note.trim();
  if (!s) return false;

  const fold = (x: string) => x.toLocaleLowerCase("en-US");
  const qFold = fold(q);
  const matchesToken = (token: string) => {
    const t = token.trim();
    if (!t) return false;
    return t.startsWith(q) || fold(t).startsWith(qFold);
  };

  if (matchesToken(s)) return true;
  return s.split(/\s+/).some(matchesToken);
}

export type NoteComboboxProps = {
  id: string;
  value: string;
  onChange: (v: string) => void;
  /** Already capped (e.g. 5); most-recent-first order. */
  suggestions: string[];
  placeholder?: string;
  className?: string;
  inputClassName?: string;
};

/**
 * Custom note field with a short, styled suggestion list (no native datalist).
 * Dropdown matches the input width and uses logical start/end for RTL alignment.
 */
export function NoteCombobox({
  id,
  value,
  onChange,
  suggestions,
  placeholder,
  className,
  inputClassName,
}: NoteComboboxProps) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtered = useMemo(() => {
    const q = value.trim();
    if (!q) return suggestions.slice(0, MAX_SUGGESTIONS);
    return suggestions
      .filter((s) => noteSuggestionMatchesPrefix(s, q))
      .slice(0, MAX_SUGGESTIONS);
  }, [value, suggestions]);

  useEffect(() => {
    return () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    };
  }, []);

  const cancelClose = () => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
  };

  const scheduleClose = () => {
    blurTimer.current = setTimeout(() => setOpen(false), 150);
  };

  const showList = open && filtered.length > 0 && suggestions.length > 0;
  const listboxId = `${id}-note-listbox`;

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (suggestions.length > 0) setOpen(true);
        }}
        onFocus={() => {
          cancelClose();
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={() => scheduleClose()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={showList ? listboxId : undefined}
        aria-autocomplete="list"
        className={cn(
          "w-full rounded-md border border-input bg-background p-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:ring-offset-0",
          inputClassName,
        )}
      />
      {showList ? (
        <ul
          id={listboxId}
          role="listbox"
          className={cn(
            "absolute start-0 end-0 top-full z-[10000] mt-1 max-h-[min(12rem,45vh)] overflow-y-auto rounded-lg border border-border/80",
            "bg-popover py-2 text-popover-foreground shadow-xl",
          )}
        >
          {filtered.map((s) => (
            <li key={s} role="presentation" className="px-1">
              <button
                type="button"
                role="option"
                aria-selected={value === s}
                className={cn(
                  "w-full rounded-md px-3 py-2.5 text-start text-sm leading-relaxed",
                  "text-foreground hover:bg-accent/60 focus:bg-accent/60 focus:outline-none",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(s);
                  setOpen(false);
                }}
              >
                <span className="block break-words">{s}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
