import { pathToFileURL } from "node:url";

export const USAGE = `combinewrt-packages

Usage:
  npm run fixture -- --out site
  npm run generate -- --manifest manifest.json --apks apks --out site
  npm run verify -- --catalog site/catalog.json --index site/x86_64/packages.adb

The generator is a pure TypeScript pipeline: manifest -> catalog -> static site.
`;

export function usage(): string {
  return USAGE;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.stdout.write(USAGE);
}
