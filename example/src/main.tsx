import { StrictMode } from "react";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { AppThemeProvider as ThemeProvider } from "./providers/app-theme";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";

import App from "./App";
import { AppErrorFallback } from "./components/app-error-fallback";
import { AppToaster, ThemeHotkey } from "./components/app-providers";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary FallbackComponent={AppErrorFallback}>
      <ThemeProvider>
        <ThemeHotkey />

        <ConvexProvider client={convex}>
          <App />
        </ConvexProvider>

        <AppToaster />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
