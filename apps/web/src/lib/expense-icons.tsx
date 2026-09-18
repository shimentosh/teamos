import {
  AppWindow,
  Book,
  Briefcase,
  Car,
  Coffee,
  Fuel,
  Gift,
  GraduationCap,
  Home,
  Hotel,
  Laptop,
  type LucideIcon,
  Megaphone,
  Package,
  Phone,
  Plane,
  Receipt,
  ShoppingCart,
  Stethoscope,
  Tag,
  Train,
  Utensils,
  Wifi,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";

// The icons a category can use. Stored by name; anything unknown shows a tag.
export const EXPENSE_ICONS: Record<string, LucideIcon> = {
  Tag,
  Plane,
  Train,
  Car,
  Fuel,
  Hotel,
  Utensils,
  Coffee,
  Laptop,
  AppWindow,
  Phone,
  Wifi,
  Package,
  ShoppingCart,
  Wrench,
  Home,
  Briefcase,
  Megaphone,
  Book,
  GraduationCap,
  Stethoscope,
  Gift,
  Receipt,
};

export const EXPENSE_ICON_NAMES = Object.keys(EXPENSE_ICONS);

export function ExpenseCategoryIcon({
  icon,
  className,
}: {
  icon?: string | null;
  className?: string;
}) {
  const Icon = (icon && EXPENSE_ICONS[icon]) || Tag;
  return <Icon className={cn("size-3.5 shrink-0", className)} />;
}
