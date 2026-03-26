import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/context/I18nContext";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-9 shrink-0 rounded-full"
      onClick={toggleTheme}
      aria-label={
        theme === "dark" ? t.themeToLight : t.themeToDark
      }
    >
      {theme === "dark" ? (
        <Sun className="size-[1.15rem]" />
      ) : (
        <Moon className="size-[1.15rem]" />
      )}
    </Button>
  );
}
