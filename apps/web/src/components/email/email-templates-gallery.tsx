import {
  BellOff,
  CalendarDays,
  CheckSquare,
  type LucideIcon,
  MessageSquare,
  Search,
  Send,
  ShieldCheck,
  Sunrise,
  Users,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import type { EmailTemplate } from "@/fetchers/instance-email";
import {
  useEmailPreview,
  useEmailTemplates,
  useSendTestEmail,
} from "@/hooks/queries/use-instance-email";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";

type Section = EmailTemplate["section"];

const SECTION_ORDER: Section[] = [
  "account",
  "team",
  "tasks",
  "nudges",
  "chat",
  "leave",
  "money",
];

const SECTION_ICON: Record<Section, LucideIcon> = {
  account: ShieldCheck,
  team: Users,
  tasks: CheckSquare,
  nudges: Sunrise,
  chat: MessageSquare,
  leave: CalendarDays,
  money: Wallet,
};

// Who receives it, as a coloured chip: the same colour everywhere.
const AUDIENCE_TONE: Record<EmailTemplate["audience"], string> = {
  person: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  approvers: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  admins: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  owner: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  invitee: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

function Preview({
  template,
  onClose,
}: {
  template: EmailTemplate | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: preview, isLoading } = useEmailPreview(template?.type ?? null);
  const sendTest = useSendTestEmail();
  return (
    <Sheet open={!!template} onOpenChange={(open) => !open && onClose()}>
      <SheetPopup side="right" className="w-full sm:max-w-2xl">
        {template && (
          <>
            <SheetHeader>
              <SheetTitle>
                {t(`emailTemplates:types.${template.type}.name`)}
              </SheetTitle>
              <SheetDescription>
                {t(`emailTemplates:types.${template.type}.when`)}
              </SheetDescription>
            </SheetHeader>
            <SheetPanel className="space-y-3">
              <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                <dt className="text-muted-foreground">
                  {t("emailTemplates:to")}
                </dt>
                <dd>{t(`emailTemplates:types.${template.type}.who`)}</dd>
                <dt className="text-muted-foreground">
                  {t("emailTemplates:subject")}
                </dt>
                <dd className="font-medium">
                  {preview?.subject ?? template.subject}
                </dd>
                <dt className="text-muted-foreground">
                  {t("emailTemplates:control")}
                </dt>
                <dd>
                  {template.switchKey
                    ? t("emailTemplates:canTurnOff", {
                        name: t(
                          `settings:notificationsPage.events.${template.switchKey}.title`,
                        ),
                      })
                    : t("emailTemplates:alwaysSent")}
                </dd>
              </dl>
              <div className="overflow-hidden rounded-lg border border-border bg-white">
                {isLoading || !preview ? (
                  <div className="h-136 animate-pulse bg-muted/40" />
                ) : (
                  // Sandboxed: the preview can't run scripts or reach the app.
                  <iframe
                    title={preview.subject}
                    sandbox=""
                    srcDoc={preview.html}
                    className="h-136 w-full"
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs">
                  {t("emailTemplates:sampleNote")}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  disabled={sendTest.isPending}
                  onClick={() =>
                    sendTest
                      .mutateAsync(template.type)
                      .then(({ to }) =>
                        toast.success(t("emailTemplates:testSent", { to })),
                      )
                      .catch((error) =>
                        toast.error(
                          error instanceof Error
                            ? error.message
                            : t("emailTemplates:testFailed"),
                        ),
                      )
                  }
                >
                  <Send className="size-3.5" />
                  {t("emailTemplates:sendTest")}
                </Button>
              </div>
            </SheetPanel>
          </>
        )}
      </SheetPopup>
    </Sheet>
  );
}

/**
 * Every email TeamOS sends, as cards: what it is, when it goes out and who
 * receives it. Opening one shows it with sample data. Nothing is sent.
 */
export function EmailTemplatesGallery() {
  const { t } = useTranslation();
  const { data: templates = [] } = useEmailTemplates(true);
  const [section, setSection] = useState<Section | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<EmailTemplate | null>(null);

  const text = (template: EmailTemplate) =>
    [
      t(`emailTemplates:types.${template.type}.name`),
      t(`emailTemplates:types.${template.type}.when`),
      t(`emailTemplates:types.${template.type}.who`),
      template.subject,
    ]
      .join(" ")
      .toLowerCase();

  // Thirty-odd cards: filtering on every render is cheap.
  const needle = query.trim().toLowerCase();
  const shown = templates.filter(
    (template) =>
      (!section || template.section === section) &&
      (!needle || text(template).includes(needle)),
  );

  const counts = useMemo(() => {
    const byKey = new Map<Section, number>();
    for (const template of templates) {
      byKey.set(template.section, (byKey.get(template.section) ?? 0) + 1);
    }
    return byKey;
  }, [templates]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label={t("emailTemplates:sections.label")}
          className="flex flex-wrap items-center gap-1 rounded-lg bg-muted/50 p-1"
        >
          {[null, ...SECTION_ORDER].map((key) => {
            const Icon = key ? SECTION_ICON[key] : null;
            return (
              <button
                key={key ?? "all"}
                type="button"
                role="tab"
                aria-selected={section === key}
                onClick={() => setSection(key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
                  section === key
                    ? "bg-background font-medium text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {Icon && <Icon className="size-3.5" />}
                {key
                  ? t(`emailTemplates:sections.${key}`)
                  : t("emailTemplates:sections.all")}
                <span className="rounded bg-muted px-1 tabular-nums text-muted-foreground">
                  {key ? (counts.get(key) ?? 0) : templates.length}
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative ms-auto w-full sm:w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            size="sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("emailTemplates:search")}
            aria-label={t("emailTemplates:search")}
            className="pl-7"
          />
        </div>
      </div>

      {SECTION_ORDER.filter((key) =>
        shown.some((template) => template.section === key),
      ).map((key) => {
        const Icon = SECTION_ICON[key];
        return (
          <section key={key} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h3 className="flex items-center gap-1.5 font-medium text-sm">
                <Icon className="size-4 text-muted-foreground" />
                {t(`emailTemplates:sections.${key}`)}
              </h3>
              <p className="text-muted-foreground text-xs">
                {t(`emailTemplates:sectionHints.${key}`)}
              </p>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {shown
                .filter((template) => template.section === key)
                .map((template) => (
                  <li key={template.type}>
                    <button
                      type="button"
                      onClick={() => setOpen(template)}
                      className="flex h-full w-full flex-col gap-2 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
                    >
                      <span className="font-medium text-sm">
                        {t(`emailTemplates:types.${template.type}.name`)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {t(`emailTemplates:types.${template.type}.when`)}
                      </span>
                      <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                        <span
                          className={cn(
                            "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                            AUDIENCE_TONE[template.audience],
                          )}
                        >
                          {t(`emailTemplates:types.${template.type}.who`)}
                        </span>
                        {!template.switchKey && (
                          <span
                            className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                            title={t("emailTemplates:alwaysSent")}
                          >
                            <BellOff className="size-3" />
                            {t("emailTemplates:always")}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        );
      })}

      {shown.length === 0 && (
        <p className="py-10 text-center text-muted-foreground text-sm">
          {t("emailTemplates:noMatch")}
        </p>
      )}

      <Preview template={open} onClose={() => setOpen(null)} />
    </div>
  );
}
