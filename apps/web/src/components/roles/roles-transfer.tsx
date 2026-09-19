import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type InstanceRole,
  useInstanceRoleActions,
} from "@/hooks/queries/use-instance-roles";
import { cn } from "@/lib/cn";
import {
  buildRolesFile,
  type ImportPlanItem,
  planRolesImport,
  RolesFileError,
} from "@/lib/role-transfer";
import { toast } from "@/lib/toast";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Export the instance's roles to a file, or import roles from one. */
export function RolesTransfer({
  instanceName,
  roles,
}: {
  instanceName?: string;
  roles: InstanceRole[];
}) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlanItem[] | null>(null);
  const [importing, setImporting] = useState(false);
  const { create, update } = useInstanceRoleActions();

  const exportRoles = () => {
    const file = buildRolesFile(roles, instanceName);
    const blob = new Blob([`${JSON.stringify(file, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugify(instanceName ?? "") || "teamos"}-roles.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPlan(planRolesImport(await file.text(), roles));
    } catch (error) {
      toast.error(
        error instanceof RolesFileError
          ? t(`settings:workspaceRoles.transfer.errors.${error.message}`)
          : t("settings:workspaceRoles.transfer.errors.notJson"),
      );
    }
  };

  const changes = plan?.filter((item) => item.action !== "unchanged") ?? [];

  const runImport = async () => {
    setImporting(true);
    let done = 0;
    const failed: string[] = [];
    // One at a time through the normal role endpoints, so the API validates
    // each one and the mirror is rebuilt after every change.
    for (const item of changes) {
      try {
        if (item.action === "create") {
          await create.mutateAsync({
            role: item.name,
            permission: item.permissions,
          });
        } else {
          await update.mutateAsync({
            role: item.name,
            permission: item.permissions,
          });
        }
        done += 1;
      } catch (error) {
        failed.push(
          `${item.name}: ${error instanceof Error ? error.message : ""}`,
        );
      }
    }
    setImporting(false);
    setPlan(null);
    if (done > 0) {
      toast.success(
        t("settings:workspaceRoles.transfer.imported", { count: done }),
      );
    }
    if (failed.length > 0) {
      toast.error(t("settings:workspaceRoles.transfer.someFailed"), {
        description: failed.join("\n"),
      });
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={exportRoles}
        disabled={roles.length === 0}
      >
        <Download className="size-3.5" />
        {t("settings:workspaceRoles.transfer.export")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => fileInput.current?.click()}
      >
        <Upload className="size-3.5" />
        {t("settings:workspaceRoles.transfer.import")}
      </Button>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          void readFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <Dialog
        open={!!plan}
        onOpenChange={(open) => !open && !importing && setPlan(null)}
      >
        <DialogPopup className="w-full max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("settings:workspaceRoles.transfer.previewTitle")}
            </DialogTitle>
            <DialogDescription>
              {changes.length > 0
                ? t("settings:workspaceRoles.transfer.previewHint")
                : t("settings:workspaceRoles.transfer.nothingToDo")}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <ul className="divide-y divide-border rounded-md border border-border">
              {plan?.map((item) => (
                <li key={item.name} className="space-y-0.5 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium capitalize">
                      {item.name}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                        item.action === "create" &&
                          "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                        item.action === "update" &&
                          "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                        item.action === "unchanged" &&
                          "bg-muted text-muted-foreground",
                      )}
                    >
                      {t(
                        `settings:workspaceRoles.transfer.actions.${item.action}`,
                      )}
                    </span>
                  </div>
                  {item.dropped.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      {t("settings:workspaceRoles.transfer.dropped", {
                        list: item.dropped.join(", "),
                      })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPlan(null)}
              disabled={importing}
            >
              {t("settings:workspaceRoles.transfer.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => void runImport()}
              disabled={importing || changes.length === 0}
            >
              {t("settings:workspaceRoles.transfer.apply", {
                count: changes.length,
              })}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
