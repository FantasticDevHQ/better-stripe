import type { ReactNode } from "react";
import {
  IntegrationSwitch,
  type IntegrationMode,
} from "@fantastic.dev/better-stripe/react";
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
  return (
    <IntegrationSwitch
      views={{ headless, components, embedded, hosted }}
      value={(params.get("example") ?? defaultView) as IntegrationMode}
      onValueChange={(value) => {
        const next = new URLSearchParams(params);
        next.set("example", value);
        setParams(next, { replace: true });
      }}
    >
      {({ value, select, options, content }) => (
        <Tabs
          value={value}
          onValueChange={(mode) => select(mode as IntegrationMode)}
        >
          <div className="space-y-5">
            <div className="space-y-2">
              <TabsList
                aria-label="Integration examples"
                className="flex h-auto max-w-full flex-wrap justify-start"
              >
                {options.map((option) => (
                  <TabsTrigger key={option.value} value={option.value}>
                    {option.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {note && <p className="text-sm text-muted-foreground">{note}</p>}
            </div>
            <TabsContent value={value}>{content}</TabsContent>
          </div>
        </Tabs>
      )}
    </IntegrationSwitch>
  );
}
