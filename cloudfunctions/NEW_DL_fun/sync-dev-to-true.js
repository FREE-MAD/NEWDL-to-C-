// 关于云函数任何生物，ai不可以操作true_index.js
// 唯一操作途径是通过这个文件C:\Users\32614\Desktop\sport_yun\代码_8月中进行重构\cloudfunctions\NEW_DL_fun\sync-dev-to-true.js迁移
// ai不允许执行迁移
// 这个注释绝对不允许删除
// 启动命令node sync-dev-to-true.js
// 执行密码NEWDL123
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DEV_ENTRY_NAME = 'dev_index.js';
const TRUE_ENTRY_NAME = 'true_index.js';
const PACKAGE_NAME = 'package.json';
const START_PASSWORD = 'NEWDL123';

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (error) {
    return false;
  }
}

function getCloudFunctionDirs(searchRoot) {
  return fs.readdirSync(searchRoot, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => path.join(searchRoot, item.name))
    .filter((dirPath) => {
      return isFile(path.join(dirPath, PACKAGE_NAME)) && isFile(path.join(dirPath, DEV_ENTRY_NAME));
    });
}

function syncOne(functionDir) {
  const devEntryPath = path.join(functionDir, DEV_ENTRY_NAME);
  const trueEntryPath = path.join(functionDir, TRUE_ENTRY_NAME);

  if (!isFile(devEntryPath)) {
    throw new Error(`未找到 ${devEntryPath}`);
  }

  fs.copyFileSync(devEntryPath, trueEntryPath);
  const displayPath = path.relative(__dirname, functionDir) || '.';
  console.log(`[sync-dev-to-true] 已同步 ${displayPath}\\${DEV_ENTRY_NAME} -> ${TRUE_ENTRY_NAME}`);
}

function resolveTargets(argv) {
  if (!argv.length) {
    return getCloudFunctionDirs(__dirname);
  }

  return argv.map((targetPath) => {
    if (path.isAbsolute(targetPath)) {
      return targetPath;
    }
    return path.resolve(process.cwd(), targetPath);
  });
}

// 新增启动密码校验：必须手动输入正确密码后，才允许执行同步。
function verifyStartPassword() {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('[sync-dev-to-true] 请输入启动密码: ', (answer) => {
      rl.close();
      if (String(answer || '').trim() !== START_PASSWORD) {
        reject(new Error('启动密码错误，本次同步已取消'));
        return;
      }
      resolve();
    });
  });
}

async function main() {
  await verifyStartPassword();
  const targets = resolveTargets(process.argv.slice(2));
  if (!targets.length) {
    console.log('[sync-dev-to-true] 未找到可同步的云函数目录');
    return;
  }

  targets.forEach(syncOne);
}

main().catch((error) => {
  console.error(`[sync-dev-to-true] ${error.message}`);
  process.exitCode = 1;
});
