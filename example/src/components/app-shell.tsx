import { AppCommandMenu } from "@/components/app-command-menu";
import { ThemeToggle } from "@/components/app-providers";
import { NavSidebar } from "@/components/nav-sidebar";
import { RoleSwitcher } from "@/components/role-switcher";
import { Separator } from "@/components/ui/separator";
import { useRole } from "@/providers/role-context";
import { canVisit, roleHome } from "@/lib/role-navigation";
import { Navigate, useLocation, Outlet } from "react-router-dom";

export function AppShell() {
  const { currentUser, currentRole } = useRole();
  const location = useLocation();

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
          {canVisit(currentRole, location.pathname) ? (
            <Outlet key={currentUser.id || currentRole} />
          ) : (
            <Navigate to={roleHome(currentRole)} replace />
          )}
        </main>
      </div>
    </div>
  );
}
