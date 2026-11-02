import { useState, type ReactNode } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { parseSearch, stringifySearch } from "../lib/router-search";

/** Component tests use TanStack's real history/store without mounting the app's backend. */
export function MemoryRouter({
  initialEntries = ["/"],
  children,
}: {
  initialEntries?: string[];
  children: ReactNode;
}) {
  const [router] = useState(() => {
    const root = createRootRoute();
    const catchAll = createRoute({ getParentRoute: () => root, path: "$" });
    return createRouter({
      routeTree: root.addChildren([catchAll]),
      history: createMemoryHistory({ initialEntries }),
      parseSearch,
      stringifySearch,
    });
  });
  return (
    <RouterContextProvider router={router}>{children}</RouterContextProvider>
  );
}
