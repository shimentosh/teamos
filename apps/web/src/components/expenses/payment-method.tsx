import {
  Banknote,
  CircleDollarSign,
  Coins,
  CreditCard,
  Landmark,
  Smartphone,
  Wallet,
} from "lucide-react";
import { type ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import type { PaymentDetails, PaymentMethod } from "@/fetchers/requests";
import { cn } from "@/lib/cn";

// Brand-ish colours, so a glance at the list tells bKash from USDT.
const METHODS: {
  id: PaymentMethod;
  icon: typeof Landmark;
  tone: string;
}[] = [
  {
    id: "bank",
    icon: Landmark,
    tone: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  },
  {
    id: "cash",
    icon: Banknote,
    tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  {
    id: "bkash",
    icon: Smartphone,
    tone: "bg-pink-500/10 text-pink-700 dark:text-pink-300",
  },
  {
    id: "nagad",
    icon: Smartphone,
    tone: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  {
    id: "paypal",
    icon: Wallet,
    tone: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  {
    id: "usdt",
    icon: Coins,
    tone: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
  },
  {
    id: "card",
    icon: CreditCard,
    tone: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  {
    id: "other",
    icon: CircleDollarSign,
    tone: "bg-muted text-muted-foreground",
  },
];

function methodOf(id: string | null | undefined) {
  return METHODS.find((m) => m.id === id);
}

/** A small coloured badge: how this expense was (or will be) paid. */
export function PaymentMethodBadge({
  method,
  reference,
}: {
  method: string | null | undefined;
  reference?: string | null;
}) {
  const { t } = useTranslation();
  const found = methodOf(method);
  if (!found) return null;
  const Icon = found.icon;
  return (
    <span
      title={reference ?? undefined}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        found.tone,
      )}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">
        {t(`expenses:payment.methods.${found.id}`)}
      </span>
    </span>
  );
}

/**
 * Wraps an action button (Approve, Mark paid): clicking it asks how the money
 * goes back to the person, then confirms with that recorded.
 */
export function PaymentPicker({
  trigger,
  title,
  confirmLabel,
  initialMethod,
  busy,
  onConfirm,
}: {
  trigger: ReactElement;
  title: string;
  confirmLabel: string;
  initialMethod?: string | null;
  busy: boolean;
  onConfirm: (payment: PaymentDetails) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod | null>(
    methodOf(initialMethod)?.id ?? null,
  );
  const [reference, setReference] = useState("");

  const confirm = async () => {
    await onConfirm({
      paymentMethod: method ?? undefined,
      paymentReference: reference.trim() || undefined,
    });
    setOpen(false);
    setReference("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverPopup align="end" className="w-80">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-xs text-muted-foreground">
              {t("expenses:payment.hint")}
            </p>
          </div>
          <fieldset
            aria-label={t("expenses:payment.method")}
            className="m-0 grid grid-cols-4 gap-1.5 border-0 p-0"
          >
            {METHODS.map((m) => {
              const Icon = m.icon;
              const selected = method === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setMethod(selected ? null : m.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] font-medium transition-colors",
                    selected
                      ? cn("border-transparent ring-2 ring-primary", m.tone)
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {t(`expenses:payment.methods.${m.id}`)}
                </button>
              );
            })}
          </fieldset>
          {method && (
            <Input
              autoFocus
              value={reference}
              maxLength={200}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t(`expenses:payment.referenceFor.${method}`)}
              aria-label={t("expenses:payment.reference")}
              className="h-8 text-sm"
            />
          )}
          <div className="flex justify-end">
            <Button type="submit" size="xs" disabled={busy}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </PopoverPopup>
    </Popover>
  );
}
