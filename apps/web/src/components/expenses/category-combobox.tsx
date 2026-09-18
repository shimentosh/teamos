import { Check, Plus } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import {
  useExpenseCategories,
  useExpenseCategoryActions,
} from "@/hooks/queries/use-expense-categories";
import { cn } from "@/lib/cn";
import { EXPENSE_ICON_NAMES, ExpenseCategoryIcon } from "@/lib/expense-icons";
import { toast } from "@/lib/toast";

// One input to search the workspace's categories, pick one, or (for admins)
// create a new one with an icon. Others can still file under a one-off name.
export function CategoryCombobox({
  inputId,
  workspaceId,
  value,
  onChange,
  canManage,
}: {
  inputId?: string;
  workspaceId: string;
  value: string;
  onChange: (name: string) => void;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const generatedId = useId();
  const id = inputId ?? generatedId;
  const { data: categories = [] } = useExpenseCategories(workspaceId);
  const { create } = useExpenseCategoryActions(workspaceId);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [choosingIcon, setChoosingIcon] = useState(false);

  const needle = value.trim().toLowerCase();
  const matches = categories.filter((c) =>
    c.name.toLowerCase().includes(needle),
  );
  const exact = categories.find((c) => c.name.toLowerCase() === needle);
  const offerNew = needle.length > 0 && !exact;
  // Rows: matching categories, then the create / use-as-typed row.
  const rowCount = matches.length + (offerNew ? 1 : 0);
  const current = exact ?? null;

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
    setChoosingIcon(false);
  };

  const createWith = async (icon: string) => {
    try {
      const created = await create.mutateAsync({ name: value.trim(), icon });
      pick(created.name);
      toast.success(t("expenses:categories.created", { name: created.name }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("requests:error"));
    }
  };

  const chooseNew = () => {
    if (canManage) setChoosingIcon(true);
    else pick(value.trim());
  };

  return (
    <div className="relative">
      <ExpenseCategoryIcon
        icon={current?.icon}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        className="pl-8"
        placeholder={t("expenses:categories.placeholder")}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
          setChoosingIcon(false);
        }}
        onKeyDown={(e) => {
          if (!open || rowCount === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % rowCount);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i - 1 + rowCount) % rowCount);
          } else if (e.key === "Enter") {
            e.preventDefault();
            const row = Math.min(active, rowCount - 1);
            const match = matches[row];
            if (match) pick(match.name);
            else chooseNew();
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (rowCount > 0 || choosingIcon) && (
        <div
          id={`${id}-list`}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
          // Keep focus in the input while clicking.
          onMouseDown={(e) => e.preventDefault()}
        >
          {matches.map((category, index) => (
            <button
              key={category.id}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(category.name)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                index === active && "bg-accent",
              )}
            >
              <ExpenseCategoryIcon
                icon={category.icon}
                className="text-muted-foreground"
              />
              <span className="flex-1 truncate">{category.name}</span>
              {exact?.id === category.id && <Check className="size-3.5" />}
            </button>
          ))}
          {offerNew && !choosingIcon && (
            <button
              type="button"
              role="option"
              aria-selected={active === matches.length}
              onMouseEnter={() => setActive(matches.length)}
              onClick={chooseNew}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                active === matches.length && "bg-accent",
              )}
            >
              <Plus className="size-3.5 text-muted-foreground" />
              <span className="truncate">
                {canManage
                  ? t("expenses:categories.create", { name: value.trim() })
                  : t("expenses:categories.useTyped", { name: value.trim() })}
              </span>
            </button>
          )}
          {choosingIcon && (
            <div className="space-y-2 p-2">
              <p className="text-xs text-muted-foreground">
                {t("expenses:categories.pickIcon", { name: value.trim() })}
              </p>
              <div className="grid grid-cols-8 gap-1">
                {EXPENSE_ICON_NAMES.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    title={icon}
                    aria-label={icon}
                    disabled={create.isPending}
                    onClick={() => void createWith(icon)}
                    className="flex aspect-square items-center justify-center rounded-md border border-border hover:border-primary hover:bg-primary/10"
                  >
                    <ExpenseCategoryIcon icon={icon} className="size-4" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
