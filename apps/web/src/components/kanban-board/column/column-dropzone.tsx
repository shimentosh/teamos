import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Plus, SlidersHorizontal } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { ProjectWithTasks } from "@/types/project";
import TaskCard from "../task-card";

type ColumnDropzoneProps = {
  column: ProjectWithTasks["columns"][number];
  disableDragDrop?: boolean;
  onIsOverChange?: (isOver: boolean) => void;
  canCreateTasks?: boolean;
  composer?: ReactNode;
  onQuickAdd?: () => void;
  onAddWithDetails?: () => void;
};

export function ColumnDropzone({
  column,
  disableDragDrop = false,
  onIsOverChange,
  canCreateTasks = false,
  composer,
  onQuickAdd,
  onAddWithDetails,
}: ColumnDropzoneProps) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: {
      type: "column",
      column,
    },
  });

  useEffect(() => {
    onIsOverChange?.(isOver);
  }, [isOver, onIsOverChange]);

  const reduceMotion = useReducedMotion();

  return (
    <div ref={setNodeRef} className="flex flex-1 flex-col gap-2">
      <SortableContext
        items={column.tasks}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-2">
          <AnimatePresence initial={false} mode="popLayout">
            {column.tasks.map((task) => (
              <motion.div
                key={task.id}
                initial={
                  reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }
                }
                animate={
                  reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }
                }
                exit={
                  reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }
                }
                transition={{ type: "spring", duration: 0.35, bounce: 0.15 }}
              >
                <TaskCard task={task} disableDragDrop={disableDragDrop} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </SortableContext>

      {composer}

      {/* The filler stretches over whatever is left of the column below the
          cards, so double-click and right-click only ever hit empty space and
          never compete with a task card's own click handling and context menu. */}
      {canCreateTasks ? (
        <ContextMenu>
          <ContextMenuTrigger
            className="flex min-h-10 flex-1 justify-center pt-6"
            onDoubleClick={() => onQuickAdd?.()}
          >
            {column.tasks.length === 0 && !composer && (
              // pointer-events-none keeps the double-click from selecting the
              // hint's own words instead of opening the composer.
              <p className="pointer-events-none max-w-52 select-none text-balance text-center text-muted-foreground/70 text-xs">
                {t("tasks:kanban.emptyHint")}
              </p>
            )}
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => onQuickAdd?.()}>
              <Plus />
              {t("tasks:kanban.addCard")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onAddWithDetails?.()}>
              <SlidersHorizontal />
              {t("tasks:kanban.addCardWithDetails")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        <div className="min-h-10 flex-1" />
      )}
    </div>
  );
}
