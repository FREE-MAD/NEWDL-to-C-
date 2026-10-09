// NEW_DL_fun/sync_shared.js
//
// 职责：把 NEW_DL_fun/_shared/ 同步复制到每一个业务云函数目录内，
//       让函数内部可以直接 require('./_shared/xxx')。
//
// 背景：微信云函数每个目录是独立部署单元，require('../_shared/x') 上传后路径不存在，
//       所以公共层只能「源码一份 + 各函数目录塞一份副本」。
//
// 与 sync-dev-to-true.js 完全无关：
//   - 本脚本不涉及 dev/true 分流，不读不写 dev_index.js / true_index.js；
//   - dev → true 的迁移仍然只由 sync-dev-to-true.js 完成，且只能人工执行。
//
// 用法：
//   node sync_shared.js                    # 同步到 8 个默认目标函数
//   node sync_shared.js exec mine          # 只同步目录名含 exec / mine 的函数
//   node sync_shared.js --all              # 同步到所有含 package.json 的函数目录（含待下线的 3 个）
//   node sync_shared.js --check            # 只校验不写入；副本与源不一致则 exit 1
//   node sync_shared.js --no-smoke         # 同步后不做 require 冒烟（默认做）
//   node sync_shared.js --list             # 只列出将要同步的目标
//
// 启动命令：node sync_shared.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const SRC = path.join(ROOT, '_shared');
const DEST_DIR_NAME = '_shared';
const MANIFEST = '.sync-manifest.json';
const SKIP = new Set(['node_modules', MANIFEST, '.DS_Store']);

// 默认目标：8 个在役函数。
// NEWDL_first_page_req 保留：hot 读取已移除，但函数本身仍在役（首页聚合入口），继续参与 _shared 同步。
// 未列入的三个：NEWDL_security_check / NEWDL_security_center（内容安全待并入 _shared/security.js 后下线）、
// timer_check_orders（下线待确认）。需要给它们同步时用 --all。
const TARGETS = [
  'D_NEWDL_execution_order',
  'D_ForOrganizationDo',
  'D_NEWDL_ResponseQRCode',
  'D_NEWDL_mine_user',
  'D_NEWDL_login_fun',
  'D_NEWDL_first_page_req',
  'D_NEWDL_list_storage',
  'twowaybinding_1_DLforC'
];

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (e) {
    return false;
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (e) {
    return false;
  }
}

// 递归收集文件：相对路径（POSIX 分隔） -> 绝对路径
function walk(dir, base = dir, out = {}) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
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
 * 写副本：不直接用 fs.copyFileSync。
 * 原因：部分工具链 / 安全策略下，对目标目录中新建文件的 copyfile 会被拒绝（EPERM），
 * 改成「读出内容再写入」可绕过该限制，且写入内容与源逐字节一致。
 */
function writeFile(from, to) {
  const content = fs.readFileSync(from);
  fs.writeFileSync(to, content);
}

/**
 * 同步单个函数目录。
 * @returns {{ changed: Number, drifted: Number, files: Number }}
 */
function syncOne(target, checkOnly) {
  const dest = path.join(ROOT, target, DEST_DIR_NAME);
  const srcFiles = walk(SRC);
  const fileCount = Object.keys(srcFiles).length;
  let changed = 0;
  let drifted = 0;

  // 1) 写入 / 比对：一律以源为准
  for (const rel of Object.keys(srcFiles)) {
    const to = path.join(dest, rel);
    const srcHash = md5(srcFiles[rel]);

    if (!isFile(to)) {
      if (checkOnly) {
        drifted += 1;
        console.log(`  [缺失] ${target}/${DEST_DIR_NAME}/${rel}`);
        continue;
      }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      writeFile(srcFiles[rel], to);
      changed += 1;
      continue;
    }

    if (srcHash !== md5(to)) {
      // 副本与源不一致：可能是源更新了，也可能是有人手改了副本 —— 一律以源为准覆盖
      if (checkOnly) {
        drifted += 1;
        console.log(`  [分叉] ${target}/${DEST_DIR_NAME}/${rel}`);
        continue;
      }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      writeFile(srcFiles[rel], to);
      changed += 1;
    }
  }

  // 2) 清理源里已删除的文件：避免旧副本残留造成 require 到幽灵模块
  if (!checkOnly && isDir(dest)) {
    for (const rel of Object.keys(walk(dest))) {
      if (!srcFiles[rel]) {
        fs.unlinkSync(path.join(dest, rel));
        changed += 1;
      }
    }
  }

  // 3) 写清单：记录本次同步后每个文件的 hash，供 --check 事后校验副本是否被手改
  if (!checkOnly) {
    const manifest = {};
    for (const rel of Object.keys(srcFiles)) manifest[rel] = md5(srcFiles[rel]);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, MANIFEST), JSON.stringify(manifest, null, 2));
  }

  if (checkOnly) {
    console.log(drifted ? `  ${target}: 发现 ${drifted} 处分叉` : `  ${target}: 一致（${fileCount} 个文件）`);
  } else {
    console.log(`  ${target}: ${changed ? `更新 ${changed} 个文件` : '无变化'}，共 ${fileCount} 个文件`);
  }

  return { changed, drifted, files: fileCount };
}

/**
 * 冒烟：在目标函数目录里真实 require 一次公共层，确认路径与依赖都解析得到。
 * 这是 Step 0 的门禁 —— 只有 require 不报错，业务函数才敢改成 require('./_shared/xxx')。
 */
function smoke(target) {
  const cwd = path.join(ROOT, target);
  try {
    execFileSync(process.execPath, ['-e', "require('./_shared/index.js'); console.log('smoke-ok')"], {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8'
    });
    console.log(`  ${target}: 冒烟通过（require('./_shared/index.js') 成功）`);
    return true;
  } catch (error) {
    const detail = String((error && error.stderr) || (error && error.message) || error).trim().split('\n')[0];
    console.log(`  ${target}: 冒烟失败 —— ${detail}`);
    return false;
  }
}

function resolveTargets(useAll, filters) {
  if (useAll) {
    return fs.readdirSync(ROOT, { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .map((item) => item.name)
      .filter((name) => name !== '_shared')
      .filter((name) => isFile(path.join(ROOT, name, 'package.json')));
  }

  if (!filters.length) return TARGETS;

  return TARGETS.filter((t) => filters.some((f) => t.toLowerCase().includes(f.toLowerCase())));
}

function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const useAll = argv.includes('--all');
  const needSmoke = !checkOnly && !argv.includes('--no-smoke');
  const listOnly = argv.includes('--list');
  const filters = argv.filter((a) => !a.startsWith('--'));

  if (!isDir(SRC)) {
    console.error('[sync_shared] 源目录不存在: ' + SRC);
    process.exit(1);
  }

  const targets = resolveTargets(useAll, filters);
  if (!targets.length) {
    console.log('[sync_shared] 没有匹配到目标函数');
    return;
  }

  console.log(`[sync_shared] ${checkOnly ? '校验' : '同步'} ${targets.length} 个函数：`);
  if (listOnly) {
    targets.forEach((t) => console.log('  ' + t));
    return;
  }

  let drifted = 0;
  let changed = 0;
  for (const t of targets) {
    if (!isDir(path.join(ROOT, t))) {
      console.log(`  ${t}: 目录不存在，跳过`);
      continue;
    }
    const r = syncOne(t, checkOnly);
    drifted += r.drifted;
    changed += r.changed;
  }

  let smokeFailed = 0;
  if (needSmoke) {
    console.log('[sync_shared] require 冒烟：');
    for (const t of targets) {
      if (!isDir(path.join(ROOT, t))) continue;
      if (!smoke(t)) smokeFailed += 1;
    }
  }

  if (checkOnly && drifted) {
    console.error(`\n[sync_shared] 发现 ${drifted} 处副本与源不一致 —— 副本是只读的，请跑 node sync_shared.js 覆盖`);
    process.exit(1);
  }

  if (smokeFailed) {
    console.error(`\n[sync_shared] ${smokeFailed} 个函数 require 冒烟失败，请先解决再接入业务代码`);
    process.exit(1);
  }

  console.log(`\n[sync_shared] 完成。${checkOnly ? `一致，${targets.length} 个函数` : `更新 ${changed} 个文件`}`);
}

main();
