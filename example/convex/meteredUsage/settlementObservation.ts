/** A provider exception cannot erase observed invoice cash or become a successful split. */
export async function observeDemoSettlement<T>(execute: () => Promise<T>) {
  try {
    return await execute();
  } catch {
    return {
      status: "unknown" as const,
      reason: "provider_outcome_unknown" as const,
      retryable: false as const,
    };
  }
}
