import { Button } from "@/components/ui/button";
import { useLocation, useNavigate } from "react-router-dom";
import { roleHome } from "@/lib/role-navigation";
import { type Role, useRole } from "@/providers/role-context";
import { Eye, Palette, Settings, User, Users } from "lucide-react";

const roles: { value: Role; label: string; icon: typeof User }[] = [
  { value: "visitor", label: "Visitor", icon: Eye },
  { value: "customer", label: "Customer", icon: User },
  { value: "affiliate", label: "Affiliate", icon: Users },
  { value: "seller", label: "Seller", icon: Palette },
  { value: "admin", label: "Admin", icon: Settings },
];

export function RoleSwitcher() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentRole, setRole } = useRole();

  return (
    <div className="bg-secondary flex flex-wrap gap-1 rounded-lg p-1">
      {roles.map((role) => {
        const Icon = role.icon;
        return (
          <Button
            key={role.value}
            variant={currentRole === role.value ? "default" : "muted-ghost"}
            size="sm"
            onClick={() => {
              setRole(role.value);
              const shopping =
                location.pathname === "/" ||
                location.pathname === "/stores" ||
                location.pathname === "/checkout";
              if (!(
                shopping &&
                (role.value === "customer" || role.value === "visitor")
              ))
                navigate(roleHome(role.value));
            }}
          >
            <Icon className="mr-1.5 h-3.5 w-3.5" />
            {role.label}
          </Button>
        );
      })}
    </div>
  );
}
