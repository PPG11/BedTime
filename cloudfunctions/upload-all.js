#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const cloudfunctionsDir = __dirname;
const skipDirs = new Set(['common', 'node_modules']);
const OUTPUT_PREFIX = '   - ';
let cachedEnvId;
let cachedCliCommand;

function isCacheValid(value) {
  return typeof value === 'string' && value.length > 0;
}

function logSection(title, items, { formatter = (value) => value } = {}) {
  if (!items.length) {
    return;
  }
  console.info(title);
  items.forEach((item) => console.info(`${OUTPUT_PREFIX}${formatter(item)}`));
  console.info('');
}

function parseArgs(argv) {
  const options = new Set();
  const names = [];

  argv.forEach((arg) => {
    if (arg.startsWith('-')) {
      options.add(arg);
    } else {
      names.push(arg);
    }
  });

  return { options, names };
}

function resolveCloudEnvId() {
  if (isCacheValid(cachedEnvId)) {
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
        // fall through
      }
    }
  }

  cachedEnvId = envId || null;
  return cachedEnvId;
}

function resolveCliCommand() {
  if (isCacheValid(cachedCliCommand)) {
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
      return { name, hasIndex, hasPackageJson };
    });
}

function createDeployArgs({ envId, remoteNpm, project, names, cliCommand }) {
  const baseArgs = [
    'cloud',
    'functions',
    'deploy',
    '--env',
    envId,
    '--project',
    project
  ];

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

function main() {
  const { options, names } = parseArgs(process.argv.slice(2));
  const dryRun = options.has('--dry-run');
  const sequentialOnly = options.has('--sequential') || options.has('--serial');
  const remoteNpm = options.has('--remote-npm') || options.has('--remote-npm-install');

  const allFunctions = discoverFunctions();
  const functionMap = new Map(allFunctions.map((item) => [item.name, item]));

  const unknownNames = [];
  let targets = [];

  if (names.length > 0) {
    names.forEach((n) => {
      if (!functionMap.has(n)) {
        unknownNames.push(n);
        return;
      }
      if (!targets.find((item) => item.name === n)) {
        targets.push(functionMap.get(n));
      }
    });
  } else {
    targets = allFunctions;
  }

  const validTargets = targets.filter((item) => item.hasIndex || item.hasPackageJson);
  const invalidTargets = targets.filter((item) => !validTargets.includes(item));

  logSection('⚠️  Unknown cloud function directories (skipped):', unknownNames);
  logSection('⏭️  Skipping invalid cloud function directories (need index.js or package.json):', invalidTargets, {
    formatter: (item) => item.name
  });

  if (validTargets.length === 0) {
    console.info('No valid cloud functions to upload.');
    process.exit(0);
  }

  logSection('📦 Ready to upload the following cloud functions:', validTargets, {
    formatter: (item) => item.name
  });

  const envId = resolveCloudEnvId();
  if (!envId) {
    console.error('❌ Missing CLOUD_ENV_ID. Set it via env var or src/config/cloud.ts');
    process.exit(1);
  }

  const cliCommand = resolveCliCommand();
  if (!cliCommand) {
    console.error('❌ Could not locate the WeChat Developer Tools CLI.');
    console.error('   Set WECHAT_CLI_PATH or ensure `cli` is available in PATH.');
    process.exit(1);
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
      projectRoot,
      '--names',
      ...validTargets.map((item) => item.name)
    ];
    if (remoteNpm) {
      previewArgs.push('--remote-npm-install');
    }
    console.info('Dry run enabled; command preview:');
    console.info(`  ${previewArgs.join(' ')}`);
    return;
  }

  let successCount = 0;
  let failCount = 0;
  let batchAttempted = false;

  if (!sequentialOnly && validTargets.length > 1) {
    try {
      batchAttempted = true;
      const batchOptions = createDeployArgs({
        envId,
        remoteNpm,
        project: projectRoot,
        names: validTargets.map((item) => item.name),
        cliCommand
      });
      const ok = runDeploy(batchOptions);
      if (ok) {
        successCount = validTargets.length;
      } else {
        console.info('\n⚠️  Batch upload failed; retrying sequentially...\n');
      }
    } catch (error) {
      console.info('\n⚠️  Batch upload error; retrying sequentially...');
      console.error(`   ${error.message}`);
      console.info('');
    }
  }

  if (successCount !== validTargets.length) {
    validTargets.forEach((item) => {
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
          successCount += 1;
        } else {
          failCount += 1;
        }
      } catch (error) {
        failCount += 1;
        console.error(`❌ ${item.name} upload error: ${error.message}`);
      }
    });
  }

  console.info('\n' + '='.repeat(40));
  console.info(`✅ Success: ${successCount}`);
  console.info(`❌ Failed: ${failCount}`);
  console.info(`📦 Total: ${validTargets.length}`);
  if (batchAttempted) {
    console.info('🚚 Mode: batch first, sequential fallback');
  } else {
    console.info('🚚 Mode: sequential');
  }
  console.info('='.repeat(40));

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main();
