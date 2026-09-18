// Locates an installed package's directory on disk (06-pdf-tools-advanced.md).
//
// Several local engines load data files by path rather than by import — pdf.js fonts, the
// Tesseract language model, the Liberation fonts. `require.resolve` is deliberately not used: once
// Next bundles a module the bundler's `require` returns a module id, not a path (see PROGRESS.md,
// phase 05). Instead we walk up from this module and from the working directory.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cache = new Map<string, string | null>();

/**
 * Absolute path of `node_modules/<pkg>`, found by walking up from this file and the working
 * directory until a copy containing `marker` is found. Returns null when it is not installed.
 */
export function findPackageDir(pkg: string, marker = "package.json"): string | null {
  const key = `${pkg}::${marker}`;
  if (cache.has(key)) return cache.get(key)!;
  const starts = [process.cwd()];
  try {
    starts.unshift(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    // A bundled module may have no file URL; the working directory still resolves it.
  }
  for (const start of starts) {
    let dir = path.resolve(start);
    for (;;) {
      const candidate = path.join(dir, "node_modules", ...pkg.split("/"));
      if (existsSync(path.join(candidate, marker))) {
        cache.set(key, candidate);
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  cache.set(key, null);
  return null;
}
