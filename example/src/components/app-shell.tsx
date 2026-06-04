import { NavSidebar } from "@/components/nav-sidebar";
import { RoleSwitcher } from "@/components/role-switcher";
import { Separator } from "@/components/ui/separator";
import { useRole } from "@/providers/role-context";
import { Outlet } from "react-router-dom";

export function AppShell() {
  const { currentUser } = useRole();

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold">BetterLearn</span>
          <span className="text-muted-foreground text-xs">
            better-stripe example
          </span>
        </div>
        <div className="flex items-center gap-4">
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
