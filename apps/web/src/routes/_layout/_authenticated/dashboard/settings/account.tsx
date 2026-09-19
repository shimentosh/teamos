import { isInstanceAdminRole, isSuperAdminRole } from "@kaneo/permissions";
import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import {
  Bell,
  Bot,
  Code,
  HardDrive,
  Mail,
  Monitor,
  Settings,
  Shield,
  ShieldCheck,
  User,
  UserPlus,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import SettingsSidebar from "@/components/SettingsSidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/get-initials";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();
  const isActivePath = (path: string) => location.pathname === path;
  // Server-wide settings belong to the instance admins (super-admin and
  // admin). Everyone else never sees the group; the API refuses them either
  // way.
  const { data: session } = authClient.useSession();
  const isInstanceAdmin = isInstanceAdminRole(session?.user?.role);
  // Only the super-admin hands out instance tiers.
  const isSuperAdmin = isSuperAdminRole(session?.user?.role);
  const menuItems = [
    {
      title: t("settings:information"),
      url: "/dashboard/settings/account/information",
      icon: User,
    },
    {
      title: t("settings:notifications"),
      url: "/dashboard/settings/account/notifications",
      icon: Bell,
    },
    {
      title: t("emailLog:title"),
      url: "/dashboard/settings/account/email",
      icon: Mail,
    },
    {
      title: t("settings:preferences"),
      url: "/dashboard/settings/account/preferences",
      icon: Settings,
    },
    {
      title: t("devices:title"),
      url: "/dashboard/settings/account/devices",
      icon: Monitor,
    },
    {
      title: t("files:storage.title"),
      url: "/dashboard/settings/account/storage",
      icon: HardDrive,
    },
    {
      title: t("ai:title"),
      url: "/dashboard/settings/account/ai",
      icon: Bot,
    },
  ];

  return (
    <div className="flex gap-6 h-full">
      <SettingsSidebar>
        <div className="p-2">
          <div className="mb-1 flex items-center gap-3 rounded-md px-2 py-2">
            <Avatar className="h-9 w-9">
              <AvatarImage src={user?.image ?? ""} alt={user?.name || ""} />
              <AvatarFallback className="text-xs font-medium border border-border/30">
                {getInitials(user?.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col md:min-w-fit">
              <p className="truncate text-sm md:overflow-visible md:text-clip md:whitespace-normal">
                {user?.name}
              </p>
              <p className="truncate text-xs text-sidebar-foreground/70 md:overflow-visible md:text-clip md:whitespace-normal">
                {user?.email}
              </p>
            </div>
          </div>

          <SidebarGroup className="gap-1 p-1">
            <SidebarGroupLabel className="h-7 px-2 text-xs uppercase tracking-wide text-sidebar-foreground/70">
              {t("settings:account")}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {menuItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <Button
                      render={<Link to={item.url} />}
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-8 w-full justify-start gap-2 rounded-lg px-2 text-sm font-normal text-sidebar-foreground/80",
                        isActivePath(item.url) &&
                          "bg-sidebar-accent text-sidebar-accent-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Button>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {isInstanceAdmin && (
            <SidebarGroup className="gap-1 p-1">
              <SidebarGroupLabel className="h-7 px-2 text-xs uppercase tracking-wide text-sidebar-foreground/70">
                {t("settings:instance")}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {isSuperAdmin && (
                    <SidebarMenuItem>
                      <Button
                        render={
                          <Link to="/dashboard/settings/account/people" />
                        }
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-8 w-full justify-start gap-2 rounded-lg px-2 text-sm font-normal text-sidebar-foreground/80",
                          isActivePath("/dashboard/settings/account/people") &&
                            "bg-sidebar-accent text-sidebar-accent-foreground",
                        )}
                      >
                        <ShieldCheck className="h-4 w-4" />
                        <span>{t("instancePeople:navTitle")}</span>
                      </Button>
                    </SidebarMenuItem>
                  )}
                  <SidebarMenuItem>
                    <Button
                      render={<Link to="/dashboard/settings/account/roles" />}
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-8 w-full justify-start gap-2 rounded-lg px-2 text-sm font-normal text-sidebar-foreground/80",
                        isActivePath("/dashboard/settings/account/roles") &&
                          "bg-sidebar-accent text-sidebar-accent-foreground",
                      )}
                    >
                      <Shield className="h-4 w-4" />
                      <span>{t("settings:workspaceRoles.title")}</span>
                    </Button>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <Button
                      render={
                        <Link to="/dashboard/settings/account/registration" />
                      }
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-8 w-full justify-start gap-2 rounded-lg px-2 text-sm font-normal text-sidebar-foreground/80",
                        isActivePath(
                          "/dashboard/settings/account/registration",
                        ) && "bg-sidebar-accent text-sidebar-accent-foreground",
                      )}
                    >
                      <UserPlus className="h-4 w-4" />
                      <span>{t("registrationSetup:title")}</span>
                    </Button>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}

          <SidebarGroup className="gap-1 p-1">
            <SidebarGroupLabel className="h-7 px-2 text-xs uppercase tracking-wide text-sidebar-foreground/70">
              {t("settings:developer")}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <SidebarMenuItem>
                  <Button
                    render={<Link to="/dashboard/settings/account/developer" />}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-8 w-full justify-start gap-2 rounded-lg px-2 text-sm font-normal text-sidebar-foreground/80",
                      isActivePath("/dashboard/settings/account/developer") &&
                        "bg-sidebar-accent text-sidebar-accent-foreground",
                    )}
                  >
                    <Code className="h-4 w-4" />
                    <span>{t("settings:apiKeys")}</span>
                  </Button>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </div>
      </SettingsSidebar>

      <div className="flex-1 min-w-0 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
