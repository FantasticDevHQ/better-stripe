import { Fragment, type ReactNode } from "react";
import { AppCommandMenu } from "@/components/app-command-menu";
import { ThemeToggle } from "@/components/app-providers";
import { NavSidebar } from "@/components/nav-sidebar";
import { RoleSwitcher } from "@/components/role-switcher";
import { Separator } from "@/components/ui/separator";
import { useRole } from "@/providers/role-context";
import { canVisit, roleHome } from "@/lib/role-navigation";
import {
  Navigate,
  useMatches,
  useRouterState,
  Outlet,
} from "@tanstack/react-router";

export function AppShell({ children }: { children?: ReactNode }) {
  const { currentUser, currentRole } = useRole();
  // Guard the committed match, so a pending destination cannot expose the old outlet.
  const pathname = useMatches({
    select: (matches) => matches.at(-1)?.pathname ?? "/",
  });

  const pendingDestination = useRouterState({
    select: (state) => (state.isLoading ? state.location.pathname : undefined),
  });
  // Persona changes can precede the route commit. Wait for an allowed in-flight
  // destination rather than replacing the explicit setup/role-switch navigation.
  const awaitingAllowedRoute =
    pendingDestination !== undefined &&
    canVisit(currentRole, pendingDestination);

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <AppCommandMenu />
      {/* Header */}
      <header className="flex flex-wrap gap-3 items-center justify-between py-3 pr-6 pl-20 md:px-6">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold">BetterStripe</span>
          <span className="text-muted-foreground text-xs">example</span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <RoleSwitcher />
          <span className="text-muted-foreground text-sm">
            {currentUser.name}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <Separator />

      {/* Body */}
      <div className="flex flex-1">
        <NavSidebar />
        <main className="min-w-0 flex-1 p-6">
          {canVisit(currentRole, pathname) ? (
            <Fragment key={currentUser.id || currentRole}>
              {children ?? <Outlet />}
            </Fragment>
          ) : awaitingAllowedRoute ? (
            <p role="status">Loading page…</p>
          ) : (
            <Navigate to={roleHome(currentRole)} replace />
          )}
        </main>
      </div>
    </div>
  );
}
