import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type TimeNote = { note: string; reference: string };

/**
 * "What did you work on?" plus an optional reference (a link or ticket).
 * Ctrl/⌘ + Enter submits from either field.
 */
export function TimeNoteFields({
  value,
  onChange,
  onSubmit,
}: {
  value: TimeNote;
  onChange: (value: TimeNote) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const submitOnShortcut = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
    }
  };
  return (
    <div className="space-y-2">
      <Textarea
        autoFocus
        rows={3}
        maxLength={1000}
        value={value.note}
        onChange={(e) => onChange({ ...value, note: e.target.value })}
        placeholder={t("time:task.whatDidYouDoPlaceholder")}
        aria-label={t("time:task.whatDidYouDo")}
        onKeyDown={submitOnShortcut}
      />
      <Input
        size="sm"
        maxLength={500}
        value={value.reference}
        onChange={(e) => onChange({ ...value, reference: e.target.value })}
        placeholder={t("time:note.referencePlaceholder")}
        aria-label={t("time:note.reference")}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
    </div>
  );
}
