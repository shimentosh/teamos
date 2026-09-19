import { Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import CreateTaskModal from "@/components/shared/modals/create-task-modal";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import useProjectStore from "@/store/project";
import type { ProjectWithTasks } from "@/types/project";
import { AddCardComposer } from "./add-card-composer";
import { ColumnDropzone } from "./column-dropzone";
import { ColumnHeader } from "./column-header";

type ColumnProps = {
  column: ProjectWithTasks["columns"][number];
  disableDragDrop?: boolean;
};

function Column({ column, disableDragDrop = false }: ColumnProps) {
  const { t } = useTranslation();
  const { project } = useProjectStore();
  const { canCreateTasks } = useWorkspacePermission();
  const canCreate = canCreateTasks();
  const [isDropzoneOver, setIsDropzoneOver] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);

  const openComposer = useCallback(() => {
    if (!canCreate) return;
    setIsComposerOpen(true);
  }, [canCreate]);

  const openTaskModal = useCallback(() => {
    if (!canCreate) return;
    setIsComposerOpen(false);
    setIsTaskModalOpen(true);
  }, [canCreate]);

  return (
    <div
      className={`group relative flex h-full min-h-0 w-full flex-col rounded-xl border transition-colors duration-150 ${
        isDropzoneOver
          ? "border-ring/40 bg-accent/60 shadow-md ring-2 ring-ring/30"
          : "border-border/70 bg-muted/40 shadow-xs/5 hover:border-border/90 dark:bg-card/90"
      }`}
    >
      <div className="shrink-0 border-b border-border/60 px-3 py-2">
        <ColumnHeader column={column} onAddTask={openTaskModal} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-2 py-1 [-webkit-overflow-scrolling:touch]">
        <ColumnDropzone
          column={column}
          disableDragDrop={disableDragDrop}
          onIsOverChange={setIsDropzoneOver}
          canCreateTasks={canCreate}
          onQuickAdd={openComposer}
          onAddWithDetails={openTaskModal}
          composer={
            isComposerOpen && project?.id ? (
              <AddCardComposer
                projectId={project.id}
                status={column.id}
                onClose={() => setIsComposerOpen(false)}
              />
            ) : null
          }
        />
      </div>
      {canCreate && !isComposerOpen && (
        <button
          type="button"
          onClick={openComposer}
          className="flex shrink-0 items-center gap-1.5 rounded-b-xl px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          {t("tasks:kanban.addCard")}
        </button>
      )}

      <CreateTaskModal
        open={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        projectId={project?.id}
        status={column.id}
      />
    </div>
  );
}

export default Column;
