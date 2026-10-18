// Ambient type for import.meta.glob (provided by Vite at runtime in convex-test consumers)
interface ImportMeta {
  glob(pattern: string | string[]): Record<string, () => Promise<unknown>>;
  glob(
    pattern: string | string[],
    options: { eager: true },
  ): Record<string, unknown>;
}
