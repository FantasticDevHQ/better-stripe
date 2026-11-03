import { useLocation as useRouterLocation } from "@tanstack/react-router";
export function useLocation() {
  const location = useRouterLocation();
  return { ...location, search: location.searchStr };
}
