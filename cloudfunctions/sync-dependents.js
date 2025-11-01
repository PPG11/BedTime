#!/usr/bin/env node

/**
 * Locate all cloud functions that list the local `common` package as a dependency,
 * run `yarn workspaces focus` for them, then materialise production dependencies with npm.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const workspaceRoot = path.resolve(__dirname, '..');
const cloudfunctionsDir = path.join(workspaceRoot, 'cloudfunctions');
const skipDirs = new Set(['common', 'node_modules']);

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function collectDependents() {
  if (!fs.existsSync(cloudfunctionsDir)) {
    return [];
  }

  return fs
    .readdirSync(cloudfunctionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !skipDirs.has(entry.name))
    .map((entry) => {
      const dirName = entry.name;
      const pkgJsonPath = path.join(cloudfunctionsDir, dirName, 'package.json');
      if (!fs.existsSync(pkgJsonPath)) {
        return null;
      }

      const pkg = readJSON(pkgJsonPath);
      if (!pkg || typeof pkg.name !== 'string') {
        return null;
      }

      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (typeof deps.common !== 'string') {
        return null;
      }

      return { dirName, packageName: pkg.name, packageJson: pkg };
    })
    .filter(Boolean)
    .sort((a, b) => a.packageName.localeCompare(b.packageName));
}

function main() {
  const args = new Set(process.argv.slice(2));
  const includeDevDeps = args.has('--include-dev') || args.has('--with-dev');
  const dryRun = args.has('--dry-run');
  const skipNpm = args.has('--skip-npm');
  const keepLock = args.has('--keep-lock');
  const skipFocus = args.has('--skip-focus');

  const dependents = collectDependents();

  if (dependents.length === 0) {
    console.log('No cloud functions depend on the common workspace.');
    return;
  }

  console.log('Updating cloud functions that depend on common:');
  dependents.forEach(({ dirName, packageName }) => {
    const display = dirName === packageName ? dirName : `${dirName} (${packageName})`;
    console.log(`  • ${display}`);
  });

  if (dryRun) {
    console.log('\nDry run enabled; skipping materialisation.');
    return;
  }

  if (!skipFocus) {
    const focusArgs = ['workspaces', 'focus', ...dependents.map((item) => item.packageName)];
    if (!includeDevDeps) {
      focusArgs.push('--production');
    }

    console.log(`\nRunning: yarn ${focusArgs.join(' ')}`);

    const result = spawnSync('yarn', focusArgs, {
      cwd: workspaceRoot,
      stdio: 'inherit',
      env: process.env
    });

    if (result.error) {
      console.error('\nFailed to execute yarn:', result.error.message);
      console.error('Continuing without yarn focus (dependencies will be copied as-is).');
    } else if (typeof result.status === 'number' && result.status !== 0) {
      console.error(`\nYarn exited with code ${result.status}; continuing anyway.`);
    }
  }

  if (skipNpm) {
    return;
  }

  const functionsRoot = path.join(cloudfunctionsDir);
  const rootNodeModules = path.join(workspaceRoot, 'node_modules');

  function resolvePackagePath(baseDir, depName) {
    const scoped = depName.startsWith('@');
    const localPath = path.join(baseDir, 'node_modules', depName);
    if (fs.existsSync(localPath)) {
      return localPath;
    }

    if (fs.existsSync(rootNodeModules)) {
      const rootPath = path.join(rootNodeModules, depName);
      if (fs.existsSync(rootPath)) {
        return rootPath;
      }
    }

    // Yarn may place unplugged packages under .yarn/unplugged/<hash>/node_modules/<name>
    const unpluggedDir = path.join(workspaceRoot, '.yarn', 'unplugged');
    if (fs.existsSync(unpluggedDir)) {
      const entries = fs.readdirSync(unpluggedDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(unpluggedDir, entry.name, 'node_modules', depName);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }

  function enqueueDependencies(queue, pkgJson, sourceDir, visitedSet) {
    if (!pkgJson) return;
    const prodDeps = pkgJson.dependencies || {};
    const devDeps = includeDevDeps ? pkgJson.devDependencies || {} : {};
    const optionalDeps = pkgJson.optionalDependencies || {};

    const combined = { ...prodDeps, ...devDeps, ...optionalDeps };
    for (const [name, spec] of Object.entries(combined)) {
      if (visitedSet.has(name)) continue;
      queue.push({ name, spec, from: sourceDir });
    }
  }

  for (const { dirName, packageJson } of dependents) {
    const visited = new Set();
    const targetDir = path.join(functionsRoot, dirName);
    console.log(`\nMaterialising dependencies for ${dirName}...`);

    const nodeModulesDir = path.join(targetDir, 'node_modules');
    if (fs.existsSync(nodeModulesDir)) {
      fs.rmSync(nodeModulesDir, { recursive: true, force: true });
    }
    fs.mkdirSync(nodeModulesDir, { recursive: true });

    const queue = [];
    enqueueDependencies(queue, packageJson, targetDir, visited);

    while (queue.length > 0) {
      const { name: depName, spec, from } = queue.shift();
      if (visited.has(depName)) {
        continue;
      }
      visited.add(depName);

      let sourcePath;

      if (typeof spec === 'string' && spec.startsWith('file:')) {
        const rel = spec.slice(5);
        sourcePath = path.resolve(from, rel);
      } else {
        sourcePath = resolvePackagePath(from, depName);
      }

      if (!sourcePath || !fs.existsSync(sourcePath)) {
        console.warn(`  ⚠️  Missing dependency source for ${depName} (${spec ?? 'unknown'}); skipped.`);
        continue;
      }

      const destPath = path.join(nodeModulesDir, depName);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.cpSync(sourcePath, destPath, { recursive: true });
      console.log(`  • ${depName}`);

      const depPkgJsonPath = path.join(sourcePath, 'package.json');
      const depPkgJson = fs.existsSync(depPkgJsonPath)
        ? readJSON(depPkgJsonPath)
        : null;

      enqueueDependencies(queue, depPkgJson, sourcePath, visited);
    }

    if (!keepLock) {
      const npmLock = path.join(targetDir, 'package-lock.json');
      if (fs.existsSync(npmLock)) {
        fs.unlinkSync(npmLock);
      }
    }

    const yarnLock = path.join(targetDir, 'yarn.lock');
    if (fs.existsSync(yarnLock) && !keepLock) {
      fs.unlinkSync(yarnLock);
    }
  }
}

main();
