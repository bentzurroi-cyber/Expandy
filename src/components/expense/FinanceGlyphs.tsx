import type { LucideIcon } from "lucide-react";
import {
  BadgeCent,
  Banknote,
  Baby,
  Bike,
  Briefcase,
  BookOpen,
  Building2,
  Bus,
  Car,
  Clapperboard,
  Coffee,
  Coins,
  CreditCard,
  DollarSign,
  Dumbbell,
  Euro,
  Film,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Laptop,
  Music,
  PawPrint,
  PiggyBank,
  Plane,
  Phone,
  Pill,
  Receipt,
  Shirt,
  ShoppingCart,
  ShoppingBasket,
  Stethoscope,
  Tag,
  Train,
  TrendingUp,
  Tv,
  UtensilsCrossed,
  Wallet,
  Wifi,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "shopping-cart": ShoppingCart,
  "shopping-basket": ShoppingBasket,
  receipt: Receipt,
  "credit-card": CreditCard,
  wallet: Wallet,
  banknote: Banknote,
  home: Home,
  building: Building2,
  coffee: Coffee,
  car: Car,
  bus: Bus,
  train: Train,
  bike: Bike,
  plane: Plane,
  fuel: Fuel,
  utensils: UtensilsCrossed,
  zap: Zap,
  phone: Phone,
  wifi: Wifi,
  tv: Tv,
  "gamepad-2": Gamepad2,
  film: Film,
  music: Music,
  "heart-pulse": HeartPulse,
  pill: Pill,
  stethoscope: Stethoscope,
  baby: Baby,
  "paw-print": PawPrint,
  shirt: Shirt,
  gift: Gift,
  book: BookOpen,
  "graduation-cap": GraduationCap,
  clapperboard: Clapperboard,
  briefcase: Briefcase,
  dumbbell: Dumbbell,
  laptop: Laptop,
  tag: Tag,
  "piggy-bank": PiggyBank,
  "trending-up": TrendingUp,
};

const CURRENCY_ICONS: Record<string, LucideIcon> = {
  ils: Coins,
  coins: Coins,
  "dollar-sign": DollarSign,
  euro: Euro,
  "badge-cent": BadgeCent,
  generic: BadgeCent,
};

function isEmoji(s: string): boolean {
  return /\p{Extended_Pictographic}/u.test(s);
}

/** תומך בנתונים ישנים: אם iconKey נראה כמו אימוג'י — מציג Tag */
export function CategoryGlyph({
  iconKey,
  className,
}: {
  iconKey: string;
  className?: string;
}) {
  const key =
    iconKey && !isEmoji(iconKey) && CATEGORY_ICONS[iconKey] ? iconKey : "tag";
  const Icon = CATEGORY_ICONS[key] ?? Tag;
  return (
    <Icon
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
      aria-hidden
    />
  );
}

export function CurrencyGlyph({
  iconKey,
  className,
}: {
  iconKey: string;
  className?: string;
}) {
  const key =
    iconKey && !isEmoji(iconKey) && CURRENCY_ICONS[iconKey]
      ? iconKey
      : "generic";
  const Icon = CURRENCY_ICONS[key] ?? BadgeCent;
  return (
    <Icon
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
      aria-hidden
    />
  );
}
