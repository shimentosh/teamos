import { Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useExpenseCategories,
  useExpenseCategoryActions,
} from "@/hooks/queries/use-expense-categories";
import { cn } from "@/lib/cn";
import { EXPENSE_ICON_NAMES, ExpenseCategoryIcon } from "@/lib/expense-icons";
import { toast } from "@/lib/toast";

function IconPicker({
  value,
  onPick,
  label,
}: {
  value: string;
  onPick: (icon: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={label}
            title={label}
          />
        }
      >
        <ExpenseCategoryIcon icon={value} className="size-4" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="grid grid-cols-6 gap-1">
          {EXPENSE_ICON_NAMES.map((icon) => (
            <button
              key={icon}
              type="button"
              title={icon}
              aria-label={icon}
              onClick={() => {
                onPick(icon);
                setOpen(false);
              }}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md border hover:bg-accent",
                icon === value
                  ? "border-primary bg-primary/10"
                  : "border-border",
              )}
            >
              <ExpenseCategoryIcon icon={icon} className="size-4" />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ManageCategoriesDialog({
  open,
  onClose,
  workspaceId,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const { data: categories = [] } = useExpenseCategories(workspaceId, open);
  const { create, setIcon, remove } = useExpenseCategoryActions(workspaceId);
  const [name, setName] = useState("");
  const [icon, setNewIcon] = useState("Tag");
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const visible = categories
    .filter((c) => !needle || c.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name));

  const act = (fn: () => Promise<unknown>) =>
    fn().catch((error) =>
      toast.error(error instanceof Error ? error.message : t("requests:error")),
    );

  const add = () => {
    if (!name.trim()) return;
    act(() =>
      create.mutateAsync({ name: name.trim(), icon }).then(() => {
        setName("");
        setNewIcon("Tag");
      }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPopup className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle>{t("expenses:categories.manageTitle")}</DialogTitle>
          <DialogDescription>
            {t("expenses:categories.manageHint")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <IconPicker
              value={icon}
              label={t("expenses:categories.newIcon")}
              onPick={setNewIcon}
            />
            <Input
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("expenses:categories.newName")}
              aria-label={t("expenses:categories.newName")}
            />
            <Button
              type="submit"
              size="sm"
              className="gap-1"
              disabled={!name.trim() || create.isPending}
            >
              <Plus className="size-3.5" />
              {t("expenses:categories.add")}
            </Button>
          </form>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("expenses:categories.search")}
                aria-label={t("expenses:categories.search")}
                className="h-8 ps-8 text-sm"
              />
            </div>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {t("expenses:categories.count", { count: categories.length })}
            </span>
          </div>

          {/* Scrolls on its own, so 150 categories still fit the dialog. */}
          <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {visible.map((category) => (
              <li
                key={category.id}
                className="group flex items-center gap-2 px-2 py-1.5 hover:bg-accent/40"
              >
                <IconPicker
                  value={category.icon}
                  label={t("expenses:categories.changeIcon", {
                    name: category.name,
                  })}
                  onPick={(next) =>
                    act(() =>
                      setIcon.mutateAsync({ id: category.id, icon: next }),
                    )
                  }
                />
                <span className="flex-1 truncate text-sm">{category.name}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("expenses:categories.remove", {
                    name: category.name,
                  })}
                  title={t("expenses:categories.remove", {
                    name: category.name,
                  })}
                  disabled={remove.isPending}
                  onClick={() => act(() => remove.mutateAsync(category.id))}
                  className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-3 py-4 text-center text-sm text-muted-foreground">
                {t("expenses:breakdown.noMatch")}
              </li>
            )}
          </ul>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
