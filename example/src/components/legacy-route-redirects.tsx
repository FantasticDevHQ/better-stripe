import { Navigate, useSearch } from "@tanstack/react-router";

export function LegacySplit() {
  const search = useSearch({ strict: false });
  return <Navigate to="/stores" search={search} replace />;
}

export function LegacyAccount({
  section,
}: {
  section: "setup" | "stripe-settings";
}) {
  const search = useSearch({ strict: false });
  return (
    <Navigate to="/seller/account" search={{ ...search, section }} replace />
  );
}
