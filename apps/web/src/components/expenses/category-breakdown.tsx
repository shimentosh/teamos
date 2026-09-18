import { ChevronDown, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { ExpenseCategoryIcon } from "@/lib/expense-icons";

export type CategoryTotal = { name: string; amount: number; count: number };

// The top few categories get their own colour; everything after them is
// "Other", so the bar stays readable with 5 categories or 150.
const TOP = 6;
const COLORS = [
  { bar: "bg-sky-500", tile: "bg-sky-500/15 text-sky-600 dark:text-sky-300" },
  {
    bar: "bg-violet-500",
    tile: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  },
  {
    bar: "bg-emerald-500",
    tile: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  },
  {
    bar: "bg-amber-500",
    tile: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  },
  {
    bar: "bg-rose-500",
    tile: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  },
  {
    bar: "bg-teal-500",
    tile: "bg-teal-500/15 text-teal-600 dark:text-teal-300",
  },
];
const OTHER = {
  bar: "bg-muted-foreground/40",
  tile: "bg-muted text-muted-foreground",
};

function percent(part: number, whole: number) {
  if (!whole) return 0;
  const value = (part / whole) * 100;
  return value < 1 && value > 0 ? 1 : Math.round(value);
}

function Row({
  row,
  total,
  color,
  icon,
  money,
  selected,
  dimmed,
  onSelect,
  compact = false,
}: {
  row: CategoryTotal;
  total: number;
  color: (typeof COLORS)[number];
  icon: string | undefined;
  money: (minor: number) => string;
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const share = percent(row.amount, total);
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-2 text-left transition-colors hover:bg-accent/60",
          compact ? "py-1.5" : "py-2",
          selected && "bg-accent",
          dimmed && "opacity-50",
        )}
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md",
            compact ? "size-7" : "size-8",
            color.tile,
          )}
        >
          <ExpenseCategoryIcon icon={icon} className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium">{row.name}</span>
            <span className="shrink-0 text-sm tabular-nums">
              {money(row.amount)}
            </span>
          </span>
          <span className="mt-1 flex items-center gap-2">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className={cn("block h-full rounded-full", color.bar)}
                style={{ width: `${share}%` }}
              />
            </span>
            <span className="w-24 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
              {t("expenses:breakdown.items", { count: row.count })} · {share}%
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * Where the money went: one stacked bar for the whole period, the biggest
 * categories with their share, and every other category one click away.
 */
export function CategoryBreakdown({
  rows,
  iconFor,
  money,
  selected,
  onSelect,
}: {
  rows: CategoryTotal[];
  iconFor: (name: string) => string | undefined;
  money: (minor: number) => string;
  selected: string | null;
  onSelect: (name: string | null) => void;
}) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const top = rows.slice(0, TOP);
  const rest = rows.slice(TOP);
  const restAmount = rest.reduce((sum, r) => sum + r.amount, 0);
  const colorOf = (name: string) => {
    const index = top.findIndex((r) => r.name === name);
    return index >= 0 ? (COLORS[index] ?? OTHER) : OTHER;
  };
  const toggle = (name: string) => onSelect(selected === name ? null : name);
  const needle = search.trim().toLowerCase();
  const listed = showAll
    ? rows.filter((r) => !needle || r.name.toLowerCase().includes(needle))
    : top;

  return (
    <section className="rounded-lg border border-border p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          {t("expenses:byCategory")}
          <span className="ms-1.5 tabular-nums">· {rows.length}</span>
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {money(total)}
        </span>
      </div>

      <div className="mb-4 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
        {top.map((r, index) => (
          <button
            key={r.name}
            type="button"
            title={`${r.name} · ${money(r.amount)}`}
            aria-label={`${r.name} · ${money(r.amount)}`}
            onClick={() => toggle(r.name)}
            className={cn(
              "h-full min-w-1 transition-opacity",
              COLORS[index]?.bar,
              selected && selected !== r.name && "opacity-30",
            )}
            style={{ width: `${(r.amount / total) * 100}%` }}
          />
        ))}
        {restAmount > 0 && (
          <span
            title={t("expenses:breakdown.other", { count: rest.length })}
            className={cn("h-full min-w-1", OTHER.bar)}
            style={{ width: `${(restAmount / total) * 100}%` }}
          />
        )}
      </div>

      {showAll && rows.length > 8 && (
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("expenses:breakdown.search")}
            aria-label={t("expenses:breakdown.search")}
            className="h-8 ps-8 text-sm"
          />
        </div>
      )}

      <ul
        className={cn(
          "grid gap-x-6 sm:grid-cols-2",
          showAll && "max-h-96 overflow-y-auto pe-1",
        )}
      >
        {listed.map((row) => (
          <Row
            key={row.name}
            row={row}
            total={total}
            color={colorOf(row.name)}
            icon={iconFor(row.name)}
            money={money}
            selected={selected === row.name}
            dimmed={Boolean(selected) && selected !== row.name}
            onSelect={() => toggle(row.name)}
            compact={showAll}
          />
        ))}
        {!showAll && rest.length > 0 && (
          <li>
            <div className="flex items-center gap-3 px-2 py-2">
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
                  OTHER.tile,
                )}
              >
                +{rest.length}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {t("expenses:breakdown.other", { count: rest.length })}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums">
                    {money(restAmount)}
                  </span>
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn("block h-full rounded-full", OTHER.bar)}
                      style={{ width: `${percent(restAmount, total)}%` }}
                    />
                  </span>
                  <span className="w-24 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                    {percent(restAmount, total)}%
                  </span>
                </span>
              </span>
            </div>
          </li>
        )}
        {showAll && listed.length === 0 && (
          <li className="px-2 py-3 text-sm text-muted-foreground">
            {t("expenses:breakdown.noMatch")}
          </li>
        )}
      </ul>

      {rows.length > TOP && (
        <button
          type="button"
          onClick={() => {
            setShowAll((v) => !v);
            setSearch("");
          }}
          className="mt-2 flex items-center gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform",
              showAll && "rotate-180",
            )}
          />
          {showAll
            ? t("expenses:breakdown.showTop", { count: TOP })
            : t("expenses:breakdown.showAll", { count: rows.length })}
        </button>
      )}
    </section>
  );
}
