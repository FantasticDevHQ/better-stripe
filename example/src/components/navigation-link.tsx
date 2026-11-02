import type { ReactNode, Ref } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import type { RoutePath } from "../router";

/** Sidebar matching stays pathname-only, including when a tab query is selected. */
export function NavigationLink({
  to,
  ref,
  end,
  className,
  children,
  onClick,
}: {
  to: RoutePath;
  ref?: Ref<HTMLAnchorElement>;
  end?: boolean;
  className: (state: { isActive: boolean }) => string;
  children: ReactNode;
  onClick?: () => void;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const isActive =
    pathname === to || (!end && to !== "/" && pathname.startsWith(`${to}/`));
  return (
    <Link
      ref={ref}
      to={to}
      activeOptions={{ exact: end, includeSearch: false }}
      className={className({ isActive })}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}
