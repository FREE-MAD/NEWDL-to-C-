// 调整（2026-10-08）：cloud.init / 集合名 / 运行日志统一走公共层 _shared。
// 源目录 NEW_DL_fun/_shared/ 是唯一编辑点；本目录内的 _shared/ 由 sync_shared.js 同步，副本只读勿改。
// 调整（2026-10-08 二次）：健康问卷模块已下线，本函数不再读取 hot 集合（也不再读任何集合）。
// 函数保留，作为首页聚合入口：后续首页要加新模块，直接在这里组装 sections 返回即可。
// ===== deploy-meta:start =====
// 关键字段登记（2026-10-10）：本部署单元「是哪一侧 / 环境固定为什么 / 源目录是谁」全部登记在这一块。
// 环境已由「部署哪个函数」物理固定（D_ = develop，T_ = real），业务代码不再读请求判断环境，一律以本块为准。
// 不可覆写：sync-dev-to-true.js 每次同步都会强制覆写 T_ 侧本块 —— D_ 源里的值到不了 T_，手改 T_ 也会在下一次同步被覆盖。
const DEPLOY_META = Object.freeze({
  side: 'D',                 // 'D' = 开发版部署单元；'T' = 正式版部署单元
  envVersion: 'develop',     // 固定环境：'develop'（NDLdev_）| 'release'（代表 real，NDLreal_）
  isDev: true,               // = envVersion === 'develop' 的预计算值，业务代码直接用，不再做 === 'develop' 判断
  sourceDir: 'D_NEWDL_first_page_req',   // 源目录（T_ 侧登记它镜像的 D_ 目录名；仅排查用）
  managedBy: 'sync-dev-to-true.js'
});
// ===== deploy-meta:end =====
const { initRuntime } = require('./_shared/runtime');
const { make: makeLogger } = require('./_shared/logger');

exports.main = async (event, context) => {
  // 公共层：一次 initRuntime 拿到本次请求的 env / openid / traceId；环境不再存模块级全局变量
  // 环境来自部署侧登记（deploy-meta）：D_ 恒 develop、T_ 恒 release，不再读调用方透传的 envVersion
  const ctx = initRuntime(Object.assign({}, event, { envVersion: DEPLOY_META.envVersion }));
  const log = makeLogger(ctx);
  log.runtimeEnv({
    hasOpenid: !!ctx.openid
  });

  // hot（NDLdev_hot / NDLreal_hot）读取已于 2026-10-08 移除，首页不再渲染问卷模块。
  // 返回结构保持不变：sections 为空数组，前端若再接入按空数据处理即可。
  return { sections: [], openid: ctx.openid };
};
