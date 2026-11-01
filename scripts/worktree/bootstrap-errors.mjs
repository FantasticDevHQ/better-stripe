// Only declared first-push environment failures may proceed to local seeding.
export function expectedMissingEnvironment(output, allowed) {
  if (typeof output !== "string" || !allowed.length) return false;
  const declared =
    /Required environment variables are not set: ([^.\r\n]+)\./.exec(output);
  if (declared) {
    const names = declared[1].split(",").map((name) => name.trim());
    return names.length > 0 && names.every((name) => allowed.includes(name));
  }
  return allowed.some((key) => output.includes(`${key} is not set`));
}
