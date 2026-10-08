/**
 * _shared/logger.js —— L1 公共层：统一日志
 *
 * 治的病（现状实测）：
 *   1. logRuntimeEnvInfo 在 6 个函数里各写一份，字段命名不统一，排障时各说各话。
 *   2. 日志没有 traceId，一次请求跨函数（A → B → A）无法串起来。
 *
 * 约定：
 *   - 每条日志都带 { t, fn, env, traceId, src }，src 是 dev_index.js / true_index.js
 *     （由 runtime.js 的 detectRuntimeSource 识别，同步后自动跟随，不需要同步脚本保护）。
 *   - tag 用点分域：'course.state.transition'、'gateway.inbound' 这类，便于检索。
 *
 * 用法：
 *   const { make: makeLogger } = require('./_shared/logger')
 *   const log = makeLogger(ctx)
 *   log.info('order.publish', { orderId })
 *   log.runtimeEnv({ action })   // 等价于现有 [runtime_env] 那一行
 */

const { prefix } = require('./collections');

function make(ctx = {}, options = {}) {
  const base = {
    t: new Date().toISOString(),
    fn: options.functionName || ctx.functionName || '',
    env: ctx.envVersion || '',
    traceId: ctx.traceId || '',
    src: ctx.runtimeSource || ''
  };

  const write = (method, tag, extra) => {
    // 云函数 console.log 多参数会被平台拼接，这里固定「tag + 一个对象」，便于日志检索
    console[method](`[${tag}]`, { ...base, ...(extra && typeof extra === 'object' ? extra : { value: extra }) });
  };

  return {
    info: (tag, extra) => write('log', tag, extra),
    warn: (tag, extra) => write('warn', tag, extra),
    error: (tag, extra) => write('error', tag, extra),
    /**
     * 运行环境日志：替代各函数里的 logRuntimeEnvInfo。
     * 字段与现有实现保持一致（functionName / runtimeSource / envVersion / collectionPrefix），
     * 老日志检索习惯不用改。
     */
    runtimeEnv: (extra = {}) => write('log', 'runtime_env', {
      functionName: base.fn,
      runtimeSource: base.src,
      envVersion: base.env,
      collectionPrefix: prefix(ctx.isDev),
      ...extra
    })
  };
}

module.exports = { make };
