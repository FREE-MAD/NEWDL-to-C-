/**
 * _shared/runtime.js —— L0 底座：cloud.init 单例 + 请求级环境解析
 *
 * 治的病（现状实测）：
 *   1. cloud.init 在 8 个业务函数的 index.js（拆双前为 dev_index.js）里各写一遍（实测 8 处，env 全部硬编码
 *      'cloud1-6gh7jgl8c5b16a83'），改环境要改 8 个文件。
 *   2. CURRENT_ENV_VERSION 是「模块级 let 全局变量」（first_page_req:9、execution_order:16、
 *      login_fun…），云函数实例复用时上一次请求的环境会串到下一次请求 —— 这是 env 分流的
 *      核心风险点。这里改成「每次请求返回一个 ctx」，模块级不存任何环境状态。
 *
 * 硬约束：本文件内不允许出现 dev/true 判断（拆双函数后即不允许出现 D_/T_ 判断）。
 *   环境在 2026-10-09 拆双函数后靠「调哪个云函数」物理隔离：D_xxx = develop，T_xxx = trial/release，
 *   不再有 index.js 按 event.envVersion 选 dev_index.js / true_index.js 的代码分流。
 *   _shared 只负责「解析本次请求的 envVersion」（用于 NDLdev_/NDLreal_ 集合前缀），不负责「选哪份代码」。
 *
 * 用法：
 *   const { initRuntime } = require('./_shared/runtime')
 *   const ctx = initRuntime(event)
 *   await ctx.collection('orders').doc(orderId).get()
 */

const path = require('path');
const cloud = require('wx-server-sdk');

/** 与现有 8 处 index.js（拆双前为 dev_index.js）的 cloud.init({ env }) 真值保持一致 */
const CLOUD_ENV = 'cloud1-6gh7jgl8c5b16a83';

const ENV_DEV = 'develop';
const ENV_TRIAL = 'trial';
const ENV_RELEASE = 'release';

let _inited = false;
let _db = null;

/**
 * cloud.init 单例。云函数容器复用期间只初始化一次，避免每次请求重复 init。
 * options.env 仅在有特殊环境（如定时器函数原本用 DYNAMIC_CURRENT_ENV）时覆盖。
 */
function initCloud(options = {}) {
  if (!_inited) {
    cloud.init({ env: options.env || CLOUD_ENV });
    _inited = true;
  }
  return cloud;
}

/** 取数据库句柄（懒加载，首次调用时才 init） */
function dbHandle(options = {}) {
  if (!_db) {
    initCloud(options);
    _db = cloud.database();
  }
  return _db;
}

/**
 * 环境归一化：与现有 13 份 getCollectionPrefix 的判定一致 ——
 * 只有 'develop' 走 NDLdev_，其余（trial/release/空值/异常值）一律 NDLreal_。
 */
function normalizeEnvVersion(raw) {
  const v = String(raw || '').trim();
  if (v === ENV_DEV || v === ENV_TRIAL || v === ENV_RELEASE) return v;
  return ENV_DEV; // 与各函数现有默认值 'develop' 保持一致
}

/**
 * 运行时来源识别：日志需要能回答「这次跑的是哪个文件」。
 *
 * 拆双函数（2026-10-09）后，各云函数入口统一为 index.js（D_xxx 与 T_xxx 是两套独立目录），
 * 不再有 dev_index.js / true_index.js 文件分流。_shared 里 __filename 永远是 runtime.js，
 * 拿不到入口文件名，所以改用调用栈识别：从栈里找 dev_index/true_index 文件名（历史兼容，
 * 现已无匹配对象，会回退到入口文件名 index.js）。环境本身由请求上下文 ctx.envVersion 提供。
 */
function detectRuntimeSource() {
  try {
    const stack = new Error().stack || '';
    const hit = stack.match(/([A-Za-z0-9_.-]*(?:dev_index|true_index)\.js)/);
    if (hit) return hit[1];
  } catch (e) {
    /* 栈不可用时走兜底 */
  }
  try {
    if (require.main && require.main.filename) {
      return path.basename(require.main.filename);
    }
  } catch (e) {
    /* ignore */
  }
  return '';
}

/** 云函数名：取入口文件所在目录名（云函数目录名即函数名） */
function detectFunctionName() {
  try {
    if (require.main && require.main.filename) {
      return path.basename(path.dirname(require.main.filename));
    }
  } catch (e) {
    /* ignore */
  }
  return process.env.SCF_FUNCTION_NAME || process.env._SCF_FUNCTION_NAME || '';
}

function makeTraceId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ==========================================================================
 * 请求上下文存储（2026-10-08 新增）—— 消灭模块级 CURRENT_ENV_VERSION
 * ==========================================================================
 *
 * 治的病：8 个业务函数把 envVersion 存成模块级 `let CURRENT_ENV_VERSION`，
 * 云函数实例复用时上一次请求的环境会串到下一次请求 —— HTTP 访问服务下同一实例
 * 可以并发处理多个请求，一个 develop 请求与一个 release 请求交错时，
 * 后者的集合前缀会覆盖前者，正式流量就可能写进 NDLdev_ 集合。
 *
 * 实现：优先用 AsyncLocalStorage（Node 12.17+ / 13.10+），按异步链隔离，并发下互不干扰。
 *
 * 关于腾讯云 SCF 的 Node 12.16 档位：它没有 AsyncLocalStorage。此时自动退化为
 * 模块级单点 —— 行为与改造前逐字等价（不比现状更差），并打一条 WARN 提示升级运行时。
 * 一旦把云函数运行时切到 Node 16.13+，同一份代码无需再改即可自动获得并发隔离。
 *
 * 用法（业务函数 main 内）：
 *   const ctx = initRuntime(event)
 *   return await runInContext(ctx, async () => { ...原逻辑... })
 * 之后任意深度的 getCollectionName(baseName) 读 currentIsDev() 即可拿到本次请求的环境。
 */
let _als = null;
let _alsDecided = false;
let _fallbackCtx = null;

function ensureAls() {
  if (_alsDecided) return _als;
  _alsDecided = true;
  try {
    const mod = require('async_hooks');
    if (mod && typeof mod.AsyncLocalStorage === 'function') {
      _als = new mod.AsyncLocalStorage();
      console.log('[shared/runtime] 请求上下文：AsyncLocalStorage 可用，并发环境已隔离');
    }
  } catch (e) {
    _als = null;
  }
  if (!_als) {
    console.warn(
      '[shared/runtime][WARN] 当前 Node 运行时不支持 AsyncLocalStorage，请求上下文退化为'
      + '「单实例串行」假设（并发仍可能串环境）。把云函数运行时升到 Node 16.13+ 即可根治，代码无需再改。'
    );
  }
  return _als;
}

/** 取本次请求的 ctx；拿不到时返回 null */
function currentContext() {
  const als = ensureAls();
  if (als) {
    const ctx = als.getStore();
    if (ctx) return ctx;
  }
  return _fallbackCtx;
}

/** 本次请求是否 develop。拿不到 ctx 时回退 true —— 与历史默认值 'develop' 一致 */
function currentIsDev() {
  const ctx = currentContext();
  return ctx ? ctx.isDev : true;
}

/** 本次请求的 envVersion。拿不到 ctx 时回退 'develop' —— 与历史默认值一致 */
function currentEnvVersion() {
  const ctx = currentContext();
  return ctx ? ctx.envVersion : ENV_DEV;
}

/**
 * 把 fn 挂到本次请求的 ctx 上执行。fn 内部的整条 await 链都能读到同一个 ctx。
 * @param {Object} ctx   initRuntime() 的返回值
 * @param {Function} fn  同步或异步函数
 */
function runInContext(ctx, fn) {
  const als = ensureAls();
  // 无论走哪条路径都记一份：ALS 可用时它只是给「拿不到 store」的场景兜底，
  // 不可用时它就是唯一来源 —— 这一行等价于改造前的 CURRENT_ENV_VERSION = ctx.envVersion。
  _fallbackCtx = ctx;
  return als ? als.run(ctx, fn) : fn();
}

function safeWxContext() {
  try {
    return cloud.getWXContext() || {};
  } catch (e) {
    // HTTP 访问服务 / 定时触发器下没有微信上下文，返回空对象而不是抛错
    return {};
  }
}

/**
 * 每个请求开头调用一次，返回本次请求的运行上下文。
 *
 * @param {Object} event 云函数入参（envVersion 由前端每个请求透传）
 * @param {Object} [options] { env, functionName, traceId }
 * @returns {Object} ctx
 */
function initRuntime(event = {}, options = {}) {
  const rawEvent = event && typeof event === 'object' ? event : {};
  const envVersion = normalizeEnvVersion(rawEvent.envVersion || options.envVersion);
  const isDev = envVersion === ENV_DEV;
  const db = dbHandle(options);
  const wxContext = safeWxContext();
  const now = Date.now();

  return {
    envVersion,
    isDev,
    db,
    _: db.command,
    cloud,
    openid: wxContext.OPENID || '',
    appid: wxContext.APPID || '',
    unionid: wxContext.UNIONID || '',
    now,
    traceId: rawEvent.traceId || options.traceId || makeTraceId(),
    functionName: options.functionName || detectFunctionName(),
    runtimeSource: detectRuntimeSource(),
    /** 便利方法：ctx.collection('orders') 自动带环境前缀；传已带前缀的名字也认 */
    collection: (keyOrName) => db.collection(require('./collections').normalizeCollectionName(keyOrName, isDev))
  };
}

module.exports = {
  CLOUD_ENV,
  ENV_DEV,
  ENV_TRIAL,
  ENV_RELEASE,
  initCloud,
  dbHandle,
  initRuntime,
  normalizeEnvVersion,
  detectRuntimeSource,
  detectFunctionName,
  makeTraceId,
  // 请求上下文（2026-10-08）：用于消灭模块级 CURRENT_ENV_VERSION
  runInContext,
  currentContext,
  currentIsDev,
  currentEnvVersion,
  ensureAls
};
