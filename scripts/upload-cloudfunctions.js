#!/usr/bin/env node

/**
 * 批量上传微信小程序云函数脚本
 * 
 * 使用方法:
 * 1. 确保已安装微信开发者工具 CLI
 * 2. 在微信开发者工具中登录账号并打开项目
 * 3. 运行: node scripts/upload-cloudfunctions.js
 * 
 * 或者使用 npm script:
 * yarn upload:cloudfunctions
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 项目根目录
const projectRoot = path.resolve(__dirname, '..');
const cloudfunctionsDir = path.join(projectRoot, 'cloudfunctions');

// 需要跳过的目录（如 common 是共享模块，不需要单独上传）
const skipDirs = ['common', 'node_modules'];

// 从配置文件读取云环境 ID
let CLOUD_ENV_ID = process.env.CLOUD_ENV_ID;

// 如果环境变量未设置，尝试从源代码读取
if (!CLOUD_ENV_ID) {
  try {
    const cloudConfigPath = path.join(projectRoot, 'src/config/cloud.ts');
    if (fs.existsSync(cloudConfigPath)) {
      const content = fs.readFileSync(cloudConfigPath, 'utf-8');
      const match = content.match(/CLOUD_ENV_ID\s*=\s*['"]([^'"]+)['"]/);
      if (match && match[1]) {
        CLOUD_ENV_ID = match[1];
      }
    }
  } catch (error) {
    // 忽略读取错误
  }
}

/**
 * 获取所有云函数目录
 */
function getCloudFunctionDirs() {
  const items = fs.readdirSync(cloudfunctionsDir, { withFileTypes: true });
  return items
    .filter(item => item.isDirectory())
    .filter(item => !skipDirs.includes(item.name))
    .map(item => item.name)
    .sort();
}

/**
 * 检查微信开发者工具 CLI 是否可用
 */
function checkCLIAvailable() {
  try {
    execSync('which cli', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 获取微信开发者工具的 CLI 路径（Mac）
 */
function getCLIPath() {
  const os = require('os');
  const platform = os.platform();
  
  if (platform === 'darwin') {
    // Mac 上微信开发者工具的 CLI 路径
    const possiblePaths = [
      '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
      '/Applications/微信web开发者工具.app/Contents/MacOS/cli',
      process.env.WECHAT_CLI_PATH
    ].filter(Boolean);
    
    for (const cliPath of possiblePaths) {
      if (fs.existsSync(cliPath)) {
        return cliPath;
      }
    }
  }
  
  return null;
}

/**
 * 验证云函数是否有效
 * @param {string} functionName - 云函数名称
 * @returns {boolean} 是否有效
 */
function isValidCloudFunction(functionName) {
  const functionPath = path.join(cloudfunctionsDir, functionName);
  const hasIndex = fs.existsSync(path.join(functionPath, 'index.js'));
  const hasPackageJson = fs.existsSync(path.join(functionPath, 'package.json'));
  return hasIndex || hasPackageJson;
}

/**
 * 批量上传云函数
 * @param {string[]} functionNames - 云函数名称数组
 */
function uploadCloudFunctionsBatch(functionNames) {
  // 尝试找到微信开发者工具的 CLI
  let cliCommand = 'cli';
  const cliPath = getCLIPath();
  if (cliPath) {
    cliCommand = cliPath;
  } else if (!checkCLIAvailable()) {
    throw new Error('找不到微信开发者工具 CLI');
  }
  
  // 检查是否有云环境 ID
  if (!CLOUD_ENV_ID) {
    throw new Error('未配置云环境 ID。请在环境变量 CLOUD_ENV_ID 中设置，或确保 src/config/cloud.ts 中有 CLOUD_ENV_ID 配置');
  }
  
  // 使用 --names 参数批量上传，--remote-npm-install 在云端安装依赖
  const namesArg = functionNames.join(' ');
  const command = `${cliCommand} cloud functions deploy --env ${CLOUD_ENV_ID} --names ${namesArg} --project ${projectRoot} --remote-npm-install`;
  
  try {
    console.log(`📤 正在批量上传 ${functionNames.length} 个云函数...\n`);
    execSync(command, { 
      cwd: projectRoot,
      stdio: 'inherit',
      env: process.env
    });
    console.log(`\n✅ 成功上传 ${functionNames.length} 个云函数\n`);
    return true;
  } catch (error) {
    console.error(`\n❌ 批量上传失败`);
    if (error.message.includes('找不到') || error.code === 'ENOENT') {
      console.error('   错误: 找不到微信开发者工具 CLI');
      console.error('   解决方案:');
      console.error('   1. 打开微信开发者工具');
      console.error('   2. 设置 → 安全设置 → 开启服务端口');
      console.error('   3. 或使用图形界面手动上传（推荐）');
      console.error('     详见: scripts/UPLOAD_CLOUDFUNCTIONS.md\n');
    } else {
      console.error(`   错误: ${error.message}\n`);
    }
    return false;
  }
}

/**
 * 单独上传一个云函数（备用方法）
 * @param {string} functionName - 云函数名称
 */
function uploadCloudFunction(functionName) {
  if (!isValidCloudFunction(functionName)) {
    console.log(`⏭️  跳过 ${functionName} (缺少 index.js 或 package.json)`);
    return null; // 返回 null 表示跳过
  }

  return uploadCloudFunctionsBatch([functionName]);
}

/**
 * 主函数
 */
function main() {
  console.log('🚀 开始批量上传云函数...\n');
  console.log(`📁 云函数目录: ${cloudfunctionsDir}\n`);

  // 检查 CLI 可用性
  const cliPath = getCLIPath();
  const cliAvailable = checkCLIAvailable() || cliPath;
  
  if (!cliAvailable) {
    console.log('⚠️  警告: 未检测到微信开发者工具 CLI');
    console.log('   建议使用图形界面手动上传云函数');
    console.log('   详见: scripts/UPLOAD_CLOUDFUNCTIONS.md\n');
    console.log('   如果已配置 CLI，脚本将继续尝试上传...\n');
  }
  
  // 检查云环境 ID
  if (!CLOUD_ENV_ID) {
    console.log('❌ 错误: 未找到云环境 ID');
    console.log('   请设置环境变量 CLOUD_ENV_ID，或确保 src/config/cloud.ts 中有 CLOUD_ENV_ID 配置');
    console.log('   示例: CLOUD_ENV_ID=cloud1-xxx yarn upload:cloudfunctions\n');
    return;
  } else {
    console.log(`✅ 云环境 ID: ${CLOUD_ENV_ID}\n`);
  }

  const functions = getCloudFunctionDirs();
  
  if (functions.length === 0) {
    console.log('⚠️  未找到任何云函数');
    return;
  }

  // 过滤出有效的云函数
  const validFunctions = functions.filter(func => isValidCloudFunction(func));
  const invalidFunctions = functions.filter(func => !isValidCloudFunction(func));

  console.log(`📋 找到 ${functions.length} 个云函数目录:\n`);
  functions.forEach((name, index) => {
    const status = isValidCloudFunction(name) ? '✓' : '⚠';
    console.log(`   ${index + 1}. ${status} ${name}`);
  });
  console.log('');

  if (validFunctions.length === 0) {
    console.log('⚠️  没有找到有效的云函数（需要 index.js 或 package.json）');
    return;
  }

  // 优先使用批量上传（更快）
  let success = false;
  let successCount = 0;
  let failCount = 0;

  // 检查是否使用批量上传（默认开启）
  const useBatch = process.env.UPLOAD_SINGLE !== 'true';
  
  if (useBatch && validFunctions.length > 0) {
    console.log('🚀 使用批量上传模式（更快）\n');
    success = uploadCloudFunctionsBatch(validFunctions);
    if (success) {
      successCount = validFunctions.length;
    } else {
      failCount = validFunctions.length;
      console.log('\n⚠️  批量上传失败，尝试逐个上传...\n');
      // 批量失败时，尝试逐个上传
      validFunctions.forEach((functionName) => {
        const result = uploadCloudFunction(functionName);
        if (result === null) {
          // 跳过（已经在 isValidCloudFunction 中过滤了，这里不应该发生）
        } else if (result) {
          successCount++;
        } else {
          failCount++;
        }
      });
    }
  } else {
    // 逐个上传模式
    console.log('📦 使用逐个上传模式\n');
    validFunctions.forEach((functionName) => {
      const result = uploadCloudFunction(functionName);
      if (result === null) {
        // 跳过
      } else if (result) {
        successCount++;
      } else {
        failCount++;
      }
    });
  }

  console.log('\n' + '='.repeat(50));
  console.log(`📊 上传完成:`);
  console.log(`   ✅ 成功: ${successCount}`);
  console.log(`   ❌ 失败: ${failCount}`);
  if (invalidFunctions.length > 0) {
    console.log(`   ⏭️  跳过: ${invalidFunctions.length} (无效的云函数目录)`);
  }
  console.log(`   📦 总计: ${functions.length} (${validFunctions.length} 个有效)`);
  console.log('='.repeat(50));
  
  if (failCount > 0 && !cliAvailable) {
    console.log('\n💡 提示: 如果 CLI 方式不可用，请使用微信开发者工具图形界面上传');
    console.log('   参考文档: scripts/UPLOAD_CLOUDFUNCTIONS.md');
  }
}

// 执行主函数
if (require.main === module) {
  main();
}

module.exports = { getCloudFunctionDirs, uploadCloudFunction };

