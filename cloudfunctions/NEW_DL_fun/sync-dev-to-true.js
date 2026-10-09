// 关于云函数任何生物，ai不可以操作true_index.js
// 唯一操作途径是通过这个文件 sync-dev-to-true.js 迁移
// ai不允许执行迁移
// 这个注释绝对不允许删除
// 启动命令 node sync-dev-to-true.js
// 执行密码 NEWDL123
//
// 说明（2026-10-09 拆双函数）：原「同目录 dev_index.js → true_index.js」改为「D_ 目录 → T_ 目录」。
//   D_xxx = 开发版云函数（源，唯一手改入口）；
//   T_xxx = 正式版云函数（本脚本的产物，只读）。
//   环境不再靠 envVersion 在文件内分流，而靠「调哪个云函数」决定 —— D_ 给 develop，T_ 给 trial/release。
//   twowaybinding_1_DLforC 不参与拆双（保留原名，被 B 侧 HTTP 直连），不在本脚本处理范围。
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PACKAGE_NAME = 'package.json';
const START_PASSWORD = 'NEWDL123';
const D_PREFIX = 'D_';
const T_PREFIX = 'T_';
// 复制时排除：依赖（云端按 package.json 安装）、git、同步清单
const EXCLUDE = new Set(['node_modules', '.git', '.sync-manifest.json']);

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (e) { return false; }
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

// 递归收集文件相对路径（POSIX 分隔）：相对路径 -> 绝对路径
function walk(dir, base = dir, out = {}) {
  if (!isDir(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (EXCLUDE.has(name)) continue;
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) {
      walk(abs, base, out);
    } else {
      out[path.relative(base, abs).split(path.sep).join('/')] = abs;
    }
  }
  return out;
}

/**
 * 同步单个 D_ 目录：镜像到同名 T_ 目录（排除 node_modules/.git/.sync-manifest.json）。
 * - 先删 T_ 里 D_ 已没有的文件（防幽灵文件）
 * - 再复制 D_ → T_
 */
function syncOne(functionDir) {
  const baseName = path.basename(functionDir);
  if (!baseName.startsWith(D_PREFIX)) {
    console.log(`[sync-dev-to-true] 跳过非 D_ 目录：${baseName}`);
    return;
  }
  const tName = T_PREFIX + baseName.slice(D_PREFIX.length);
  const tDir = path.join(path.dirname(functionDir), tName);
  const srcFiles = walk(functionDir);

  // 1) 清理：删除 T_ 里 D_ 已不存在的文件
  if (isDir(tDir)) {
    const dstFiles = walk(tDir);
    for (const rel of Object.keys(dstFiles)) {
      if (!srcFiles[rel]) {
        fs.unlinkSync(path.join(tDir, rel));
      }
    }
  }

  // 2) 复制：D_ → T_
  for (const rel of Object.keys(srcFiles)) {
    const to = path.join(tDir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(srcFiles[rel], to);
  }

  console.log(`[sync-dev-to-true] 已同步 ${baseName} -> ${tName}（${Object.keys(srcFiles).length} 个文件）`);
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
  const root = __dirname;
  const targets = fs.readdirSync(root, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .filter((item) => item.name.startsWith(D_PREFIX))
    .filter((item) => isFile(path.join(root, item.name, PACKAGE_NAME)))
    .map((item) => path.join(root, item.name));

  if (!targets.length) {
    console.log('[sync-dev-to-true] 未找到 D_ 云函数目录');
    return;
  }

  targets.forEach(syncOne);
}

main().catch((error) => {
  console.error(`[sync-dev-to-true] ${error.message}`);
  process.exitCode = 1;
});
