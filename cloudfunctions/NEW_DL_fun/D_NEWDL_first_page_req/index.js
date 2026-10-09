// 调整（2026-10-08）：cloud.init / 集合名 / 运行日志统一走公共层 _shared。
// 源目录 NEW_DL_fun/_shared/ 是唯一编辑点；本目录内的 _shared/ 由 sync_shared.js 同步，副本只读勿改。
// 调整（2026-10-08 二次）：健康问卷模块已下线，本函数不再读取 hot 集合（也不再读任何集合）。
// 函数保留，作为首页聚合入口：后续首页要加新模块，直接在这里组装 sections 返回即可。
const { initRuntime } = require('./_shared/runtime');
const { make: makeLogger } = require('./_shared/logger');

exports.main = async (event, context) => {
  // 公共层：一次 initRuntime 拿到本次请求的 env / openid / traceId；环境不再存模块级全局变量
  // 环境钉死（2026-10-09 拆双函数）：D_xxx 只服务 develop，忽略调用方透传的 envVersion，防止误写对侧环境集合
  const ctx = initRuntime(Object.assign({}, event, { envVersion: 'develop' }));
  const log = makeLogger(ctx);
  log.runtimeEnv({
    hasOpenid: !!ctx.openid
  });

  // hot（NDLdev_hot / NDLreal_hot）读取已于 2026-10-08 移除，首页不再渲染问卷模块。
  // 返回结构保持不变：sections 为空数组，前端若再接入按空数据处理即可。
  return { sections: [], openid: ctx.openid };
};
