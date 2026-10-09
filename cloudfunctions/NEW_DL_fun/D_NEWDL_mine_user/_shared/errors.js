/**
 * _shared/errors.js —— L1 公共层：统一错误码
 *
 * 治的病（现状实测）：返回口径 3 种并存 ——
 *   ① { code: 400/401/403/404/500, msg }    （execution_order 主流）
 *   ② { code: 1, msg }                      （execution_order:1443/1450/1456/1463 缺参数）
 *   ③ { error: err.message }                （first_page_req:69，裸抛，前端无法判别）
 * 前端依赖 .msg 的地方有 21 处，所以迁移必须逐函数、可回退，不能一次性切换。
 *
 * 设计取舍：
 *   - ok() 的 code 允许覆盖（options.code），接入某个函数时可以沿用该函数原有的成功口径，
 *     做到「前端零改动」，最后再统一到 0。
 *   - toResponse() 只做「错误侧」统一，AppError 与未知异常都转成 { code, msg }，
 *     且保留原有 msg 文本，避免改一处坏一处。
 *
 * 用法：
 *   const { fail, ok, toResponse, CODES } = require('./_shared/errors')
 *   if (!ctx.openid) throw fail.unauthorized()
 *   return ok({ orderId })
 *   ... catch (err) { return toResponse(err, { traceId: ctx.traceId }) }
 */

const CODES = {
  OK: 0,
  /** 历史遗留：execution_order 用 code:1 表示缺参数，迁移期保留映射，最终收敛到 400 */
  LEGACY_MISSING_PARAM: 1,
  BAD_REQUEST: 400,      // 参数缺失/非法
  UNAUTHORIZED: 401,     // 未登录 / openid 缺失
  FORBIDDEN: 403,        // 已登录但无权（含 action 已下线）
  NOT_FOUND: 404,        // 订单/用户/机构不存在
  STATE_CONFLICT: 409,   // ★ 状态迁移非法（终态回退、跳档）—— 状态机 owner 专用
  ACTOR_DENIED: 410,     // ★ 迁移合法但操作者无权推这一档
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UPSTREAM_FAILED: 502   // 调 B 端失败
};

class AppError extends Error {
  /**
   * @param {Number} code CODES 里的值
   * @param {String} msg  给前端看的中文提示（沿用现有文案口径）
   * @param {Object} detail 排障细节，只在 debug 段返回，不进 msg
   */
  constructor(code, msg, detail = {}) {
    super(msg);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail || {};
  }
}

const fail = {
  badRequest: (msg = '参数错误', detail) => new AppError(CODES.BAD_REQUEST, msg, detail),
  missingParam: (msg = '缺少参数') => new AppError(CODES.BAD_REQUEST, msg),
  unauthorized: (msg = '未登录') => new AppError(CODES.UNAUTHORIZED, msg),
  forbidden: (msg = '该操作已下线或无权限') => new AppError(CODES.FORBIDDEN, msg),
  notFound: (what = '数据') => new AppError(CODES.NOT_FOUND, `${what}不存在`),
  stateConflict: (from, to, reason = '') =>
    new AppError(CODES.STATE_CONFLICT, `状态不允许：${from} → ${to}`, { from, to, reason }),
  actorDenied: (actorRole, from, to) =>
    new AppError(CODES.ACTOR_DENIED, `${actorRole} 无权执行 ${from} → ${to}`, { actorRole, from, to }),
  upstreamFailed: (msg = '下游服务调用失败', detail) => new AppError(CODES.UPSTREAM_FAILED, msg, detail)
};

/**
 * 成功响应。options.code 可覆盖（迁移期沿用旧口径，做到前端零改动）。
 * @param {Object} data
 * @param {Object} [options] { code, msg, ...extra }
 */
function ok(data = {}, options = {}) {
  const { code = CODES.OK, msg = 'ok', ...extra } = options || {};
  return { code, msg, data, ...extra };
}

/**
 * 统一错误出口：把 AppError / 未知异常都转成前端可判别的响应体。
 * 注意：这里不吞掉 msg —— 现有前端 21 处依赖 msg 文案，保持一致才能灰度替换。
 */
function toResponse(err, debug = {}) {
  if (err && err instanceof AppError) {
    return { code: err.code, msg: err.message, debug: { ...err.detail, ...debug } };
  }
  const message = (err && err.message) || '服务异常';
  return { code: CODES.INTERNAL, msg: message, debug };
}

module.exports = { CODES, AppError, fail, ok, toResponse };
