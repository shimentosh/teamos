import { Timer } from "lucide-react";
import { useTranslation } from "react-i18next";

const IN_PROGRESS = "in-progress";

/**
 * A small timer icon beside In Progress in status menus: moving a task there
 * starts your timer (see apps/api/src/time-entry/auto-timer.ts). Icon only,
 * with the explanation in its tooltip, so menus stay compact.
 */
export function TimerHint({ slug }: { slug: string; current?: string }) {
  const { t } = useTranslation();
  if (slug !== IN_PROGRESS) return null;
  const label = t("time:auto.startsTimer");
  return (
    <span
      className="ms-auto flex shrink-0 text-muted-foreground/70"
      title={label}
      aria-label={label}
      role="img"
    >
      <Timer className="size-3" />
    </span>
  );
}
