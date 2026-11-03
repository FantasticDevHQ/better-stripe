import { useLocation, useNavigate } from "@tanstack/react-router";
import { stringifySearch, validateSearch, parseSearch } from "./router-search";

/** URLSearchParams view of validated router state for Stripe's string query contracts. */
export function useSearchParams() {
  const search = useLocation({ select: (location) => location.search });
  const navigate = useNavigate();
  const params = new URLSearchParams(stringifySearch(validateSearch(search)));
  return [
    params,
    (next: URLSearchParams, options?: { replace?: boolean }) =>
      navigate({
        to: ".",
        search: parseSearch(next.toString()),
        replace: options?.replace,
      }),
  ] as const;
}
