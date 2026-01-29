import path from 'path';
import fs from 'fs/promises';
import { ToolchainProfile } from './types';

export class TargetingManager {
  /**
   * Maps touched files to their owning package names in a workspace.
   * Scans for package.json in the directory tree of each file.
   * returns a Set of package names.
   */
  async resolveTouchedPackages(repoRoot: string, touchedFiles: string[]): Promise<Set<string>> {
    const packages = new Set<string>();
    // Cache directory check results to avoid re-reading fs
    // Key: directory path, Value: package name or null (if checked and verified not a package root, though we only traverse up)
    // Actually simpler: just cache known package.json locations?
    // Let's just traverse for now, optimization later if needed.
    // We can cache `package.json` reads.
    
    // normalize repoRoot
    const rootAbs = path.resolve(repoRoot);

    for (const file of touchedFiles) {
      // Resolve file path relative to cwd to absolute, then check if it's in repoRoot
      const absFile = path.resolve(rootAbs, file);
      
      if (!absFile.startsWith(rootAbs)) {
        continue;
      }

      let currentDir = path.dirname(absFile);

      // Traverse up until we hit the repo root
      while (currentDir.startsWith(rootAbs) && currentDir.length >= rootAbs.length) {
         // Stop if we went above root (though .startsWith check handles it mostly, strict inequality avoids loop on root parent if something weird happens)
         
         const pkgJsonPath = path.join(currentDir, 'package.json');
         try {
           const content = await fs.readFile(pkgJsonPath, 'utf-8');
           const pkg = JSON.parse(content);
           
           // If we found a package.json, we assume this is the package owning the file.
           // We do not handle nested packages (monorepo inside monorepo?) - assume standard structure.
           if (pkg.name) {
             packages.add(pkg.name);
           }
           // Once found, we stop traversing up for this file (nearest package)
           break;
         } catch {
           // File doesn't exist or is invalid, continue up
         }

         if (currentDir === rootAbs) break;
         currentDir = path.dirname(currentDir);
      }
    }
    return packages;
  }

  generateTargetedCommand(
    toolchain: ToolchainProfile,
    packages: Set<string>,
    task: 'test' | 'lint' | 'typecheck'
  ): string | null {
    if (packages.size === 0) return null;

    // Check if script exists
    if (!toolchain.scripts[task]) {
        return null;
    }

    const pkgList = Array.from(packages);

    if (toolchain.packageManager === 'pnpm') {
      if (toolchain.usesTurbo) {
        // pnpm turbo run test --filter=pkgA --filter=pkgB
        const filters = pkgList.map(p => `--filter=${p}`).join(' ');
        return `pnpm turbo run ${task} ${filters}`;
      } else {
        // pnpm -r --filter pkgA --filter pkgB test
        const filters = pkgList.map(p => `--filter ${p}`).join(' ');
        return `pnpm -r ${filters} ${task}`;
      }
    }

    // Future support for other managers
    return null;
  }
}
