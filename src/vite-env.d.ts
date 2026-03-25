// Ambient type for import.meta.glob (provided by Vite at runtime in convex-test consumers)
interface ImportMeta {
  glob(pattern: string): Record<string, () => Promise<unknown>>;
}
