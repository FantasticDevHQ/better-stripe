import { StrictMode } from "react";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ThemeProvider } from "next-themes";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { AppErrorFallback } from "./components/app-error-fallback";
import { AppToaster, ThemeHotkey } from "./components/app-providers";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary FallbackComponent={AppErrorFallback}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <ThemeHotkey />
        <BrowserRouter>
          <ConvexProvider client={convex}>
            <App />
          </ConvexProvider>
        </BrowserRouter>
        <AppToaster />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
