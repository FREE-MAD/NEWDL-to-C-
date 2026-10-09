/**
 * _shared/repos/organizationRepo.js —— L2 持久化收口：organization 集合唯一写入口
 *
 * 治的病（现状实测）：
 *   ForOrganizationDo 里「写机构」和「写身份」是两笔独立写：
 *     createOrganization :516 add(organization)  →  :532 updateUserOrganizationProfile(users)
 *     updateOrganization :720 update(organization) → :747 updateUserOrganizationProfile(users)
 *     joinOrganization(已加入分支) :854 update(organization) → :864 updateUserOrganizationProfile(users)
 *   两笔之间没有事务：机构写成功、身份写失败 → 留下「孤儿机构」（机构存在但创建者 users 无 biz_role，
 *   既不是 admin 也无法操作这个机构，彻底卡死）。
 *
 * 本 Repo 把「写机构 + 写身份」两笔收进同一个 runTransaction，任何一笔失败整体回滚，不再产生孤儿。
 *
 * 行为变更（重要）：
 *   - createOrganization 的 add 改为「预生成 _id + 事务内 set」—— 微信云开发事务内 tx.add() 无法在
 *     提交前拿到稳定 _id，预生成 _id 后才能在同一事务里原子完成「建档 + 写身份」。
 *   - 身份补丁的构建从 updateUserOrganizationProfile 原样提取（buildIdentityPatch），字段与值不变。
 *
 * 用法：
 *   const orgRepo = require('./_shared/repos/organizationRepo')
 *   await orgRepo.createOrganizationWithIdentity(orgColl, userColl, orgDoc, userId, 'admin')
 *   await orgRepo.updateOrganizationWithIdentity(orgColl, userColl, orgDocId, orgPatch, userId, 'admin', orgDocForIdentity)
 */

const crypto = require('crypto');
const { dbHandle } = require('../runtime');

/** 懒加载 db 句柄（方法体内调用，require 本模块不触发 cloud.init） */
function db() {
  return dbHandle();
}

/**
 * 预生成机构文档 _id（替代 add 的自动 _id，供事务内 set 使用）。
 * 32 位 hex，与云数据库自动 _id 同为合法字符串。
 */
function generateOrganizationId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * 构建身份补丁：写 users 的 biz_role + organization_profile。
 * 从 ForOrganizationDo/updateUserOrganizationProfile 原样提取，字段与值不变。
 * @param {Object} organizationDoc 机构文档（取 organization_basic 里的 orgId/orgName/invitation_code）
 * @param {String} memberRole 'admin' | 'coach'
 */
function buildIdentityPatch(organizationDoc, memberRole) {
  const organizationBasic = (organizationDoc && organizationDoc.organization_basic) || {};
  return {
    biz_role: memberRole === 'admin' ? 'org_admin' : 'org_coach',
    organization_profile: {
      orgId: String(organizationBasic.organization_id || '').trim(),
      orgName: String(organizationBasic.organization_name || '').trim(),
      memberRole,
      inviteCode: String(organizationBasic.invitation_code || '').trim(),
      joinedAt: new Date(),
      updatedAt: new Date()
    }
  };
}

/**
 * 创建机构 + 写创建者身份，一个事务原子完成。
 * @param {String} organizationCollection 已带环境前缀的机构集合名
 * @param {String} usersCollection        已带环境前缀的 users 集合名
 * @param {Object} organizationDoc        机构完整文档（必须已含 _id，用 generateOrganizationId 预生成）
 * @param {String} userId                 创建者 users 文档 _id
 * @param {String} memberRole             'admin' | 'coach'
 * @returns {Promise<{organizationId:String}>}
 */
async function createOrganizationWithIdentity(organizationCollection, usersCollection, organizationDoc, userId, memberRole) {
  const orgId = organizationDoc && organizationDoc._id;
  if (!orgId) throw new Error('organizationRepo.createOrganizationWithIdentity: organizationDoc._id 缺失（需预生成）');
  return db().runTransaction(async (tx) => {
    await tx.collection(organizationCollection).doc(orgId).set({ data: organizationDoc });
    await tx.collection(usersCollection).doc(userId).update({ data: buildIdentityPatch(organizationDoc, memberRole) });
    return { organizationId: orgId };
  });
}

/**
 * 更新机构 + 写身份，一个事务原子完成。
 * @param {String} organizationCollection 机构集合名
 * @param {String} usersCollection        users 集合名
 * @param {String} orgDocId               机构文档 _id
 * @param {Object} orgPatch               机构更新补丁
 * @param {String} userId                 users 文档 _id
 * @param {String} memberRole             'admin' | 'coach'
 * @param {Object} organizationDocForIdentity 用于构建身份补丁的机构文档（含最新 organization_basic）
 */
async function updateOrganizationWithIdentity(organizationCollection, usersCollection, orgDocId, orgPatch, userId, memberRole, organizationDocForIdentity) {
  return db().runTransaction(async (tx) => {
    await tx.collection(organizationCollection).doc(orgDocId).update({ data: orgPatch });
    await tx.collection(usersCollection).doc(userId).update({ data: buildIdentityPatch(organizationDocForIdentity, memberRole) });
  });
}

module.exports = {
  generateOrganizationId,
  buildIdentityPatch,
  createOrganizationWithIdentity,
  updateOrganizationWithIdentity
};
