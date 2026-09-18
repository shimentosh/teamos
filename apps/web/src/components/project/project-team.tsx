import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  addProjectMember,
  getProjectMembers,
  removeProjectMember,
} from "@/fetchers/project/project-members";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";

type Person = { id: string; name: string; image?: string | null };

function Face({ person, className }: { person: Person; className?: string }) {
  return (
    <Avatar title={person.name} className={className}>
      <AvatarImage src={person.image ?? ""} alt={person.name} />
      <AvatarFallback className="bg-muted text-[9px] font-semibold">
        {getInitials(person.name)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * A project's team as overlapping faces; opens to add or remove people.
 * The team is who the project is worked with. It shows them the project,
 * not every task in it; that still depends on their role.
 */
export function ProjectTeam({
  workspaceId,
  projectId,
  memberIds,
  assigneeIds,
}: {
  workspaceId: string;
  projectId: string;
  memberIds: string[];
  assigneeIds: string[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { canUpdateProjects } = useWorkspacePermission();
  const canManage = Boolean(canUpdateProjects());
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: users } = useGetActiveWorkspaceUsers(workspaceId);

  const byId = useMemo(
    () =>
      new Map(
        (users?.members ?? []).map(
          (m) =>
            [
              m.userId,
              { id: m.userId, name: m.user.name ?? "", image: m.user.image },
            ] as const,
        ),
      ),
    [users],
  );

  // The team first, then anyone else with open tasks here.
  const faces = useMemo(
    () =>
      [...new Set([...memberIds, ...assigneeIds])].flatMap((id) => {
        const person = byId.get(id);
        return person ? [person] : [];
      }),
    [memberIds, assigneeIds, byId],
  );

  const { data: members = [] } = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => getProjectMembers(projectId),
    enabled: open,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["project-members", projectId] });
    queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
  };
  const fail = (error: Error) =>
    toast.error(error.message || t("workspace:projects.team.error"));
  const add = useMutation({
    mutationFn: (userId: string) => addProjectMember(projectId, userId),
    onSuccess: refresh,
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => removeProjectMember(projectId, userId),
    onSuccess: refresh,
    onError: fail,
  });

  const onTeam = new Set(members.map((m) => m.userId));
  const query = search.trim().toLowerCase();
  const candidates = [...byId.values()].filter(
    (p) =>
      !onTeam.has(p.id) && (!query || p.name.toLowerCase().includes(query)),
  );

  return (
    // The row navigates and drags; keep clicks here from doing either.
    // biome-ignore lint/a11y/noStaticElementInteractions: only stops propagation
    <span
      role="presentation"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch("");
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={t("workspace:projects.team.title")}
              className="flex items-center rounded-full p-0.5 hover:bg-accent/60"
            />
          }
        >
          {faces.length === 0 ? (
            <span className="flex size-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground">
              <Plus className="size-3" />
            </span>
          ) : (
            <span className="flex items-center">
              <span className="flex -space-x-1.5">
                {faces.slice(0, 4).map((p) => (
                  <Face
                    key={p.id}
                    person={p}
                    className="size-6 ring-2 ring-background"
                  />
                ))}
              </span>
              {faces.length > 4 && (
                <span className="ms-1.5 text-xs text-muted-foreground">
                  +{faces.length - 4}
                </span>
              )}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-3 p-3" align="start">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {t("workspace:projects.team.title")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("workspace:projects.team.hint")}
            </p>
          </div>

          {members.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("workspace:projects.team.empty")}
            </p>
          ) : (
            <ul className="space-y-1">
              {members.map((m) => (
                <li key={m.userId} className="flex items-center gap-2">
                  <Face
                    person={{ id: m.userId, name: m.name, image: m.image }}
                    className="size-6"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {m.name}
                  </span>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("workspace:projects.team.remove", {
                        name: m.name,
                      })}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(m.userId)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canManage && (
            <div className="space-y-1.5 border-t border-border pt-3">
              <Input
                size="sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("workspace:projects.team.addPlaceholder")}
                aria-label={t("workspace:projects.team.addPlaceholder")}
              />
              <ul className="max-h-40 space-y-0.5 overflow-y-auto">
                {candidates.slice(0, 20).map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={add.isPending}
                      onClick={() => add.mutate(p.id)}
                      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-start text-sm hover:bg-accent"
                    >
                      <Face person={p} className="size-5" />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <Plus className="size-3.5 text-muted-foreground" />
                    </button>
                  </li>
                ))}
                {candidates.length === 0 && (
                  <li className="px-1.5 py-1 text-xs text-muted-foreground">
                    {t("workspace:projects.team.noOneLeft")}
                  </li>
                )}
              </ul>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </span>
  );
}
