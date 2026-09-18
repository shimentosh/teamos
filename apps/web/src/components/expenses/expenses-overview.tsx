import { Link } from "@tanstack/react-router";
import { format, lastDayOfMonth } from "date-fns";
import { Check, Paperclip, Plus, Search, Tags, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { monthLabel } from "@/components/pay/labels";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import { AddExpenseDialog } from "@/components/requests/add-expense-dialog";
import {
  requestStatusLabel,
  requestStatusVariant,
} from "@/components/requests/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Expense, receiptUrl } from "@/fetchers/requests";
import { useRequestActions } from "@/hooks/mutations/company-os";
import {
  useAllExpenses,
  useExpenses,
  usePayrollRuns,
} from "@/hooks/queries/company-os";
import { useExpenseCategories } from "@/hooks/queries/use-expense-categories";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { ExpenseCategoryIcon } from "@/lib/expense-icons";
import { formatDateMedium } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { toast } from "@/lib/toast";
import { CategoryBreakdown, type CategoryTotal } from "./category-breakdown";
import { ManageCategoriesDialog } from "./manage-categories-dialog";
import { PaymentMethodBadge, PaymentPicker } from "./payment-method";

const ALL = "__all__";
const STATUSES = ["all", "pending", "approved", "paid", "rejected"] as const;
type StatusFilter = (typeof STATUSES)[number];

function recentMonths(count: number) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1, first: d };
  });
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "attention" | "strong";
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div
        className={cn(
          "truncate text-lg font-semibold tabular-nums",
          tone === "attention" && "text-warning-foreground",
          tone === "strong" && "text-primary",
        )}
      >
        {value}
      </div>
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      {hint && (
        <div className="truncate text-[11px] text-muted-foreground/80">
          {hint}
        </div>
      )}
    </div>
  );
}

export function ExpensesOverview({
  workspaceId,
  currency,
}: {
  workspaceId: string;
  currency: string;
}) {
  const { t, i18n } = useTranslation();
  const { canApproveRequests, canSeePay, canManagePay, canManageWorkspace } =
    useWorkspacePermission();
  const { user } = useAuth();
  const { data: categoryList = [] } = useExpenseCategories(workspaceId);
  const iconFor = (name: string) =>
    categoryList.find((c) => c.name.toLowerCase() === name.toLowerCase())?.icon;
  const [manageOpen, setManageOpen] = useState(false);
  const seeAll = Boolean(canApproveRequests());
  const seePay = Boolean(canSeePay());
  const managePay = Boolean(canManagePay());
  const months = useMemo(() => recentMonths(12), []);
  const [period, setPeriod] = useState(() => {
    const m = months[0];
    return `${m?.year}-${m?.month}`;
  });
  const [status, setStatus] = useState<StatusFilter>("all");
  const [person, setPerson] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const range = useMemo(() => {
    if (period === ALL) return {};
    const [year, month] = period.split("-").map(Number);
    const first = new Date(year as number, (month as number) - 1, 1);
    return {
      from: format(first, "yyyy-MM-dd"),
      to: format(lastDayOfMonth(first), "yyyy-MM-dd"),
    };
  }, [period]);

  const everyone = useAllExpenses(workspaceId, range, seeAll);
  const mine = useExpenses(seeAll ? undefined : workspaceId);
  const { data: runs = [] } = usePayrollRuns(workspaceId, seePay);
  const { decideExpense, markExpensePaid, cancelExpense } =
    useRequestActions(workspaceId);

  // Approvers get the period from the API; everyone else filters their own.
  const inPeriod = useMemo(() => {
    const rows = (seeAll ? everyone.data : mine.data) ?? [];
    if (seeAll || !range.from || !range.to) return rows;
    return rows.filter(
      (e) => e.spentOn >= (range.from ?? "") && e.spentOn <= (range.to ?? ""),
    );
  }, [seeAll, everyone.data, mine.data, range]);

  const people = useMemo(() => {
    const byId = new Map<string, string>();
    for (const e of inPeriod) byId.set(e.userId, e.userName);
    return [...byId.entries()].sort(([, a], [, b]) => a.localeCompare(b));
  }, [inPeriod]);

  // Totals are in the company currency; other currencies are counted apart.
  const sum = (rows: Expense[]) =>
    rows
      .filter((e) => e.currency === currency)
      .reduce((total, e) => total + e.amount, 0);
  const live = inPeriod.filter(
    (e) => e.status !== "rejected" && e.status !== "cancelled",
  );
  const pending = inPeriod.filter((e) => e.status === "pending");
  const approved = inPeriod.filter((e) => e.status === "approved");
  const paid = inPeriod.filter((e) => e.status === "paid");
  const otherCurrency = live.filter((e) => e.currency !== currency).length;

  const byCategory = useMemo(() => {
    const totals = new Map<string, CategoryTotal>();
    for (const e of live) {
      if (e.currency !== currency) continue;
      const row = totals.get(e.category) ?? {
        name: e.category,
        amount: 0,
        count: 0,
      };
      row.amount += e.amount;
      row.count += 1;
      totals.set(e.category, row);
    }
    return [...totals.values()].sort((a, b) => b.amount - a.amount);
  }, [live, currency]);

  const [year, month] = period.split("-").map(Number);
  const run =
    period === ALL
      ? undefined
      : runs.find((r) => r.year === year && r.month === month);
  const committed = sum(approved) + sum(paid);
  // Payroll only adds up with expenses when both are in the same currency.
  const payrollInCurrency = run && run.currency === currency ? run.netTotal : 0;

  const counts = Object.fromEntries(
    STATUSES.map((s) => [
      s,
      s === "all"
        ? inPeriod.length
        : inPeriod.filter((e) => e.status === s).length,
    ]),
  ) as Record<StatusFilter, number>;

  const rows = inPeriod
    .filter((e) => status === "all" || e.status === status)
    .filter((e) => person === ALL || e.userId === person)
    .filter((e) => category === ALL || e.category === category)
    .filter((e) => {
      const needle = query.trim().toLowerCase();
      return (
        !needle ||
        e.category.toLowerCase().includes(needle) ||
        (e.description ?? "").toLowerCase().includes(needle) ||
        e.userName.toLowerCase().includes(needle) ||
        (e.projectName ?? "").toLowerCase().includes(needle)
      );
    });

  const money = (minor: number, cur = currency) =>
    formatMoney(minor, cur, i18n.language);
  const act = (fn: () => Promise<unknown>) =>
    fn().catch((error) =>
      toast.error(error instanceof Error ? error.message : t("requests:error")),
    );

  const periodLabel =
    period === ALL
      ? t("expenses:allTime")
      : monthLabel(i18n.language, year as number, month as number);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={period}
          onValueChange={(value) => {
            if (typeof value === "string") setPeriod(value);
          }}
        >
          <SelectTrigger size="sm" className="w-44">
            <SelectValue>{periodLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {months.map((m) => (
              <SelectItem
                key={`${m.year}-${m.month}`}
                value={`${m.year}-${m.month}`}
              >
                {monthLabel(i18n.language, m.year, m.month)}
              </SelectItem>
            ))}
            <SelectItem value={ALL}>{t("expenses:allTime")}</SelectItem>
          </SelectContent>
        </Select>
        {canManageWorkspace() && (
          <Button
            size="sm"
            variant="outline"
            className="ms-auto gap-1"
            onClick={() => setManageOpen(true)}
          >
            <Tags className="size-3.5" />
            {t("expenses:categories.manage")}
          </Button>
        )}
        <Button
          size="sm"
          className={cn("gap-1", !canManageWorkspace() && "ms-auto")}
          onClick={() => setAddOpen(true)}
        >
          <Plus className="size-3.5" />
          {t("myWork:expenses.add")}
        </Button>
      </div>

      <div
        className={cn(
          "grid grid-cols-2 divide-border rounded-lg border border-border sm:grid-cols-4 sm:divide-x",
          seePay && "lg:grid-cols-6",
        )}
      >
        <Stat
          label={t("expenses:summary.spent")}
          value={money(sum(live))}
          hint={[
            t("expenses:summary.count", { count: live.length }),
            otherCurrency > 0
              ? t("expenses:summary.otherCurrency", { count: otherCurrency })
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
        <Stat
          label={t("expenses:summary.pending")}
          value={money(sum(pending))}
          hint={t("expenses:summary.count", { count: pending.length })}
          tone={pending.length > 0 ? "attention" : undefined}
        />
        <Stat
          label={t("expenses:summary.toReimburse")}
          value={money(sum(approved))}
          hint={t("expenses:summary.count", { count: approved.length })}
        />
        <Stat
          label={t("expenses:summary.reimbursed")}
          value={money(sum(paid))}
          hint={t("expenses:summary.count", { count: paid.length })}
        />
        {seePay && (
          <>
            <Stat
              label={t("expenses:summary.payroll")}
              value={run ? money(run.netTotal, run.currency) : "–"}
              hint={
                period === ALL
                  ? t("expenses:summary.pickMonth")
                  : run
                    ? t("expenses:summary.people", { count: run.people })
                    : t("expenses:summary.noRun")
              }
            />
            <Stat
              label={t("expenses:summary.totalCost")}
              value={money(committed + payrollInCurrency)}
              hint={t("expenses:summary.totalHint")}
              tone="strong"
            />
          </>
        )}
      </div>

      {byCategory.length > 0 && (
        <CategoryBreakdown
          rows={byCategory}
          iconFor={iconFor}
          money={money}
          selected={category === ALL ? null : category}
          onSelect={(name) => setCategory(name ?? ALL)}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label={t("expenses:filters")}
          className="flex flex-wrap items-center gap-1 rounded-lg bg-muted/50 p-1"
        >
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => setStatus(s)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
                status === s
                  ? "bg-background font-medium text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s === "all"
                ? t("expenses:status.all")
                : requestStatusLabel(t, s)}
              <span
                className={cn(
                  "rounded px-1 tabular-nums",
                  s === "pending" && counts[s] > 0
                    ? "bg-warning/15 text-warning-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {counts[s]}
              </span>
            </button>
          ))}
        </div>
        <div className="ms-auto flex w-full items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-48 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              size="sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("expenses:search")}
              aria-label={t("expenses:search")}
              className="pl-7"
            />
          </div>
          {seeAll && (
            <Select
              value={person}
              onValueChange={(value) => {
                if (typeof value === "string") setPerson(value);
              }}
            >
              <SelectTrigger size="sm" className="w-40">
                <SelectValue>
                  {person === ALL
                    ? t("expenses:everyone")
                    : (people.find(([id]) => id === person)?.[1] ?? "")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("expenses:everyone")}</SelectItem>
                {people.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
              <th className="w-28">{t("expenses:col.date")}</th>
              {seeAll && <th className="w-40">{t("expenses:col.person")}</th>}
              <th>{t("expenses:col.what")}</th>
              <th className="w-36">{t("expenses:col.project")}</th>
              <th className="w-32 text-right!">{t("expenses:col.amount")}</th>
              <th className="w-28">{t("expenses:col.status")}</th>
              <th className="w-44" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={seeAll ? 7 : 6}
                  className="px-3 py-10 text-center text-muted-foreground"
                >
                  {inPeriod.length === 0
                    ? t("expenses:empty")
                    : t("expenses:noMatch")}
                </td>
              </tr>
            ) : (
              rows.map((expense) => (
                <tr
                  key={expense.id}
                  className="transition-colors hover:bg-accent/40 [&>td]:px-3 [&>td]:py-2"
                >
                  <td className="text-xs tabular-nums text-muted-foreground">
                    {formatDateMedium(expense.spentOn)}
                  </td>
                  {seeAll && (
                    <td className="max-w-0 truncate">{expense.userName}</td>
                  )}
                  <td className="max-w-0">
                    <div className="flex items-center gap-2">
                      <span className="flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
                        <ExpenseCategoryIcon
                          icon={iconFor(expense.category)}
                          className="size-3 text-muted-foreground"
                        />
                        {expense.category}
                      </span>
                      <span className="truncate text-muted-foreground">
                        {expense.description}
                      </span>
                      {expense.receiptFileId && (
                        <a
                          href={receiptUrl(workspaceId, expense.receiptFileId)}
                          target="_blank"
                          rel="noreferrer"
                          title={expense.receiptName ?? t("expenses:receipt")}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <Paperclip className="size-3.5" />
                          <span className="sr-only">
                            {t("expenses:receipt")}
                          </span>
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="max-w-0 text-xs text-muted-foreground">
                    <span className="block truncate">
                      {expense.projectName ?? "–"}
                    </span>
                    {expense.taskId && expense.projectId && (
                      <Link
                        to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                        params={{
                          workspaceId,
                          projectId: expense.projectId,
                          taskId: expense.taskId,
                        }}
                        title={expense.taskTitle ?? undefined}
                        className="block truncate text-foreground/80 hover:underline"
                      >
                        {expense.taskRef} {expense.taskTitle}
                      </Link>
                    )}
                  </td>
                  <td className="text-right font-medium tabular-nums">
                    {money(expense.amount, expense.currency)}
                  </td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant={requestStatusVariant(expense.status)}>
                        {requestStatusLabel(t, expense.status)}
                      </Badge>
                      <PaymentMethodBadge
                        method={expense.paymentMethod}
                        reference={expense.paymentReference}
                      />
                    </div>
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {/* Approvers decide others' expenses; their own they
                          can only withdraw, like everyone else. */}
                      {seeAll &&
                        expense.status === "pending" &&
                        expense.userId !== user?.id && (
                          <>
                            <PaymentPicker
                              title={t("expenses:payment.approveTitle")}
                              confirmLabel={t("expenses:approve")}
                              busy={decideExpense.isPending}
                              onConfirm={(payment) =>
                                act(() =>
                                  decideExpense.mutateAsync({
                                    id: expense.id,
                                    decision: "approved",
                                    ...payment,
                                  }),
                                )
                              }
                              trigger={
                                <Button
                                  variant="outline"
                                  size="xs"
                                  className="gap-1"
                                >
                                  <Check className="size-3" />
                                  {t("expenses:approve")}
                                </Button>
                              }
                            />
                            <Button
                              variant="ghost"
                              size="xs"
                              aria-label={t("expenses:reject")}
                              title={t("expenses:reject")}
                              onClick={() =>
                                act(() =>
                                  decideExpense.mutateAsync({
                                    id: expense.id,
                                    decision: "rejected",
                                  }),
                                )
                              }
                            >
                              <X className="size-3.5" />
                            </Button>
                          </>
                        )}
                      {managePay && expense.status === "approved" && (
                        <PaymentPicker
                          title={t("expenses:payment.paidTitle")}
                          confirmLabel={t("expenses:markPaid")}
                          initialMethod={expense.paymentMethod}
                          busy={markExpensePaid.isPending}
                          onConfirm={(payment) =>
                            act(() =>
                              markExpensePaid.mutateAsync({
                                id: expense.id,
                                ...payment,
                              }),
                            )
                          }
                          trigger={
                            <Button variant="outline" size="xs">
                              {t("expenses:markPaid")}
                            </Button>
                          }
                        />
                      )}
                      {expense.userId === user?.id &&
                        expense.status === "pending" && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() =>
                              act(() => cancelExpense.mutateAsync(expense.id))
                            }
                          >
                            {t("myWork:cancel")}
                          </Button>
                        )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ManageCategoriesDialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        workspaceId={workspaceId}
      />
      <AddExpenseDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        workspaceId={workspaceId}
        currency={currency}
      />
    </div>
  );
}
