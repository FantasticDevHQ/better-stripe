import { useState } from "react";

import { Menu, X } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useRole } from "@/providers/role-context";
import { Link, NavLink } from "react-router-dom";

import { NAV_ITEMS } from "@/lib/role-navigation";

function StoreSelector() {
  const { currentRole, currentUser, sellers, setSeller } = useRole();
  if (currentRole !== "seller") return null;
  return (
    <label className="mb-4 block space-y-2">
      <span className="text-muted-foreground text-xs font-medium">Store</span>
      <select
        aria-label="Seller persona"
        className="border-input bg-background w-full min-w-0 rounded-md border px-2 py-2 text-sm"
        value={currentUser.id}
        onChange={(event) => setSeller(event.target.value)}
      >
        {sellers.map((seller) => (
          <option key={seller.id} value={seller.id}>
            {seller.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function NavSidebar() {
  const { currentRole } = useRole();
  const items = NAV_ITEMS[currentRole];
  const [openMobile, setOpenMobile] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="fixed top-2.5 left-4 z-50 md:hidden"
        aria-label="Open navigation menu"
        aria-expanded={openMobile}
        aria-controls="mobile-navigation"
        onClick={() => setOpenMobile(true)}
      >
        <Menu />
      </Button>

      <nav
        className="border-border hidden w-56 shrink-0 border-r p-4 md:block"
        aria-label="Primary navigation"
      >
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            cn(
              buttonVariants({ variant: isActive ? "secondary" : "ghost" }),
              "w-full justify-start",
              isActive && "font-medium",
            )
          }
        >
          Home
        </NavLink>
        <Separator className="my-4" />
        <div className="text-muted-foreground mb-4 text-xs font-semibold tracking-wider uppercase">
          {currentRole}
        </div>
        <StoreSelector />
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    buttonVariants({
                      variant: isActive ? "secondary" : "ghost",
                    }),
                    "w-full justify-start",
                    isActive && "font-medium",
                  )
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {openMobile && (
        <div
          id="mobile-navigation"
          data-mobile={openMobile}
          className="fixed inset-0 z-50 flex md:hidden"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close navigation menu"
            onClick={() => setOpenMobile(false)}
          />
          <nav
            className="bg-background relative z-10 h-full w-72 overflow-y-auto border-r p-4 shadow-xl"
            aria-label="Mobile navigation"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="font-semibold">BetterStripe</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close navigation menu"
                onClick={() => setOpenMobile(false)}
              >
                <X />
              </Button>
            </div>
            <Link
              to="/"
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "w-full justify-start",
              )}
              onClick={() => setOpenMobile(false)}
            >
              Home
            </Link>
            <Separator className="my-4" />
            <StoreSelector />
            <ul className="space-y-1">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        buttonVariants({
                          variant: isActive ? "secondary" : "ghost",
                        }),
                        "w-full justify-start",
                        isActive && "font-medium",
                      )
                    }
                    onClick={() => setOpenMobile(false)}
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </>
  );
}
