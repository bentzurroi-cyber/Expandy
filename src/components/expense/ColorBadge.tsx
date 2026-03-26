import { cn } from "@/lib/utils";

type ColorBadgeProps = {
  color: string;
  className?: string;
  title?: string;
};

/** Small filled disc used next to select labels and in lists. */
export function ColorBadge({ color, className, title }: ColorBadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15",
        className,
      )}
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}
