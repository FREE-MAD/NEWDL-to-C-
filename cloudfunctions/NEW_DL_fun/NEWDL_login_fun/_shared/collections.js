/**
 * _shared/collections.js —— L0 底座：集合名唯一登记表
 *
 * 治的病（现状实测）：getCollectionName / getCollectionPrefix 共有 6 份实现
 * （ForOrganizationDo:27、ResponseQRCode:112、execution_order:32、first_page_req:15、
 *   login_fun:16、mine_user:17），外加 twowaybinding_1_DLforC/index.js:37 一份，
 * 规则完全一致但各写一遍。新增集合要改 7 个文件，漏一个就是「某函数在正式环境查空表」。
 *
 * 前缀规则沿用现状：develop → NDLdev_，trial/release → NDLreal_。
 *
 * 用法：
 *   const { collectionName } = require('./_shared/collections')
 *   collectionName('orders', ctx.isDev)        // 'NDLdev_execution_orders'
 *   ctx.collection('orders')                   // 等价，走 runtime.js 的便利方法
 */

/** 集合唯一登记表：key 是业务语义名，value 是库里真实 basename（不含环境前缀） */
const BASE = {
  orders: 'execution_orders',                 // 课程/订单主表
  users: 'users',                             // 用户身份表
  organization: 'organization',               // 机构表
  sysUser: 'sys_user',                        // 系统用户（execution_order:4147）
  sysLogs: 'sys_logs',                        // 系统日志（execution_order:4146 / :2830）
  profileShareVisitLogs: 'profile_share_visit_logs', // mine_user:589
  hot: 'hot'                                  // 首页健康问卷（first_page_req:56）
};

const DEV_PREFIX = 'NDLdev_';
const REAL_PREFIX = 'NDLreal_';

/** 前缀：develop → NDLdev_，其余 → NDLreal_ */
function prefix(isDev) {
  return isDev ? DEV_PREFIX : REAL_PREFIX;
}

/**
 * 按语义 key 取带环境前缀的集合名。
 * @param {String} baseKey BASE 里登记的 key
 * @param {Boolean} isDev  ctx.isDev
 */
function collectionName(baseKey, isDev) {
  const base = BASE[baseKey];
  if (!base) {
    throw new Error(`未登记的集合 key: ${baseKey}（请先在 _shared/collections.js 的 BASE 里登记）`);
  }
  return `${prefix(isDev)}${base}`;
}

/**
 * 兼容旧调用：历史代码到处传的是 basename 字符串而不是 key，
 * 也可能已经传了带前缀的完整名。三种形态统一收口。
 */
function normalizeCollectionName(name, isDev) {
  if (!name) return '';
  const value = String(name);
  if (value.startsWith(DEV_PREFIX) || value.startsWith(REAL_PREFIX)) return value;
  const base = BASE[value];
  const resolved = base || value;
  return `${prefix(isDev)}${resolved}`;
}

/** 反解：从带前缀的库名拿回语义 key（日志/排障用） */
function baseKeyOf(collectionFullName) {
  const value = String(collectionFullName || '');
  const raw = value.startsWith(DEV_PREFIX)
    ? value.slice(DEV_PREFIX.length)
    : (value.startsWith(REAL_PREFIX) ? value.slice(REAL_PREFIX.length) : value);
  for (const key of Object.keys(BASE)) {
    if (BASE[key] === raw) return key;
  }
  return '';
}

module.exports = {
  BASE,
  DEV_PREFIX,
  REAL_PREFIX,
  prefix,
  collectionName,
  normalizeCollectionName,
  baseKeyOf
};
