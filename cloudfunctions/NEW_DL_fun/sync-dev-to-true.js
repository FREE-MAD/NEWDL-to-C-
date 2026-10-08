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

  // 新增（2026-09-05）：SYNC_PROTECT 字段保护机制。
  // 背景：同步是整文件覆盖，dev 里「必须与 true 不同」的字段（如日志环境标识）会被 dev 值覆盖掉。
  // 用法：在 dev_index.js 需要保护的赋值行行尾加标记注释（true=右侧的值会原样替换等号右侧的赋值）：
  //   const LOG_EV = 'dev' // [SYNC_PROTECT] true='true'
  // 同步后 true_index.js 中该行自动变为：
  //   const LOG_EV = 'true' // [SYNC_PROTECT] true='true'
  // 注意：true=右侧必须写「完整的 JS 表达式字面量」（含引号），且仅支持单行声明。
  const appliedProtects = applySyncProtect(trueEntryPath);

  const displayPath = path.relative(__dirname, functionDir) || '.';
  const protectNote = appliedProtects.length
    ? `（SYNC_PROTECT 命中 ${appliedProtects.length} 处：${appliedProtects.join('、')}）`
    : '';
  console.log(`[sync-dev-to-true] 已同步 ${displayPath}\\${DEV_ENTRY_NAME} -> ${TRUE_ENTRY_NAME}${protectNote}`);
}

// 新增（2026-09-05）：扫描 true_index.js 内容，把带 [SYNC_PROTECT] true=<值> 行尾标记的声明行，
// 将等号右侧赋值替换为标记指定的 true 专用值；返回命中的变量名列表（用于控制台汇报）。
// 仅整行匹配「行首 const/let/var 声明 + 行尾标记注释」，不会误伤普通代码；无标记时完全不改动文件。
function applySyncProtect(trueEntryPath) {
  const SYNC_PROTECT_RE = /^(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*)(.*?)(\s*\/\/\s*\[SYNC_PROTECT\]\s*true\s*=\s*(.+?)\s*)$/gm;
  const content = fs.readFileSync(trueEntryPath, 'utf8');
  const hitNames = [];
  const replaced = content.replace(SYNC_PROTECT_RE, (match, head, varName, rawValue, comment, trueValue) => {
    hitNames.push(varName);
    return `${head}${trueValue}${comment}`;
  });

  if (!hitNames.length) {
    return hitNames;
  }

  try {
    // 语法预检：替换后的内容必须仍是合法 JS，否则放弃本次 SYNC_PROTECT 改写、保留纯复制结果，避免同步出坏文件。
    const vm = require('vm');
    new vm.Script(replaced, { filename: TRUE_ENTRY_NAME });
    fs.writeFileSync(trueEntryPath, replaced, 'utf8');
    return hitNames;
  } catch (syntaxError) {
    console.error(`[sync-dev-to-true] SYNC_PROTECT 改写后语法校验失败，已保留纯复制结果，请检查标记写法：${syntaxError.message}`);
    return [];
  }
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
