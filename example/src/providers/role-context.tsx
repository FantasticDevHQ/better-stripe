import {
  type ReactNode,
  type Context,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { useQuery } from "convex/react";
import { EmptyState } from "@/components/empty-state";

import { api } from "../../convex/_generated/api";

import { type Role } from "@/lib/role-navigation";
export type { Role } from "@/lib/role-navigation";

export interface MockUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** V2 Stripe account (acct_…) linked to this persona, if seeded. */
  stripeAccountId?: string;
}

interface RoleContextValue {
  currentUser: MockUser;
  currentRole: Role;
  setRole: (role: Role) => void;
  sellers: MockUser[];
  setSeller: (id: string) => void;
}

// Keep the context identity while Vite replaces providers and consumers.
const RoleContext: Context<RoleContextValue | null> =
  import.meta.hot?.data?.roleContext ??
  createContext<RoleContextValue | null>(null);
if (import.meta.hot?.data) import.meta.hot.data.roleContext = RoleContext;

const STORAGE_KEY = "betterlearn-role";

export function RoleProvider({ children }: { children: ReactNode }) {
  const [sellerId, setSellerState] = useState(
    () => localStorage.getItem("betterstripe-seller") ?? "",
  );
  const setSeller = useCallback((id: string) => {
    setSellerState(id);
    localStorage.setItem("betterstripe-seller", id);
  }, []);
  const [role, setRoleState] = useState<Role>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (
      stored === "customer" ||
      stored === "seller" ||
      stored === "affiliate" ||
      stored === "admin" ||
      stored === "visitor"
    ) {
      return stored;
    }
    return "visitor";
  });

  const setRole = useCallback((newRole: Role) => {
    setRoleState(newRole);
    localStorage.setItem(STORAGE_KEY, newRole);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, role);
  }, [role]);

  // Resolve the active persona from the seeded Convex users so `currentUser.id`
  // is the real `_id` that `getAccountByUserId` resolves, and carries the
  // linked `stripeAccountId`.
  const users = useQuery(api.users.list);
  const sellers: MockUser[] = (users ?? [])
    .filter((u) => u.role === "seller")
    .map((u) => ({
      id: u._id,
      name: u.storeName ?? u.name,
      email: u.email,
      role: "seller",
      stripeAccountId: u.stripeAccountId,
    }));

  // Query still pending — hold rendering so consumers never see a null user.
  if (role === "visitor") {
    return (
      <RoleContext.Provider
        value={{
          currentUser: { id: "", name: "Visitor", email: "", role: "visitor" },
          currentRole: role,
          setRole,
          sellers,
          setSeller,
        }}
      >
        {children}
      </RoleContext.Provider>
    );
  }

  if (users === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  // Query resolved, but no seeded user for the active role. Fail loudly rather
  // than spin forever — the seed hasn't run (or the users table is empty).
  // Point at the actual seed trigger (`/admin/setup` → "Seed Demo Data"), not
  // the CLI `setup` script — that one only configures env vars (BTS-113).
  const match =
    role === "seller"
      ? (users.find((u) => u.role === "seller" && u._id === sellerId) ??
        users.find((u) => u.role === "seller" && u.storeName) ??
        users.find((u) => u.role === "seller"))
      : users.find((u) => u.role === role);
  if (!match) {
    return (
      <RoleContext.Provider
        value={{
          currentUser: { id: "", name: role, email: "", role },
          currentRole: role,
          setRole,
          sellers,
          setSeller,
        }}
      >
        {role === "admin" ? (
          children
        ) : (
          <div className="p-6">
            <EmptyState>
              No demo persona is available for this role yet. Open admin setup
              to seed the example.
            </EmptyState>
            <button onClick={() => setRole("admin")}>Open admin setup</button>
          </div>
        )}
      </RoleContext.Provider>
    );
  }

  const currentUser: MockUser = {
    id: match._id,
    name: match.name,
    email: match.email,
    role,
    stripeAccountId: match.stripeAccountId,
  };

  return (
    <RoleContext.Provider
      value={{ currentUser, currentRole: role, setRole, sellers, setSeller }}
    >
      {children}
    </RoleContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within RoleProvider");
  return ctx;
}
