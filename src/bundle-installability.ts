/** Structured bundle-installability failure (ticket 12 hardening). */
export function failureMarker(bundle: string, packageName: string, target: string): string {
  return `bundle=${bundle} package=${packageName} target=${target}`;
}

/**
 * Pick the package apk named as unresolvable. `apk add --simulate` prints
 * `  <name> (no such package):`; fall back to the first bundle package when the
 * resolver only prints a generic error.
 */
export function failedPackage(stderr: string, stdout: string, fallback: string): string {
  const detail = `${stderr}\n${stdout}`;
  const match = detail.match(/^\s{2}([^\s(]+) \(no such package\)/m);
  return match?.[1] ?? fallback;
}
