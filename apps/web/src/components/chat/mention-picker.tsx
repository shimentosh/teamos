import { FolderKanban, SquareCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import usePeople from "@/hooks/queries/people/use-people";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGlobalSearch from "@/hooks/queries/search/use-global-search";
import type { Mention } from "@/lib/chat-mentions";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/get-initials";
import resolveAvatarSrc from "@/lib/resolve-avatar-src";

type Option = Mention & { key: string; hint?: string; image?: string | null };

const PER_GROUP = 5;

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** People, projects and tasks matching `query`, grouped in that order. */
export function useMentionOptions(workspaceId: string, query: string | null) {
  const open = query !== null;
  const needle = (query ?? "").toLowerCase();
  const { data: people = [] } = usePeople(open ? workspaceId : undefined);
  const { data: projects = [] } = useGetProjects({
    workspaceId: open ? workspaceId : "",
  });
  const searchFor = useDebounced(needle, 150);
  const { data: search } = useGlobalSearch({
    q: open ? searchFor : "",
    type: "tasks",
    workspaceId,
    limit: PER_GROUP,
  });

  return useMemo<Option[]>(() => {
    if (!open) return [];
    const matches = (value: string) => value.toLowerCase().includes(needle);
    const users: Option[] = people
      .filter((p) => matches(p.name))
      .slice(0, PER_GROUP)
      .map((p) => ({
        key: `user:${p.userId}`,
        kind: "user",
        id: p.userId,
        label: p.name,
        hint: p.title ?? undefined,
        image: p.image,
      }));
    const projectOptions: Option[] = (projects ?? [])
      .filter((p) => matches(p.name) || matches(p.slug))
      .slice(0, PER_GROUP)
      .map((p) => ({
        key: `project:${p.id}`,
        kind: "project",
        id: p.id,
        label: p.name,
        hint: p.slug,
      }));
    const tasks: Option[] = needle
      ? (search?.results ?? [])
          .filter((r) => r.type === "task" && r.projectId)
          .map((r) => {
            const ref =
              r.projectSlug && r.taskNumber
                ? `${r.projectSlug}-${r.taskNumber}`
                : "";
            return {
              key: `task:${r.id}`,
              kind: "task" as const,
              id: r.id,
              projectId: r.projectId,
              label: `${ref} ${r.title}`.trim().slice(0, 80),
              hint: r.projectName,
            };
          })
      : [];
    return [...users, ...projectOptions, ...tasks];
  }, [open, needle, people, projects, search]);
}

export function MentionPicker({
  options,
  activeIndex,
  onPick,
  onHover,
  query,
}: {
  options: Option[];
  activeIndex: number;
  onPick: (option: Mention) => void;
  onHover: (index: number) => void;
  query: string;
}) {
  const { t } = useTranslation();
  const groups: { kind: Mention["kind"]; title: string }[] = [
    { kind: "user", title: t("chat:mentions.people") },
    { kind: "project", title: t("chat:mentions.projects") },
    { kind: "task", title: t("chat:mentions.tasks") },
  ];

  return (
    <div
      className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-80 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg"
      // Keep focus in the textarea while clicking an option.
      onMouseDown={(e) => e.preventDefault()}
      role="listbox"
      aria-label={t("chat:mentions.label")}
    >
      {options.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {query ? t("chat:mentions.none") : t("chat:mentions.hint")}
        </p>
      ) : (
        groups.map(({ kind, title }) => {
          const items = options
            .map((option, index) => ({ option, index }))
            .filter(({ option }) => option.kind === kind);
          if (items.length === 0) return null;
          return (
            <div key={kind} className="py-0.5">
              <p className="px-2 pt-1 pb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                {title}
              </p>
              {items.map(({ option, index }) => (
                <button
                  key={option.key}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => onHover(index)}
                  onClick={() => onPick(option)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    index === activeIndex && "bg-accent",
                  )}
                >
                  {option.kind === "user" ? (
                    <Avatar className="size-5">
                      <AvatarImage
                        src={resolveAvatarSrc(option.image ?? undefined)}
                        alt=""
                      />
                      <AvatarFallback className="text-[9px]">
                        {getInitials(option.label)}
                      </AvatarFallback>
                    </Avatar>
                  ) : option.kind === "project" ? (
                    <FolderKanban className="size-4 text-muted-foreground" />
                  ) : (
                    <SquareCheck className="size-4 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                  </span>
                  {option.hint && (
                    <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  )}
                </button>
              ))}
            </div>
          );
        })
      )}
      {!query && options.length > 0 && (
        <p className="px-2 pt-1 pb-0.5 text-[10px] text-muted-foreground">
          {t("chat:mentions.typeForTasks")}
        </p>
      )}
    </div>
  );
}
