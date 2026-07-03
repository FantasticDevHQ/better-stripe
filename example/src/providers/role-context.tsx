import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";

export type Role = "customer" | "seller" | "admin" | "visitor";

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
}

const RoleContext = createContext<RoleContextValue | null>(null);

const STORAGE_KEY = "betterlearn-role";

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (
      stored === "customer" ||
      stored === "seller" ||
      stored === "admin" ||
      stored === "visitor"
    ) {
      return stored;
    }
    return "customer";
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

  // Query still pending — hold rendering so consumers never see a null user.
  if (users === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  // Query resolved, but no seeded user for the active role. Fail loudly rather
  // than spin forever — the seed hasn't run (or the users table is empty).
  const match = users.find((u) => u.role === role);
  if (!match) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        No seeded “{role}” user found. Run the example seed
        (`pnpm --filter ./example run setup`) to create the demo personas.
      </div>
    );
  }

  const currentUser: MockUser = {
    id: match._id,
    name: match.name,
    email: match.email,
    // `match` was found by `u.role === role`, so the active switcher role IS
    // the user's role — using the state value keeps `Role` narrowed to the
    // switchable personas (marketplace-only roles like buyer/affiliate are
    // seeded data, not switcher entries).
    role,
    stripeAccountId: match.stripeAccountId,
  };

  return (
    <RoleContext.Provider value={{ currentUser, currentRole: role, setRole }}>
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
