#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const cloudfunctionsDir = __dirname;
const skipDirs = new Set(['common', 'node_modules']);

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
  let envId = process.env.CLOUD_ENV_ID;
  if (envId) {
    return envId;
  }

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

  return envId || null;
}

function resolveCliCommand() {
  const customCli = process.env.WECHAT_CLI_PATH;
  if (customCli && fs.existsSync(customCli)) {
    return customCli;
  }

  const platform = os.platform();
  if (platform === 'darwin') {
    const candidates = [
      '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
      '/Applications/微信web开发者工具.app/Contents/MacOS/cli'
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  try {
    execSync('which cli', { stdio: 'ignore' });
    return 'cli';
  } catch (error) {
    return null;
  }
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

function uploadBatch(functionNames, { cliCommand, envId, remoteNpm }) {
  const args = [
    'cloud',
    'functions',
    'deploy',
    '--env',
    envId,
    '--project',
    projectRoot,
    '--names',
    ...functionNames
  ];

  if (remoteNpm) {
    args.push('--remote-npm-install');
  }

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

function uploadSingle(functionName, { cliCommand, envId, remoteNpm }) {
  const args = [
    'cloud',
    'functions',
    'deploy',
    '--env',
    envId,
    '--project',
    projectRoot,
    '--name',
    functionName
  ];

  if (remoteNpm) {
    args.push('--remote-npm-install');
  }

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

  if (unknownNames.length > 0) {
    console.log('⚠️  Unknown cloud function directories (skipped):');
    unknownNames.forEach((name) => console.log(`   - ${name}`));
    console.log('');
  }

  if (invalidTargets.length > 0) {
    console.log('⏭️  Skipping invalid cloud function directories (need index.js or package.json):');
    invalidTargets.forEach((item) => console.log(`   - ${item.name}`));
    console.log('');
  }

  if (validTargets.length === 0) {
    console.log('No valid cloud functions to upload.');
    process.exit(0);
  }

  console.log('📦 Ready to upload the following cloud functions:');
  validTargets.forEach((item) => console.log(`   - ${item.name}`));
  console.log('');

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
    console.log('Dry run enabled; command preview:');
    console.log(`  ${previewArgs.join(' ')}`);
    return;
  }

  const optionsForUpload = { cliCommand, envId, remoteNpm };
  let successCount = 0;
  let failCount = 0;
  let batchAttempted = false;

  if (!sequentialOnly && validTargets.length > 1) {
    try {
      batchAttempted = true;
      const ok = uploadBatch(
        validTargets.map((item) => item.name),
        optionsForUpload
      );
      if (ok) {
        successCount = validTargets.length;
      } else {
        console.log('\n⚠️  Batch upload failed; retrying sequentially...\n');
      }
    } catch (error) {
      console.log('\n⚠️  Batch upload error; retrying sequentially...');
      console.error(`   ${error.message}`);
      console.log('');
    }
  }

  if (successCount !== validTargets.length) {
    validTargets.forEach((item) => {
      try {
        const ok = uploadSingle(item.name, optionsForUpload);
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

  console.log('\n' + '='.repeat(40));
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`📦 Total: ${validTargets.length}`);
  if (batchAttempted) {
    console.log('🚚 Mode: batch first, sequential fallback');
  } else {
    console.log('🚚 Mode: sequential');
  }
  console.log('='.repeat(40));

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main();
