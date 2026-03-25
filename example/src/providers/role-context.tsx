import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

export type Role = 'learner' | 'creator' | 'admin';

export interface MockUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

const MOCK_USERS: Record<Role, MockUser> = {
  learner: {
    id: 'user_learner_1',
    name: 'Alex Learner',
    email: 'alex@example.com',
    role: 'learner',
  },
  creator: {
    id: 'user_creator_1',
    name: 'Jordan Creator',
    email: 'jordan@example.com',
    role: 'creator',
  },
  admin: {
    id: 'user_admin_1',
    name: 'Sam Admin',
    email: 'sam@example.com',
    role: 'admin',
  },
};

interface RoleContextValue {
  currentUser: MockUser;
  currentRole: Role;
  setRole: (role: Role) => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);

const STORAGE_KEY = 'betterlearn-role';

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'learner' || stored === 'creator' || stored === 'admin') {
      return stored;
    }
    return 'learner';
  });

  const setRole = useCallback((newRole: Role) => {
    setRoleState(newRole);
    localStorage.setItem(STORAGE_KEY, newRole);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, role);
  }, [role]);

  return (
    <RoleContext.Provider
      value={{
        currentUser: MOCK_USERS[role],
        currentRole: role,
        setRole,
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used within RoleProvider');
  return ctx;
}
