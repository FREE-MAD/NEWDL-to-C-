/**
 * _shared/repos/userRepo.js —— L2 持久化收口：users 集合唯一写入口
 *
 * 治的病（现状实测）：
 *   mine_user 集合的写入散在 3 个云函数里共 9 处直写：
 *     - NEWDL_mine_user/dev_index.js 6 处（update ×4、set ×2）
 *     - NEWDL_login_fun/dev_index.js 2 处（update ×1、add ×1）
 *     - ForOrganizationDo/dev_index.js 1 处（update ×1，updateUserOrganizationProfile）
 *   同一张 users 表 3 个写者，谁更新哪些字段、update/set/add 怎么选，各写各的 if。
 *   未来要给 users 加审计、加权限、加缓存，必须改 9 处而不是 1 处。
 *
 * 本 Repo 只收「写」路径（update / set / add）三个动作，读路径（where/get）暂缓 ——
 * 读不产生数据问题，先聚焦写入防复发。集合名由调用方传入（沿用现有 getCollectionName
 * 字符串模式），本 Repo 不依赖 AsyncLocalStorage，任何位置都可安全调用。
 *
 * 用法：
 *   const userRepo = require('./_shared/repos/userRepo')
 *   await userRepo.updateUserDoc(usersCollection, docId, patch)
 *   await userRepo.setUserDoc(usersCollection, docId, doc)     // 指定 _id 建档（整块覆盖）
 *   await userRepo.addUserDoc(usersCollection, doc)            // 自动 _id 建档
 */

const { dbHandle } = require('../runtime');

/** 懒加载 db 句柄：方法体内调用，保证 require 本模块时不触发 cloud.init（冒烟安全） */
function db() {
  return dbHandle();
}

/**
 * 纯 update：已知文档存在，只更新 patch 指定字段，其余字段保留。
 * @param {String} usersCollection 已带环境前缀的集合名
 * @param {String} docId 文档 _id
 * @param {Object} patch 要更新的字段
 */
async function updateUserDoc(usersCollection, docId, patch) {
  return db().collection(usersCollection).doc(docId).update({ data: patch });
}

/**
 * set：指定 _id 建档（整块覆盖，会清掉未指定字段）。用于「一人一档」首次建档。
 * @param {String} usersCollection 已带环境前缀的集合名
 * @param {String} docId 文档 _id
 * @param {Object} doc 完整文档体
 */
async function setUserDoc(usersCollection, docId, doc) {
  return db().collection(usersCollection).doc(docId).set({ data: doc });
}

/**
 * add：自动生成 _id 建档（登录首次建档场景）。
 * @param {String} usersCollection 已带环境前缀的集合名
 * @param {Object} doc 完整文档体
 */
async function addUserDoc(usersCollection, doc) {
  return db().collection(usersCollection).add({ data: doc });
}

module.exports = {
  updateUserDoc,
  setUserDoc,
  addUserDoc
};
