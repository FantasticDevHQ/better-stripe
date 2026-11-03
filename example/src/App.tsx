import type { ReactNode } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { RoleProvider } from "@/providers/role-context";
import { router } from "./router";

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RoleProvider>
      <AppShell>{children}</AppShell>
    </RoleProvider>
  );
}

export default function App() {
  return <RouterProvider router={router} InnerWrap={AppLayout} />;
}
