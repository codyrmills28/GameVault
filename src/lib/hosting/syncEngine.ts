import { FileEntry, TransferOp, TransferPlan } from "./types";

// Ignore patterns:
//   "dir/"     -> matches the dir itself and anything beneath it
//   "**/name"  -> matches any path whose basename is `name`
//   "name"     -> matches that exact relPath
export function isIgnored(relPath: string, ignore: string[]): boolean {
  const base = relPath.split("/").pop() || relPath;
  for (const pat of ignore) {
    if (pat.endsWith("/")) {
      const dir = pat.slice(0, -1);
      if (relPath === dir || relPath.startsWith(dir + "/")) return true;
    } else if (pat.startsWith("**/")) {
      if (base === pat.slice(3)) return true;
    } else if (relPath === pat) {
      return true;
    }
  }
  return false;
}

export function planTransfer(source: FileEntry[], dest: FileEntry[], ignore: string[]): TransferPlan {
  const destByPath = new Map(dest.map((e) => [e.relPath, e]));
  const mkdirs: TransferOp[] = [];
  const copies: TransferOp[] = [];

  for (const entry of source) {
    if (isIgnored(entry.relPath, ignore)) continue;

    if (entry.isDir) {
      if (!destByPath.has(entry.relPath)) {
        mkdirs.push({ type: "mkdir", relPath: entry.relPath });
      }
      continue;
    }

    const existing = destByPath.get(entry.relPath);
    const unchanged = existing && existing.size === entry.size && existing.mtimeMs >= entry.mtimeMs;
    if (!unchanged) {
      copies.push({ type: "copy", relPath: entry.relPath });
    }
  }

  // Shallow-to-deep so parent dirs are created before their children.
  mkdirs.sort((a, b) => a.relPath.split("/").length - b.relPath.split("/").length || a.relPath.localeCompare(b.relPath));
  copies.sort((a, b) => a.relPath.localeCompare(b.relPath));

  return { ops: [...mkdirs, ...copies] };
}
