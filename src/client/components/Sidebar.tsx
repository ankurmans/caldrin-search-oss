import { Link, useLocation } from "@tanstack/react-router";
import type { LinkOptions } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, type ComponentType } from "react";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  Check,
  CircleHelp,
  LogOut,
  Search,
  Settings,
  User,
} from "lucide-react";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/client/components/CommandPalette";
import { organizationContextQueryOptions } from "@/client/features/team/organizationQueries";
import { switchOrganization } from "@/serverFunctions/organization";
import { clearLastProjectId } from "@/client/lib/active-project";
import {
  connectNavGroup,
  getProjectNavGroups,
} from "@/client/navigation/items";
import { ProjectSwitcher } from "@/client/features/projects/ProjectSwitcher";
import {
  SamChatListSkeleton,
  SamSidebarPanel,
} from "@/client/features/sam/SamSidebarPanel";
import { ThemePreferenceRadio } from "@/client/components/ThemePreferenceMenuItems";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { signOutAndRedirect, useSession } from "@/lib/auth-client";
import {
  Sidebar as UiSidebar,
  SidebarContent,
  SidebarFooter as UiSidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  useSidebar,
} from "@/client/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";

const navButtonClass =
  "relative text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground data-active:before:absolute data-active:before:inset-y-1 data-active:before:left-0 data-active:before:w-[3px] data-active:before:rounded-r-full data-active:before:bg-primary";

function SidebarNavLink({
  icon: Icon,
  label,
  linkProps,
  alsoActive = [],
  placeholder = false,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  linkProps: LinkOptions;
  /** Project route segments inside this workspace that keep it highlighted. */
  alsoActive?: readonly string[];
  /** Show the row without its link, while its project is still unknown. */
  placeholder?: boolean;
}) {
  const { setOpenMobile } = useSidebar();
  const { pathname } = useLocation();
  const projectId =
    typeof linkProps.params === "object" && linkProps.params
      ? (linkProps.params as { projectId?: string }).projectId
      : undefined;
  const inWorkspace =
    projectId !== undefined &&
    alsoActive.some((segment) => {
      const prefix = `/p/${projectId}/${segment}`;
      return pathname === prefix || pathname.startsWith(`${prefix}/`);
    });
  const row = (isActive: boolean) => (
    <SidebarMenuButton
      render={<span />}
      isActive={isActive}
      aria-disabled={placeholder || undefined}
      className={navButtonClass}
    >
      <Icon className="size-4" />
      <span>{label}</span>
    </SidebarMenuButton>
  );
  return (
    <SidebarMenuItem>
      {placeholder ? (
        row(false)
      ) : (
        <Link
          {...linkProps}
          activeOptions={{
            exact: false,
            includeSearch: false,
            ...linkProps.activeOptions,
          }}
          onClick={() => setOpenMobile(false)}
          inactiveProps={inWorkspace ? { "aria-current": "page" } : undefined}
        >
          {({ isActive }) => row(isActive || inWorkspace)}
        </Link>
      )}
    </SidebarMenuItem>
  );
}

export function Sidebar({
  projectId,
  projectPending,
  ready,
}: {
  projectId: string | null;
  /** No project is known yet, but the projects list may still name one. */
  projectPending: boolean;
  /** The session is confirmed, so the sidebar's own data can load. */
  ready: boolean;
}) {
  // Until a project is known, show the project nav as rows without links, so
  // the sidebar has its full shape from the first paint instead of growing
  // once projects load. The placeholder rows never render these links.
  const navPlaceholder = projectId === null && projectPending;
  const navGroups =
    projectId !== null || navPlaceholder
      ? getProjectNavGroups(projectId ?? "")
      : [connectNavGroup];
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  // SAM is hidden from navigation: the chat route is only reachable by URL,
  // and while it is open its chat list takes the nav's place.
  const onSamRoute = pathname.includes("/sam");

  return (
    <UiSidebar variant="inset" collapsible="offcanvas" className="md:!p-0">
      <SidebarHeader className="gap-0 px-3 pb-1 pt-3">
        <Link
          to="/"
          aria-label="Caldrin Search"
          onClick={() => setOpenMobile(false)}
          className="flex items-center gap-2 px-1 pb-2 text-base font-semibold text-sidebar-foreground"
        >
          <img
            src="/transparent-logo.png"
            alt=""
            className="size-6 rounded-md"
          />
          <span className="flex min-w-0 flex-col leading-tight">
            Caldrin Search
            <span className="whitespace-nowrap text-[10px] font-normal text-muted-foreground">
              Your search visibility workspace
            </span>
          </span>
        </Link>
        <ProjectSwitcher
          activeProjectId={projectId}
          ready={ready}
          onCloseDrawer={() => setOpenMobile(false)}
        />
        {projectId ? (
          <button
            type="button"
            onClick={() => {
              setOpenMobile(false);
              window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
            }}
            className="mt-2 flex h-8 w-full items-center gap-2 rounded-md border border-sidebar-border px-2 text-left text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          >
            <Search className="size-4" aria-hidden />
            <span className="flex-1">Search or jump to…</span>
            <kbd className="rounded border px-1 text-[10px]">⌘K</kbd>
          </button>
        ) : null}
      </SidebarHeader>

      <SidebarContent>
        {onSamRoute && projectId ? (
          ready ? (
            <SamSidebarPanel
              projectId={projectId}
              onNavigate={() => setOpenMobile(false)}
            />
          ) : (
            <div className="px-2 py-1">
              <SamChatListSkeleton />
            </div>
          )
        ) : (
          <nav
            aria-label="Main navigation"
            aria-busy={navPlaceholder || undefined}
          >
            {navGroups.map((group) => (
              <SidebarGroup key={group.label} className="py-1">
                <SidebarGroupLabel className="h-7 uppercase tracking-wider">
                  {group.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => {
                      const { icon, label, alsoActive, ...linkProps } =
                        item as typeof item & {
                          alsoActive?: readonly string[];
                        };
                      return (
                        <SidebarNavLink
                          key={linkProps.to}
                          icon={icon}
                          label={label}
                          alsoActive={alsoActive}
                          linkProps={linkProps}
                          placeholder={navPlaceholder}
                        />
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </nav>
        )}
      </SidebarContent>
      <AccountFooter ready={ready} />
    </UiSidebar>
  );
}

function AccountFooter({ ready }: { ready: boolean }) {
  const { data: session } = useSession();
  const { setOpenMobile } = useSidebar();
  const email = session?.user?.email;
  const [isSwitching, setIsSwitching] = useState(false);
  const orgContextQuery = useQuery({
    ...organizationContextQueryOptions(),
    enabled: Boolean(email),
  });
  const organizations = orgContextQuery.data?.organizations ?? [];
  const activeOrganizationId = orgContextQuery.data?.organizationId;

  async function handleSwitchOrganization(organizationId: string) {
    if (isSwitching || organizationId === activeOrganizationId) return;
    setIsSwitching(true);
    try {
      await switchOrganization({ data: { organizationId } });
      // The remembered project belongs to the old workspace; without this,
      // "/" would open it before the access check bounces back.
      clearLastProjectId();
      window.location.assign("/");
    } catch (error) {
      toast.error(getStandardErrorMessage(error));
      setIsSwitching(false);
    }
  }

  return (
    <UiSidebarFooter className="gap-0 border-t border-sidebar-border pb-safe">
      <SidebarMenu>
        <SidebarNavLink
          icon={CircleHelp}
          label="Help"
          linkProps={{ to: "/support" }}
        />
        {email ? (
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    className={navButtonClass}
                    aria-label="Open account menu"
                  />
                }
              >
                <User className="size-4" />
                <span className="truncate" data-ph-mask>
                  {email}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" className="w-56">
                {organizations.length > 1 ? (
                  <>
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="flex items-center gap-1.5">
                        <ArrowLeftRight className="size-3" />
                        Organization
                      </DropdownMenuLabel>
                      {organizations.map((organization) => (
                        <DropdownMenuItem
                          key={organization.organizationId}
                          disabled={isSwitching}
                          onClick={() =>
                            void handleSwitchOrganization(
                              organization.organizationId,
                            )
                          }
                        >
                          <span className="truncate">
                            {organization.organizationName}
                          </span>
                          {organization.organizationId ===
                          activeOrganizationId ? (
                            <Check className="ml-auto size-4" />
                          ) : null}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <DropdownMenuItem
                  render={
                    <Link to="/settings" onClick={() => setOpenMobile(false)} />
                  }
                >
                  <Settings className="size-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Theme</DropdownMenuLabel>
                  <div className="px-1 pb-1">
                    <ThemePreferenceRadio />
                  </div>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => signOutAndRedirect()}
                >
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        ) : ready ? (
          <SidebarNavLink
            icon={Settings}
            label="Settings"
            linkProps={{ to: "/settings" }}
          />
        ) : (
          // The account row's slot while the session loads.
          <SidebarMenuItem>
            <SidebarMenuSkeleton showIcon />
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </UiSidebarFooter>
  );
}
