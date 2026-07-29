import { useEffect, useState } from "react";

import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";

const CommandDialog = Command.Dialog;
const CommandInput = Command.Input;
const CommandList = Command.List;
const CommandEmpty = Command.Empty;
const CommandGroup = Command.Group;
const CommandItem = Command.Item;

const destinations = [
  { label: "Home", path: "/" },
  { label: "Customer dashboard", path: "/dashboard" },
  { label: "Seller dashboard", path: "/seller" },
  { label: "Admin overview", path: "/admin" },
  { label: "Webhook event log", path: "/admin/webhooks" },
] as const;

export function AppCommandMenu() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !event.repeat &&
        event.key.toLowerCase() === "k" &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        setOpen((currentOpen) => !currentOpen);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const goTo = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      label="Navigate BetterTees"
      overlayClassName="fixed inset-0 z-50 bg-black/50"
      contentClassName="bg-popover text-popover-foreground fixed left-1/2 top-24 z-50 w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border shadow-xl"
    >
      <CommandInput
        className="border-border focus-visible:ring-ring w-full border-b bg-transparent px-4 py-3 text-sm focus-visible:ring-2"
        placeholder="Search pages…"
      />
      <CommandList className="max-h-80 overflow-y-auto p-2">
        <CommandEmpty className="text-muted-foreground px-3 py-8 text-center text-sm">
          No matching pages found.
        </CommandEmpty>
        <CommandGroup
          heading="Navigate"
          className="text-muted-foreground text-xs"
        >
          {destinations.map((destination) => (
            <CommandItem
              key={destination.path}
              value={destination.label}
              onSelect={() => goTo(destination.path)}
              className="text-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground cursor-pointer rounded-md px-3 py-2 text-sm"
            >
              {destination.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
