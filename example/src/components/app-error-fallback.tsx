import type { FallbackProps } from "react-error-boundary";

export function AppErrorFallback({ resetErrorBoundary }: FallbackProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-muted-foreground">
        BetterTees could not render this page. You can try again safely.
      </p>
      <button
        type="button"
        className="bg-primary text-primary-foreground mx-auto rounded-lg px-4 py-2 text-sm font-medium"
        onClick={resetErrorBoundary}
      >
        Try again
      </button>
    </main>
  );
}
