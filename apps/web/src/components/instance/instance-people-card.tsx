import { INSTANCE_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "@kaneo/permissions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/toast";

const MEMBER_ROLE = "user";
const TIERS = [SUPER_ADMIN_ROLE, INSTANCE_ADMIN_ROLE, MEMBER_ROLE] as const;

type InstanceUser = {
  id: string;
  name: string;
  email: string;
  role?: string | null;
};

// Everyone on the server and the tier they hold. Tiers sit above workspace
// membership: both admin tiers can create workspaces and bypass workspace
// permission checks, and only a super-admin can change them. The API enforces
// all of that; this page is the way to reach it.
export function InstancePeopleCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["instance-people"],
    queryFn: async (): Promise<InstanceUser[]> => {
      const { data, error } = await authClient.admin.listUsers({
        query: { limit: 200, sortBy: "createdAt", sortDirection: "asc" },
      });
      if (error) throw new Error(error.message ?? "Failed to load users");
      return (data?.users ?? []) as InstanceUser[];
    },
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const { error } = await authClient.admin.setRole({
        userId,
        role: role as "user",
      });
      if (error) throw new Error(error.message ?? "Failed to set role");
    },
    onSuccess: () => {
      toast.success(t("instancePeople:saved"));
      queryClient.invalidateQueries({ queryKey: ["instance-people"] });
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : t("instancePeople:error"),
      ),
  });

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 font-medium">
          <ShieldCheck className="size-4 text-muted-foreground" />
          {t("instancePeople:title")}
          <Badge variant="outline" size="sm">
            {t("registrationSetup:instanceAdmin")}
          </Badge>
        </h2>
        <p className="text-muted-foreground text-xs">
          {t("instancePeople:subtitle")}
        </p>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">
          {t("instancePeople:loading")}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("instancePeople:columns.person")}</TableHead>
              <TableHead className="w-44">
                {t("instancePeople:columns.tier")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const tier = user.role ?? MEMBER_ROLE;
              // A super-admin who demotes themselves would leave the instance
              // with nobody able to hand out tiers, so the API refuses it.
              const isSelf = user.id === session?.user?.id;
              return (
                <TableRow key={user.id}>
                  <TableCell className="py-3">
                    <div className="font-medium text-sm">{user.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {user.email}
                    </div>
                  </TableCell>
                  <TableCell>
                    {isSelf ? (
                      <Badge variant="secondary">
                        {t(`instancePeople:tiers.${tier}`, {
                          defaultValue: tier,
                        })}
                      </Badge>
                    ) : (
                      <Select
                        value={tier}
                        onValueChange={(value) => {
                          if (typeof value === "string" && value !== tier) {
                            setRole.mutate({ userId: user.id, role: value });
                          }
                        }}
                      >
                        <SelectTrigger size="sm" className="h-8 w-40">
                          <SelectValue>
                            {t(`instancePeople:tiers.${tier}`, {
                              defaultValue: tier,
                            })}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {TIERS.map((value) => (
                            <SelectItem key={value} value={value}>
                              {t(`instancePeople:tiers.${value}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
