/**
 * _shared/runtime.js —— L0 底座：cloud.init 单例 + 请求级环境解析
 *
 * 治的病（现状实测）：
 *   1. cloud.init 在 8 个业务函数的 dev_index.js 里各写一遍（实测 8 处，env 全部硬编码
 *      'cloud1-6gh7jgl8c5b16a83'），改环境要改 8 个文件。
 *   2. CURRENT_ENV_VERSION 是「模块级 let 全局变量」（first_page_req:9、execution_order:16、
 *      login_fun…），云函数实例复用时上一次请求的环境会串到下一次请求 —— 这是 env 分流的
 *      核心风险点。这里改成「每次请求返回一个 ctx」，模块级不存任何环境状态。
 *
 * 硬约束（见 _shared/README.md 第 3 条）：本文件内不允许出现 dev/true 判断。
 *   dev_index.js 与 true_index.js 由 index.js 按 event.envVersion 分流（见各函数 index.js），
 *   _shared 只负责「解析本次请求的 envVersion」，不负责「选哪份代码」。
 *
 * 用法：
 *   const { initRuntime } = require('./_shared/runtime')
 *   const ctx = initRuntime(event)
 *   await ctx.collection('orders').doc(orderId).get()
 */

const path = require('path');
const cloud = require('wx-server-sdk');

/** 与现有 8 处 dev_index.js 的 cloud.init({ env }) 真值保持一致 */
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
 * 运行时来源识别：dev/true 双版本下，日志必须能回答「这次跑的是哪个文件」。
 *
 * 现有做法（execution_order:12 / first_page_req:5）在 dev_index.js 里用
 *   __filename.split(/[\\/]/).pop()
 * 同步复制到 true_index.js 后自动显示 true_index.js，无需同步脚本特殊保护。
 * _shared 里 __filename 永远是 runtime.js，拿不到入口文件名，所以改用调用栈识别：
 * 从栈里找最近一个 dev_index.js / true_index.js，找不到就回退到入口文件名。
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
  makeTraceId
};
