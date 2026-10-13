import { createContext, useContext } from "react";
export type Theme = "light" | "dark" | "system";
export interface ThemeState {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}
export const ThemeContext = createContext<ThemeState | null>(null);
export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme must be used within AppThemeProvider");
  return theme;
}
