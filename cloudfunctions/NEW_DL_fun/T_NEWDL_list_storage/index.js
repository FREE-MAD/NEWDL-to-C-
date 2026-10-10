// 云函数：列举云存储指定目录下的所有图片文件
// 用途：办证页套餐选择 tab 轮播广告，动态读取 do_certification_adv 目录下全部图片
// 说明：微信云存储前端 SDK 没有列举文件夹的能力，因此通过云函数 + @cloudbase/manager-node 实现。
// ===== deploy-meta:start
// 关键字段登记（由 sync-dev-to-true.js 每次同步强制覆写：D_ 源里的值到不了这里，手改也会被下一次同步覆盖）。
// 正式版部署单元：环境固定 release（代表 real，NDLreal_），业务代码不读请求判断环境，一律以本块为准。
const DEPLOY_META = Object.freeze({
  side: 'T',                 // 'D' = 开发版部署单元；'T' = 正式版部署单元
  envVersion: 'release',     // 固定环境：'develop'（NDLdev_）| 'release'（代表 real，NDLreal_）
  isDev: false,              // = envVersion === 'develop' 的预计算值，业务代码直接用
  sourceDir: 'D_NEWDL_list_storage',  // 源目录：本 T_ 镜像自该 D_ 目录（仅排查用）
  managedBy: 'sync-dev-to-true.js'
});
// ===== deploy-meta:end
const CloudBase = require('@cloudbase/manager-node');
// 调整（2026-10-08）：云环境 ID 统一取自公共层 _shared/runtime.js（源在 NEW_DL_fun/_shared/，副本只读）。
const { CLOUD_ENV } = require('./_shared/runtime');

// A 侧云环境 ID 与存储桶，用于把 cloudPath 拼成可直接在 <image src> 使用的 fileID
const ENV_ID = CLOUD_ENV;
const BUCKET = '636c-cloud1-6gh7jgl8c5b16a83-1398046944';

// 允许展示的图片扩展名（白名单过滤，避免把非图片文件塞进轮播）
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

exports.main = async (event, context) => {
  // 入参：prefix 为要列举的云存储目录（必须以 / 结尾，如 NEWDL/yemian_ui_show/do_certification_adv/）
  const prefix = String((event && event.prefix) || '').trim();
  if (!prefix) {
    return { success: false, message: '缺少 prefix 参数', files: [] };
  }

  try {
    // 关键修复（2026-09-06）：不手动传凭证，直接让 SDK 在请求时自动读取云函数环境变量
    // TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY / TENCENTCLOUD_SESSIONTOKEN 三项。
    // 原因：SDK 构造参数里 token 字段名为 token（不叫 sessionToken），手动传 secretId/secretKey
    // 会跳过 SDK 内部的环境变量兜底逻辑，导致临时密钥签名时缺少 X-TC-Token 头，
    // 服务端无法解析临时 SecretId，报 [DescribeEnvs] The SecretId is not found。
    // 显式传 envId 用于固定目标环境（也可不传，SDK 会从 TENCENTCLOUD_TCB_ENVID 自动识别）。
    const { storage } = new CloudBase({ envId: ENV_ID });

    // 打印凭证环境变量是否存在（只输出布尔值，不泄露密钥内容），便于日志排障
    console.log('[NEWDL_list_storage] 凭证环境变量检查：', {
      hasSecretId: !!process.env.TENCENTCLOUD_SECRETID,
      hasSecretKey: !!process.env.TENCENTCLOUD_SECRETKEY,
      hasSessionToken: !!process.env.TENCENTCLOUD_SESSIONTOKEN
    });

    // 列出目录下所有文件（listDirectoryFiles 会递归返回该目录及子目录下的全部文件）
    const fileList = await storage.listDirectoryFiles(prefix);

    // 过滤出图片文件，并把 cloudPath 转成小程序可直接使用的 fileID
    const imageFiles = (fileList || [])
      .filter((item) => {
        const key = String((item && item.Key) || '').toLowerCase();
        return IMAGE_EXTENSIONS.some((ext) => key.endsWith(ext));
      })
      .map((item) => {
        const key = String(item.Key || '');
        return {
          key,
          fileID: `cloud://${ENV_ID}.${BUCKET}/${key}`
        };
      });

    return { success: true, files: imageFiles };
  } catch (err) {
    console.error('[NEWDL_list_storage] 列举失败：', err);
    return { success: false, message: err.message, files: [] };
  }
};
