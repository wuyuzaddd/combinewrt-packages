import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Write a rendered site into `outDir`, replacing any previous contents. */
export async function writeSite(files: Map<string, string>, outDir: string): Promise<string[]> {
  await rm(outDir, { recursive: true, force: true });
  const written: string[] = [];

  for (const [relativePath, contents] of [...files.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (relativePath.includes("..") || relativePath.startsWith("/")) {
      throw new Error(`refusing to write unsafe path: ${relativePath}`);
    }
    const target = join(outDir, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
    written.push(relativePath);
  }

  return written;
}
