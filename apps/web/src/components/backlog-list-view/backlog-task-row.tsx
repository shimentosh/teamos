import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "@tanstack/react-router";
import { SlidersHorizontal } from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/preview-card";
import { useDeleteTask } from "@/hooks/mutations/task/use-delete-task";
import useGetCustomFieldValuesByProject from "@/hooks/queries/custom-field/use-get-custom-field-values-by-project";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { cn } from "@/lib/cn";
import { isTaskCompleted } from "@/lib/due-date-status";
import { toast } from "@/lib/toast";
import useBacklogBulkSelectionStore from "@/store/backlog-bulk-selection";
import useProjectStore from "@/store/project";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type Task from "@/types/task";
import TaskCardContextMenuContent from "../kanban-board/task-card-context-menu/task-card-context-menu-content";
import { TaskLabels } from "../kanban-board/task-labels";
import {
  AssigneeCell,
  DueChip,
  LIST_GRID,
  PriorityCell,
  StatusCell,
  type StatusOption,
} from "../list-view/cells";
import { AssigneePicker, DueDatePicker } from "../task/inline-pickers";
import { ContextMenu, ContextMenuTrigger } from "../ui/context-menu";

type BacklogTaskRowProps = {
  task: Task;
  /** Planned, archived and the board columns a task can move to. */
  statusOptions: StatusOption[];
  canEdit: boolean;
  /** Off while a filter or search hides rows: positions would scramble. */
  draggable?: boolean;
  onChange: (patch: Partial<Task>) => void;
};

export default function BacklogTaskRow({
  task,
  statusOptions,
  canEdit,
  draggable = true,
  onChange,
}: BacklogTaskRowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: !draggable });

  const { project } = useProjectStore();
  const taskIsCompleted = isTaskCompleted(task.status, project?.columns);
  const { data: workspace } = useActiveWorkspace();
  const {
    showAssignees,
    showPriority,
    showDueDates,
    showLabels,
    showTaskNumbers,
  } = useUserPreferencesStore();
  const [isDeleteTaskModalOpen, setIsDeleteTaskModalOpen] = useState(false);
  const { mutateAsync: deleteTask } = useDeleteTask();
  const { toggleSelection, isSelected, isFocused } =
    useBacklogBulkSelectionStore();
  const isTaskSelected = isSelected(task.id);
  const isTaskFocused = isFocused(task.id);

  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(
    workspace?.id ?? "",
  );

  const assignee = useMemo(() => {
    return workspaceUsers?.members?.find(
      (member) => member.userId === task.userId,
    );
  }, [workspaceUsers, task.userId]);

  const { data: projectCustomFieldValues = [] } =
    useGetCustomFieldValuesByProject(task.projectId);

  const customFieldValues = useMemo(
    () => projectCustomFieldValues.filter((field) => field.taskId === task.id),
    [projectCustomFieldValues, task.id],
  );

  const activeCustomFieldValues = useMemo(
    () =>
      customFieldValues.filter(
        (field) => field.value !== null && field.value !== "",
      ),
    [customFieldValues],
  );

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition || "transform 200ms cubic-bezier(0.23, 1, 0.32, 1)",
    touchAction: isDragging ? "none" : "auto",
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!project || !task) return;
    if (e.defaultPrevented) return;

    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      toggleSelection(task.id);
      return;
    }

    const currentParams = new URLSearchParams(window.location.search);
    const currentTaskId = currentParams.get("taskId");

    if (currentTaskId === task.id) {
      navigate({
        to: ".",
        search: {},
      });
    } else {
      navigate({
        to: ".",
        search: { taskId: task.id },
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleClick(e as unknown as React.MouseEvent);
    }
  };

  const handleDeleteTask = async () => {
    try {
      await deleteTask(task.id);
      toast.success(t("tasks:delete.success"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tasks:delete.error"),
      );
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "border-b border-border/50 transition-colors duration-150",
        isDragging && "opacity-50",
        isTaskSelected &&
          "bg-accent/60 shadow-sm ring-1 ring-inset ring-ring/30",
        isTaskFocused && "ring-2 ring-inset ring-ring/50",
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: false positive for onClick and onKeyDown */}
          <div
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            className={cn(
              LIST_GRID,
              "group relative cursor-pointer px-4 py-2 transition-colors",
              isTaskSelected ? "bg-accent/45" : "hover:bg-accent/50",
            )}
            {...attributes}
            {...listeners}
          >
            <span className="font-mono text-muted-foreground text-xs tabular-nums">
              {showTaskNumbers ? `${project?.slug}-${task.number}` : ""}
            </span>

            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  "truncate font-medium text-foreground text-sm",
                  task.status === "archived" && "text-muted-foreground",
                )}
              >
                {task.title}
              </span>
              {showLabels && (
                <div className="flex shrink-0 items-center gap-1">
                  <TaskLabels labels={task.labels ?? []} />
                </div>
              )}
              {activeCustomFieldValues.length > 0 && (
                <HoverCard openDelay={200} closeDelay={100}>
                  <HoverCardTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded border border-border/70 bg-muted/55 px-2 py-1 text-[10px] font-medium text-muted-foreground cursor-default focus:outline-none focus:ring-2 focus:ring-ring/50 focus:ring-offset-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      aria-label={t("tasks:customFields.ariaLabel", {
                        count: activeCustomFieldValues.length,
                      })}
                    >
                      <SlidersHorizontal className="w-3 h-3" />
                      <span>{activeCustomFieldValues.length}</span>
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent
                    className="w-fit p-2.5"
                    side="bottom"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div className="space-y-1.5">
                      {activeCustomFieldValues.map((field) => (
                        <div
                          key={field.id}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="font-medium text-muted-foreground truncate">
                            {field.fieldName}
                          </span>
                          <span className="text-foreground truncate max-w-24">
                            {field.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </HoverCardContent>
                </HoverCard>
              )}
            </div>

            <div className="min-w-0">
              <StatusCell
                status={task.status}
                columns={statusOptions}
                canEdit={canEdit}
                onPick={(option) => onChange({ status: option.slug })}
              />
            </div>

            <div className="min-w-0">
              {showPriority && (
                <PriorityCell
                  priority={task.priority ?? "no-priority"}
                  canEdit={canEdit}
                  onPick={(priority) => onChange({ priority })}
                />
              )}
            </div>

            <div className="min-w-0">
              {showAssignees && (
                <AssigneePicker
                  workspaceId={workspace?.id ?? ""}
                  value={task.userId ?? null}
                  canEdit={canEdit}
                  onPick={(userId) => onChange({ userId })}
                  trigger={
                    <button
                      type="button"
                      className="-mx-1.5 max-w-full rounded-md px-1.5 py-0.5 text-left hover:bg-accent"
                    >
                      <AssigneeCell
                        assigned={!!task.userId}
                        name={assignee?.user?.name ?? task.assigneeName}
                        image={assignee?.user?.image ?? task.assigneeImage}
                      />
                    </button>
                  }
                />
              )}
            </div>

            <div>
              {showDueDates && (
                <DueDatePicker
                  value={task.dueDate ?? null}
                  canEdit={canEdit}
                  notBefore={task.startDate}
                  onPick={(dueDate) => onChange({ dueDate })}
                  trigger={
                    <button
                      type="button"
                      className="-mx-1 rounded-md px-1 py-0.5 hover:bg-accent"
                    >
                      <DueChip dueDate={task.dueDate} done={taskIsCompleted} />
                    </button>
                  }
                />
              )}
            </div>
          </div>
        </ContextMenuTrigger>

        {project && workspace && (
          <TaskCardContextMenuContent
            task={task}
            taskCardContext={{
              projectId: project.id,
              worskpaceId: workspace.id,
            }}
            onDeleteClick={() => setIsDeleteTaskModalOpen(true)}
          />
        )}
      </ContextMenu>

      <AlertDialog
        open={isDeleteTaskModalOpen}
        onOpenChange={setIsDeleteTaskModalOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tasks:delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("tasks:delete.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteTask}
                />
              }
            >
              {t("tasks:delete.action")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
