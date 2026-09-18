import { Link2 } from "lucide-react";
import { cn } from "@/lib/cn";

/** Only http(s) references become links; anything else stays plain text. */
export function safeReferenceUrl(reference: string) {
  try {
    const url = new URL(reference);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function shortLabel(url: string) {
  try {
    const { hostname, pathname } = new URL(url);
    const path = pathname.length > 1 ? pathname : "";
    return `${hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}

/** A time entry's reference: a link (PR, doc…) or a ticket like "JIRA-12". */
export function TimeReference({
  reference,
  className,
}: {
  reference: string;
  className?: string;
}) {
  const href = safeReferenceUrl(reference);
  const body = (
    <>
      <Link2 className="size-3 shrink-0" />
      <span className="truncate">{href ? shortLabel(href) : reference}</span>
    </>
  );
  const classes = cn(
    "inline-flex max-w-full items-center gap-1 text-[11px] text-muted-foreground",
    className,
  );
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={href}
      className={cn(classes, "hover:text-foreground hover:underline")}
    >
      {body}
    </a>
  ) : (
    <span className={classes} title={reference}>
      {body}
    </span>
  );
}
