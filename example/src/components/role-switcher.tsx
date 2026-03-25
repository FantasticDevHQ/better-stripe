import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { type Role, useRole } from '@/providers/role-context';
import { Palette, Settings, User } from 'lucide-react';

const roles: { value: Role; label: string; icon: typeof User }[] = [
  { value: 'learner', label: 'Learner', icon: User },
  { value: 'creator', label: 'Creator', icon: Palette },
  { value: 'admin', label: 'Admin', icon: Settings },
];

export function RoleSwitcher() {
  const { currentRole, setRole } = useRole();

  return (
    <div className="bg-secondary flex gap-1 rounded-lg p-1">
      {roles.map((role) => {
        const Icon = role.icon;
        return (
          <Button
            key={role.value}
            variant={currentRole === role.value ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setRole(role.value)}
            className={cn(
              currentRole !== role.value && 'text-muted-foreground',
            )}
          >
            <Icon className="mr-1.5 h-3.5 w-3.5" />
            {role.label}
          </Button>
        );
      })}
    </div>
  );
}
