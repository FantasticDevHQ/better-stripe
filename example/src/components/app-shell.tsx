import { AppCommandMenu } from "@/components/app-command-menu";
import { ThemeToggle } from "@/components/app-providers";
import { NavSidebar } from "@/components/nav-sidebar";
import { RoleSwitcher } from "@/components/role-switcher";
import { Separator } from "@/components/ui/separator";
import { useRole } from "@/providers/role-context";
import { Outlet } from "react-router-dom";

export function AppShell() {
  const { currentUser } = useRole();

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <AppCommandMenu />
      {/* Header */}
      <header className="flex items-center justify-between py-3 pr-6 pl-20 md:px-6">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold">BetterTees</span>
          <span className="text-muted-foreground text-xs">
            better-stripe example
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <RoleSwitcher />
          <span className="text-muted-foreground text-sm">
            {currentUser.name}
          </span>
        </div>
      </header>

      <Separator />

      {/* Body */}
      <div className="flex flex-1">
        <NavSidebar />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
