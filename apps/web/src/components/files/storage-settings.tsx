import { Link } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useAccountStorage,
  useAccountStorageActions,
  useDisconnectWorkspaceStorage,
  useFileStorage,
} from "@/hooks/files";
import { toast } from "@/lib/toast";

// Your own Cloudflare R2 (or any S3-compatible) bucket. Every workspace you
// own stores new files there. The secret never comes back from the server;
// leaving it empty keeps the saved one.
export function StorageSettings() {
  const { t } = useTranslation();
  const id = useId();
  const { data: storage } = useAccountStorage();
  const { connect, disconnect } = useAccountStorageActions();
  const [form, setForm] = useState({
    endpoint: "",
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
    keyPrefix: "",
  });

  useEffect(() => {
    if (!storage) return;
    setForm({
      endpoint: storage.endpoint ?? "",
      bucket: storage.bucket ?? "",
      accessKeyId: storage.accessKeyId ?? "",
      secretAccessKey: "",
      keyPrefix: storage.keyPrefix ?? "",
    });
  }, [storage]);

  if (!storage) return null;

  const set =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    try {
      await connect.mutateAsync({
        endpoint: form.endpoint.trim(),
        bucket: form.bucket.trim(),
        accessKeyId: form.accessKeyId.trim(),
        secretAccessKey: form.secretAccessKey.trim() || undefined,
        keyPrefix: form.keyPrefix.trim() || undefined,
      });
      toast.success(t("files:storage.connected"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("files:error"));
    }
  };

  const field = (
    key: keyof typeof form,
    label: string,
    placeholder: string,
    secret = false,
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`${id}-${key}`} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={`${id}-${key}`}
        // Not a login form: without these, browsers fill the signed-in
        // email into the access key field next to a password input.
        name={`r2-${key}`}
        type={secret ? "password" : "text"}
        autoComplete={secret ? "new-password" : "off"}
        data-1p-ignore
        data-lpignore="true"
        spellCheck={false}
        value={form[key]}
        onChange={set(key)}
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        {storage.connected ? (
          <Badge variant="success">{t("files:storage.statusConnected")}</Badge>
        ) : (
          <Badge variant="outline">{t("files:storage.statusDatabase")}</Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {storage.connected
            ? t("files:storage.connectedHint", { bucket: storage.bucket })
            : t("files:storage.databaseHint")}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("files:storage.accountScope")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {field(
          "endpoint",
          t("files:storage.endpoint"),
          "https://<account-id>.r2.cloudflarestorage.com",
        )}
        {field("bucket", t("files:storage.bucket"), "company-files")}
        {field("accessKeyId", t("files:storage.accessKey"), "")}
        {field(
          "secretAccessKey",
          t("files:storage.secretKey"),
          storage.connected ? t("files:storage.secretKept") : "",
          true,
        )}
        {field("keyPrefix", t("files:storage.prefix"), "company-os/")}
      </div>
      <p className="text-xs text-muted-foreground">{t("files:storage.help")}</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={connect.isPending}>
          {connect.isPending
            ? t("files:storage.testing")
            : storage.connected
              ? t("files:storage.update")
              : t("files:storage.connect")}
        </Button>
        {storage.connected && (
          <Button
            size="sm"
            variant="outline"
            disabled={disconnect.isPending}
            onClick={() =>
              disconnect
                .mutateAsync()
                .then(() => toast.success(t("files:storage.disconnected")))
                .catch((e) =>
                  toast.error(
                    e instanceof Error ? e.message : t("files:error"),
                  ),
                )
            }
          >
            {t("files:storage.disconnect")}
          </Button>
        )}
      </div>
    </div>
  );
}

// What a workspace's files use now, for its settings page. Storage is set up
// per account; an older workspace bucket can only be removed here.
export function WorkspaceStorageStatus({
  workspaceId,
  canEdit,
}: {
  workspaceId: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const { data: storage } = useFileStorage(workspaceId, canEdit);
  const disconnect = useDisconnectWorkspaceStorage(workspaceId);
  if (!canEdit || !storage) return null;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {storage.connected ? (
          <Badge variant="success">{t("files:storage.statusConnected")}</Badge>
        ) : (
          <Badge variant="outline">{t("files:storage.statusDatabase")}</Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {storage.source === "account"
            ? t("files:storage.usingOwner", {
                name: storage.ownerName ?? "",
                bucket: storage.bucket,
              })
            : storage.source === "workspace"
              ? t("files:storage.usingLegacy", { bucket: storage.bucket })
              : t("files:storage.databaseHint")}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("files:storage.managedInAccount")}{" "}
        <Link
          to="/dashboard/settings/account/storage"
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          {t("files:storage.openAccount")}
        </Link>
      </p>
      {storage.source === "workspace" && (
        <Button
          size="sm"
          variant="outline"
          disabled={disconnect.isPending}
          onClick={() =>
            disconnect
              .mutateAsync()
              .then(() => toast.success(t("files:storage.disconnected")))
              .catch((e) =>
                toast.error(e instanceof Error ? e.message : t("files:error")),
              )
          }
        >
          {t("files:storage.disconnectLegacy")}
        </Button>
      )}
    </div>
  );
}
