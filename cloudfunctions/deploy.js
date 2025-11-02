#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');

const workspaceRoot = path.resolve(__dirname, '..');
const cloudfunctionsDir = __dirname;
const projectRoot = workspaceRoot;

const skipDirs = new Set(['common', 'node_modules']);

const CACHE_VERSION = 1;
const CACHE_FILE = path.join(cloudfunctionsDir, '.deploy-cache.json');

const HASH_IGNORE_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.idea', '.vscode']);
const HASH_IGNORE_FILES = new Set(['.DS_Store']);

let cachedEnvId;
let cachedCliCommand;

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function parseArgs(argv) {
  const options = new Set();
  const names = [];

  argv.forEach((arg) => {
    if (arg.startsWith('--') || (arg.startsWith('-') && arg.length > 1)) {
      options.add(arg);
    } else {
      names.push(arg);
    }
  });

  return { options, names };
}

function loadCache() {
  if (!fs.existsSync(CACHE_FILE)) {
    return { version: CACHE_VERSION, entries: {} };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') {
      return { version: CACHE_VERSION, entries: {} };
    }
    const entries = raw.entries && typeof raw.entries === 'object' ? raw.entries : {};
    return { version: CACHE_VERSION, entries };
  } catch (error) {
    console.warn('⚠️  Failed to read deploy cache; starting with a fresh cache.');
    return { version: CACHE_VERSION, entries: {} };
  }
}

function saveCache(cache) {
  const payload = JSON.stringify(
    {
      version: CACHE_VERSION,
      entries: cache.entries
    },
    null,
    2
  );
  fs.writeFileSync(CACHE_FILE, payload);
}

function pruneCache(cache, validNames) {
  const toRemove = Object.keys(cache.entries).filter((name) => !validNames.has(name));
  toRemove.forEach((name) => delete cache.entries[name]);
}

function discoverFunctions() {
  if (!fs.existsSync(cloudfunctionsDir)) {
    return [];
  }

  return fs
    .readdirSync(cloudfunctionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !skipDirs.has(entry.name))
    .map((entry) => {
      const name = entry.name;
      const dir = path.join(cloudfunctionsDir, name);
      const hasIndex = fs.existsSync(path.join(dir, 'index.js'));
      const hasPackageJson = fs.existsSync(path.join(dir, 'package.json'));
      return { name, dir, hasIndex, hasPackageJson };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function collectDependents({ includeNames } = {}) {
  if (!fs.existsSync(cloudfunctionsDir)) {
    return [];
  }

  const includeSet = includeNames ? new Set(includeNames) : null;

  return fs
    .readdirSync(cloudfunctionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !skipDirs.has(entry.name))
    .map((entry) => {
      if (includeSet && !includeSet.has(entry.name)) {
        return null;
      }
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

function computeDirectoryFingerprint(root, { extraIgnoreDirs = [] } = {}) {
  if (!fs.existsSync(root)) {
    return '';
  }

  const ignoreDirs = new Set([...HASH_IGNORE_DIRS, ...extraIgnoreDirs]);
  const hash = crypto.createHash('sha1');
  const stack = [{ dir: root, rel: '' }];

  while (stack.length > 0) {
    const { dir, rel } = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (HASH_IGNORE_FILES.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      const relativePath = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name)) {
          continue;
        }
        stack.push({ dir: fullPath, rel: relativePath });
      } else if (entry.isFile()) {
        hash.update(relativePath);
        try {
          const stats = fs.statSync(fullPath);
          hash.update(String(stats.size));
          hash.update(String(stats.mtimeMs));
        } catch (error) {
          hash.update('missing');
        }
      }
    }
  }

  return hash.digest('hex');
}

function computeFunctionSignature(functionDir, { includeCommonSignature = '' } = {}) {
  if (!fs.existsSync(functionDir)) {
    return null;
  }
  const hash = crypto.createHash('sha1');
  if (includeCommonSignature) {
    hash.update(includeCommonSignature);
  }
  hash.update(computeDirectoryFingerprint(functionDir));
  return hash.digest('hex');
}

function logSection(title, items, formatter = (value) => value) {
  if (!items.length) {
    return;
  }
  const body = items.map((item) => formatter(item)).join(', ');
  console.info(`${title} ${body}`);
}

function resolveCloudEnvId() {
  if (cachedEnvId) {
    return cachedEnvId;
  }

  let envId = process.env.CLOUD_ENV_ID;
  if (!envId) {
    const cloudConfigPath = path.join(projectRoot, 'src', 'config', 'cloud.ts');
    if (fs.existsSync(cloudConfigPath)) {
      try {
        const content = fs.readFileSync(cloudConfigPath, 'utf8');
        const match = content.match(/CLOUD_ENV_ID\s*=\s*['"]([^'"]+)['"]/);
        if (match && match[1]) {
          envId = match[1];
        }
      } catch (error) {
        // ignore
      }
    }
  }

  cachedEnvId = envId || null;
  return cachedEnvId;
}

function resolveCliCommand() {
  if (cachedCliCommand) {
    return cachedCliCommand;
  }

  const customCli = process.env.WECHAT_CLI_PATH;
  if (customCli && fs.existsSync(customCli)) {
    cachedCliCommand = customCli;
    return cachedCliCommand;
  }

  if (os.platform() === 'darwin') {
    const candidates = [
      '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
      '/Applications/微信web开发者工具.app/Contents/MacOS/cli'
    ];
    const matched = candidates.find((candidate) => fs.existsSync(candidate));
    if (matched) {
      cachedCliCommand = matched;
      return cachedCliCommand;
    }
  }

  try {
    execSync('which cli', { stdio: 'ignore' });
    cachedCliCommand = 'cli';
  } catch (error) {
    cachedCliCommand = null;
  }

  return cachedCliCommand;
}

function createDeployArgs({ envId, remoteNpm, project, names, cliCommand }) {
  const baseArgs = ['cloud', 'functions', 'deploy', '--env', envId, '--project', project];

  if (names.length === 1) {
    baseArgs.push('--name', names[0]);
  } else {
    baseArgs.push('--names', ...names);
  }

  if (remoteNpm) {
    baseArgs.push('--remote-npm-install');
  }

  return { cliCommand, args: baseArgs };
}

function runDeploy({ cliCommand, args }) {
  const result = spawnSync(cliCommand, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env
  });

  if (result.error) {
    throw result.error;
  }

  return typeof result.status === 'number' ? result.status === 0 : false;
}

function syncCommonDependents({
  dependents,
  targetNames,
  includeDevDeps,
  dryRun,
  skipFocus,
  skipNpm,
  keepLock
}) {
  const targetSet = new Set(targetNames);
  const selected = dependents.filter((item) => targetSet.has(item.dirName));

  if (selected.length === 0) {
    return { synced: [] };
  }

  const displayTargets = selected
    .map(({ dirName, packageName }) => (dirName === packageName ? dirName : `${dirName} (${packageName})`))
    .join(', ');
  console.info(`Preparing dependencies for: ${displayTargets}`);

  if (dryRun) {
    console.info('Dry run: dependency materialisation skipped.');
    return { synced: selected.map((item) => item.dirName) };
  }

  if (!skipFocus) {
    const focusArgs = ['workspaces', 'focus', ...selected.map((item) => item.packageName)];
    if (!includeDevDeps) {
      focusArgs.push('--production');
    }

    console.info(`Running: yarn ${focusArgs.join(' ')}`);

    const result = spawnSync('yarn', focusArgs, {
      cwd: workspaceRoot,
      stdio: 'inherit',
      env: process.env
    });

    if (result.error) {
      console.error(`Failed to execute yarn: ${result.error.message}`);
      console.info('Continuing without yarn focus; dependencies will be copied as-is.');
    } else if (typeof result.status === 'number' && result.status !== 0) {
      console.warn(`Yarn exited with code ${result.status}; continuing anyway.`);
    }
  }

  if (skipNpm) {
    return { synced: selected.map((item) => item.dirName) };
  }

  const rootNodeModules = path.join(workspaceRoot, 'node_modules');
  const unpluggedDir = path.join(workspaceRoot, '.yarn', 'unplugged');

  function resolvePackagePath(baseDir, depName) {
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

  for (const { dirName, packageJson } of selected) {
    const targetDir = path.join(cloudfunctionsDir, dirName);
    console.info(`Materialising dependencies for ${dirName}...`);

    const nodeModulesDir = path.join(targetDir, 'node_modules');
    if (fs.existsSync(nodeModulesDir)) {
      fs.rmSync(nodeModulesDir, { recursive: true, force: true });
    }
    fs.mkdirSync(nodeModulesDir, { recursive: true });

    const queue = [];
    const visited = new Set();
    let copiedCount = 0;
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
        console.warn(`Missing dependency source for ${depName} (${spec ?? 'unknown'}); skipped.`);
        continue;
      }

      const destPath = path.join(nodeModulesDir, depName);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.cpSync(sourcePath, destPath, { recursive: true });
      copiedCount += 1;

      const depPkgJsonPath = path.join(sourcePath, 'package.json');
      const depPkgJson = fs.existsSync(depPkgJsonPath) ? readJSON(depPkgJsonPath) : null;
      enqueueDependencies(queue, depPkgJson, sourcePath, visited);
    }

    console.info(
      copiedCount > 0
        ? `Copied ${copiedCount} package${copiedCount === 1 ? '' : 's'} for ${dirName}.`
        : `No packages copied for ${dirName}.`
    );

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

  return { synced: selected.map((item) => item.dirName) };
}

function uploadFunctions(targets, { dryRun, sequentialOnly, remoteNpm }) {
  const targetNames = targets.map((item) => item.name);

  const envId = resolveCloudEnvId();
  if (!envId) {
    console.error('❌ Missing CLOUD_ENV_ID. Set it via env var or src/config/cloud.ts');
    return { success: [], failed: targetNames, batchAttempted: false, aborted: true };
  }

  const cliCommand = resolveCliCommand();
  if (!cliCommand) {
    console.error('❌ Could not locate the WeChat Developer Tools CLI.');
    console.error('   Set WECHAT_CLI_PATH or ensure `cli` is available in PATH.');
    return { success: [], failed: targetNames, batchAttempted: false, aborted: true };
  }

  if (dryRun) {
    const previewArgs = [
      cliCommand,
      'cloud',
      'functions',
      'deploy',
      '--env',
      envId,
      '--project',
      projectRoot
    ];
    if (targetNames.length === 1) {
      previewArgs.push('--name', targetNames[0]);
    } else {
      previewArgs.push('--names', ...targetNames);
    }
    if (remoteNpm) {
      previewArgs.push('--remote-npm-install');
    }
    console.info(`Dry run command: ${previewArgs.join(' ')}`);
    return { success: [], failed: [], batchAttempted: false, aborted: false };
  }

  const success = new Set();
  const failed = new Set();
  let batchAttempted = false;

  if (!sequentialOnly && targets.length > 1) {
    try {
      batchAttempted = true;
      const batchOptions = createDeployArgs({
        envId,
        remoteNpm,
        project: projectRoot,
        names: targetNames,
        cliCommand
      });
      const ok = runDeploy(batchOptions);
      if (ok) {
        targetNames.forEach((name) => success.add(name));
      } else {
        console.warn('Batch upload failed; retrying sequentially.');
      }
    } catch (error) {
      console.warn('Batch upload error; retrying sequentially.');
      console.error(`Error: ${error.message}`);
    }
  }

  if (success.size !== targets.length) {
    targets.forEach((item) => {
      if (success.has(item.name)) {
        return;
      }
      try {
        const singleOptions = createDeployArgs({
          envId,
          remoteNpm,
          project: projectRoot,
          names: [item.name],
          cliCommand
        });
        const ok = runDeploy(singleOptions);
        if (ok) {
          success.add(item.name);
        } else {
          failed.add(item.name);
        }
      } catch (error) {
        failed.add(item.name);
        console.error(`❌ ${item.name} upload error: ${error.message}`);
      }
    });
  }

  const successCount = success.size;
  const failCount = failed.size;

  const mode = batchAttempted ? 'batch-first with sequential fallback' : 'sequential';
  console.info(
    `Deploy summary -> success: ${successCount}, failed: ${failCount}, total: ${targets.length}, mode: ${mode}`
  );

  if (failCount > 0) {
    process.exitCode = 1;
  }

  return {
    success: Array.from(success),
    failed: Array.from(failed),
    batchAttempted,
    aborted: false
  };
}

function main() {
  const { options, names } = parseArgs(process.argv.slice(2));

  const includeDevDeps = options.has('--include-dev') || options.has('--with-dev');
  const dryRun = options.has('--dry-run');
  const skipNpm = options.has('--skip-npm');
  const keepLock = options.has('--keep-lock');
  const skipFocus = options.has('--skip-focus');
  const sequentialOnly = options.has('--sequential') || options.has('--serial');
  const remoteNpm = options.has('--remote-npm') || options.has('--remote-npm-install');
  const disableIncremental = options.has('--no-incremental');
  const forceAll =
    options.has('--all') || options.has('-a') || names.includes('all') || options.has('--force-all');

  const explicitNames = names.filter((name) => name !== 'all');

  const allFunctions = discoverFunctions();
  const knownNames = new Set(allFunctions.map((item) => item.name));

  const unknownNames = explicitNames.filter((name) => !knownNames.has(name));
  const filteredNames = explicitNames.filter((name) => knownNames.has(name));

  logSection('⚠️  Unknown cloud function directories (skipped):', unknownNames);

  const targets =
    filteredNames.length > 0
      ? allFunctions.filter((item) => filteredNames.includes(item.name))
      : allFunctions;

  const validTargets = targets.filter((item) => item.hasIndex || item.hasPackageJson);
  const invalidTargets = targets.filter((item) => !validTargets.includes(item));

  logSection(
    '⏭️  Skipping invalid cloud function directories (need index.js or package.json):',
    invalidTargets,
    (item) => item.name
  );

  if (validTargets.length === 0) {
    console.info('No valid cloud functions to process.');
    return;
  }

  const dependents = collectDependents();
  const dependentNames = new Set(dependents.map((item) => item.dirName));
  const commonSignature =
    dependentNames.size > 0
      ? computeDirectoryFingerprint(path.join(cloudfunctionsDir, 'common'))
      : '';

  const incrementalAllowed =
    !forceAll && filteredNames.length === 0 && !disableIncremental && !options.has('--incremental-off');
  const cache = loadCache();
  pruneCache(cache, knownNames);

  const signaturesBefore = new Map();
  validTargets.forEach((item) => {
    const signature = computeFunctionSignature(item.dir, {
      includeCommonSignature: dependentNames.has(item.name) ? commonSignature : ''
    });
    signaturesBefore.set(item.name, signature);
  });

  let targetsToUpload;
  if (filteredNames.length > 0 || forceAll) {
    targetsToUpload = [...validTargets];
  } else if (incrementalAllowed) {
    targetsToUpload = validTargets.filter((item) => {
      const signature = signaturesBefore.get(item.name);
      const cached = cache.entries[item.name]?.signature;
      return !signature || cached !== signature;
    });
  } else {
    targetsToUpload = [...validTargets];
  }

  const modeLabel =
    filteredNames.length > 0
      ? `📦 Requested functions: ${filteredNames.join(', ')}`
      : forceAll
      ? '📦 Forcing full upload (--all)'
      : incrementalAllowed
      ? '📦 Incremental mode'
      : '📦 Full upload (incremental disabled)';
  console.info(modeLabel);

  if (targetsToUpload.length === 0) {
    console.info('No cloud functions changed; nothing to upload. Use `--all` to force a full deploy.');
    return;
  }

  logSection('📦 Ready to process the following cloud functions:', targetsToUpload, (item) => item.name);

  const targetNames = targetsToUpload.map((item) => item.name);
  const { synced } = syncCommonDependents({
    dependents,
    targetNames,
    includeDevDeps,
    dryRun,
    skipFocus,
    skipNpm,
    keepLock
  });

  if (dryRun) {
    uploadFunctions(targetsToUpload, { dryRun, sequentialOnly, remoteNpm });
    return;
  }

  const uploadResult = uploadFunctions(targetsToUpload, { dryRun, sequentialOnly, remoteNpm });
  if (uploadResult.aborted) {
    return;
  }

  const successfulNames = new Set(uploadResult.success);
  if (successfulNames.size === 0) {
    return;
  }

  for (const item of targetsToUpload) {
    if (!successfulNames.has(item.name)) {
      continue;
    }
    // Recompute signature after sync/deploy to capture latest state.
    const newSignature = computeFunctionSignature(item.dir, {
      includeCommonSignature: dependentNames.has(item.name) ? commonSignature : ''
    });
    if (!newSignature) {
      continue;
    }
    cache.entries[item.name] = {
      signature: newSignature,
      updatedAt: new Date().toISOString(),
      syncedCommon: synced.includes(item.name)
    };
  }

  saveCache(cache);
}

main();
