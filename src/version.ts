/**
 * Compare two apk versions using apk-tools' ordering:
 * numeric runs compare numerically, `~` sorts before the release, and the
 * trailing `-r<n>` package release compares numerically (`-r2 < -r10`).
 */
export function compareVersions(a: string, b: string): number {
  const left = splitRevision(a);
  const right = splitRevision(b);
  const base = compareBase(left.base, right.base);
  if (base !== 0) return base;
  return left.revision - right.revision;
}

function splitRevision(value: string): { base: string; revision: number } {
  const match = /^(.*?)-r(\d+)$/.exec(value);
  if (!match) return { base: value, revision: 0 };
  return { base: match[1] as string, revision: Number(match[2]) };
}

function compareBase(a: string, b: string): number {
  const aTilde = a.indexOf("~");
  const bTilde = b.indexOf("~");

  if (aTilde !== -1 || bTilde !== -1) {
    const aHead = aTilde === -1 ? a : a.slice(0, aTilde);
    const bHead = bTilde === -1 ? b : b.slice(0, bTilde);
    const head = compareSegments(aHead, bHead);
    if (head !== 0) return head;
    if (aTilde === -1) return 1;
    if (bTilde === -1) return -1;
    return compareBase(a.slice(aTilde + 1), b.slice(bTilde + 1));
  }

  return compareSegments(a, b);
}

function compareSegments(a: string, b: string): number {
  const aParts = a.match(/\d+|\D+/g) ?? [];
  const bParts = b.match(/\d+|\D+/g) ?? [];
  const length = Math.max(aParts.length, bParts.length);

  for (let index = 0; index < length; index += 1) {
    const aPart = aParts[index];
    const bPart = bParts[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;

    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) {
      const difference = Number(aPart) - Number(bPart);
      if (difference !== 0) return difference;
    } else if (aPart !== bPart) {
      return aPart < bPart ? -1 : 1;
    }
  }

  return 0;
}

export function sortVersionsDescending<T extends { version: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => compareVersions(right.version, left.version));
}
