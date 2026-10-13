import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
export function IntegrationExamples({
  headless,
  components,
  embedded,
  hosted,
  note,
  defaultView = "headless",
}: {
  headless: ReactNode;
  components?: ReactNode;
  embedded?: ReactNode;
  hosted?: ReactNode;
  note?: string;
  defaultView?: "headless" | "embedded";
}) {
  const [params, setParams] = useSearchParams();
  const choices = [
    "headless",
    ...(components ? ["components"] : []),
    ...(embedded ? ["embedded"] : []),
    ...(hosted ? ["hosted"] : []),
  ];
  const requested = params.get("example") ?? defaultView;
  const value = choices.includes(requested) ? requested : "headless";
  return (
    <Tabs
      value={value}
      onValueChange={(value) => {
        const next = new URLSearchParams(params);
        next.set("example", String(value));
        setParams(next, { replace: true });
      }}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <TabsList
            aria-label="Integration examples"
            className="flex h-auto max-w-full flex-wrap justify-start"
          >
            <TabsTrigger value="headless">Headless</TabsTrigger>
            {components && (
              <TabsTrigger value="components">Components</TabsTrigger>
            )}
            {embedded && (
              <TabsTrigger value="embedded">Stripe embedded</TabsTrigger>
            )}
            {hosted && <TabsTrigger value="hosted">Stripe hosted</TabsTrigger>}
          </TabsList>
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
        </div>
        <TabsContent value="headless">{headless}</TabsContent>
        {components && (
          <TabsContent value="components">{components}</TabsContent>
        )}
        {embedded && <TabsContent value="embedded">{embedded}</TabsContent>}
        {hosted && <TabsContent value="hosted">{hosted}</TabsContent>}
      </div>
    </Tabs>
  );
}
