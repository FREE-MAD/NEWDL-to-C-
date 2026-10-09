/**
 * _db.js —— 订单域数据访问层（唯一 db 句柄 + 集合名 + 查询/写库收口）
 *
 * 从 dev_index.js 抽出的「会碰 db」的函数：getCollectionName、findOrder、
 * 用户/机构查询、机构权限校验、机构课程索引回写，以及会查库判重的码生成函数
 * （isMCodeOccupied / generateUniqueMCode / generateOrgSequenceMCode）。
 *
 * 依赖方向：_db → {_constants, _common, _shared/runtime, _shared/collections}。
 * 被 _sync / _state / _lesson / dev_index 依赖。本层禁止依赖 _sync/_state/_lesson/dev_index。
 */

const { dbHandle, currentIsDev } = require('./_shared/runtime')
const { normalizeCollectionName } = require('./_shared/collections')
const {
  ORDER_COLLECTION_BASE,
  USER_COLLECTION_BASE,
  ORGANIZATION_COLLECTION_BASE,
  M_CODE_PREFIX_FROM_A,
  M_CODE_PREFIX_FROM_B,
  M_CODE_GENERATE_MAX_RETRY,
  ORG_M_CODE_SOURCE_SUFFIX_FROM_B
} = require('./_constants')
const {
  normalizeInviteCode,
  normalizeOrderOrganizationInfo,
  buildMCandidate,
  buildOrgCodePrefix,
  formatOrgMCodeSeq
} = require('./_common')

const db = dbHandle()
const _ = db.command

function getCollectionName(baseName) {
  return normalizeCollectionName(baseName, currentIsDev())
}

// ---------------------------------------------------------------------------
// M 码生成（会查库判重）
// ---------------------------------------------------------------------------

// 新增：判断某个 M 码是否已占用；覆盖所有会展示给用户的课程码字段。
async function isMCodeOccupied(collectionName, mCode) {
  if (!collectionName || !mCode) {
    return true
  }
  try {
    const res = await db.collection(collectionName)
      .where(_.or([
        { joinCode: mCode },
        { courseCode: mCode },
        { parent_course_code: mCode }
      ]))
      .limit(1)
      .count()
    return (Number(res && res.total) || 0) > 0
  } catch (err) {
    // 异常保守处理：宁可视为占用，也不要重复写；后面再触发重试。
    console.warn('[m_code] isMCodeOccupied fallback true:', err && err.message)
    return true
  }
}

// 新增：生成唯一 8 位 M 码。prefix 传 A 或 B 对应 fromA / fromB。
async function generateUniqueMCode(collectionName, prefix) {
  if (!collectionName) {
    throw new Error('缺少集合名，无法生成唯一 M 码')
  }
  const safePrefix = String(prefix || '').trim().toUpperCase().slice(0, 1)
  if (safePrefix !== M_CODE_PREFIX_FROM_A && safePrefix !== M_CODE_PREFIX_FROM_B) {
    throw new Error('M 码前缀非法，必须为 A 或 B')
  }
  for (let i = 0; i < M_CODE_GENERATE_MAX_RETRY; i += 1) {
    const candidate = buildMCandidate(safePrefix)
    const occupied = await isMCodeOccupied(collectionName, candidate)
    if (!occupied) {
      return candidate
    }
  }
  const fallback = buildMCandidate(safePrefix)
  console.warn('[m_code] generateUniqueMCode fallback after max retry', { prefix: safePrefix, fallback })
  return fallback
}

// 新增（2026-09-16）：生成机构口径的唯一课程码 = 机构代码前 4 位 + 序号 + 小写来源后缀 b。
async function generateOrgSequenceMCode(collectionName, invitationCode = '') {
  const orgPrefix = buildOrgCodePrefix(invitationCode)
  const safeInviteCode = normalizeInviteCode(invitationCode)
  if (!collectionName || !orgPrefix || !safeInviteCode) {
    return ''
  }

  let seq = 1
  try {
    const countRes = await db.collection(collectionName)
      .where({ m_code_org_invite: safeInviteCode })
      .count()
    seq = (Number(countRes && countRes.total) || 0) + 1
  } catch (err) {
    console.warn('[m_code] generateOrgSequenceMCode count failed, start from 0001:', err && err.message)
    seq = 1
  }

  for (let i = 0; i < M_CODE_GENERATE_MAX_RETRY; i += 1) {
    const candidate = `${orgPrefix}${formatOrgMCodeSeq(seq, orgPrefix)}${ORG_M_CODE_SOURCE_SUFFIX_FROM_B}`
    const occupied = await isMCodeOccupied(collectionName, candidate)
    if (!occupied) {
      return candidate
    }
    seq += 1
  }

  console.warn('[m_code] generateOrgSequenceMCode conflict after max retry', {
    orgPrefix,
    inviteCode: safeInviteCode,
  })
  return ''
}

// ---------------------------------------------------------------------------
// 用户 / 机构查询
// ---------------------------------------------------------------------------

async function getCurrentUserDocByOpenid(openid = '') {
  const usersCollection = getCollectionName(USER_COLLECTION_BASE)
  const res = await db.collection(usersCollection).where({ openid }).limit(1).get()
  return Array.isArray(res.data) && res.data.length ? res.data[0] : null
}

async function getOrganizationDocByOrgId(orgId = '') {
  const safeOrgId = String(orgId || '').trim()
  if (!safeOrgId) {
    return null
  }

  const organizationCollection = getCollectionName(ORGANIZATION_COLLECTION_BASE)
  const res = await db.collection(organizationCollection).where({
    'organization_basic.organization_id': safeOrgId
  }).limit(1).get()

  return Array.isArray(res.data) && res.data.length ? res.data[0] : null
}

// 新增邀请码命中：B 侧转单过来时，优先按 inviteCode 绑定到机构 owner。
async function getOrganizationDocByInviteCode(inviteCode = '') {
  const safeInviteCode = normalizeInviteCode(inviteCode)
  if (!safeInviteCode) {
    return null
  }

  const organizationCollection = getCollectionName(ORGANIZATION_COLLECTION_BASE)
  const res = await db.collection(organizationCollection).where({
    'organization_basic.invitation_code': safeInviteCode
  }).limit(1).get()

  return Array.isArray(res.data) && res.data.length ? res.data[0] : null
}

// 新增机构课程权限校验：只有机构管理层才能以机构身份创建或修改机构课程
async function ensureOrganizationPublishPermission(orderOrgInfo = {}, openid = '') {
  const safeOrderOrgInfo = normalizeOrderOrganizationInfo(orderOrgInfo)
  if (!safeOrderOrgInfo.orgId) {
    return { orderOrgInfo: safeOrderOrgInfo, organizationDoc: null }
  }

  const userDoc = await getCurrentUserDocByOpenid(openid)
  if (!userDoc) {
    return { code: 403, msg: '未找到当前用户，无法校验机构身份' }
  }

  const userOrganizationProfile = normalizeOrderOrganizationInfo(userDoc.organization_profile || {})
  if (!userOrganizationProfile.orgId || userOrganizationProfile.orgId !== safeOrderOrgInfo.orgId) {
    return { code: 403, msg: '你当前不属于该机构，不能创建机构课程' }
  }

  if (userOrganizationProfile.memberRole !== 'admin') {
    return { code: 403, msg: '仅机构管理层可创建或修改机构课程' }
  }

  const organizationDoc = await getOrganizationDocByOrgId(safeOrderOrgInfo.orgId)
  if (!organizationDoc) {
    return { code: 404, msg: '机构不存在或已失效' }
  }

  const organizationBasic = organizationDoc.organization_basic || {}
  return {
    orderOrgInfo: {
      orgId: safeOrderOrgInfo.orgId,
      orgName: safeOrderOrgInfo.orgName || String(organizationBasic.organization_name || '').trim(),
      memberRole: 'admin',
      inviteCode: safeOrderOrgInfo.inviteCode || String(organizationBasic.invitation_code || '').trim()
    },
    organizationDoc
  }
}

// 新增机构课程索引回写：课程创建成功后，把 orderId 追加到机构文档的 class_id_list 中
async function appendOrderIdToOrganizationClass(orderOrgInfo = {}, orderId = '', organizationDoc = null) {
  const safeOrderOrgInfo = normalizeOrderOrganizationInfo(orderOrgInfo)
  const safeOrderId = String(orderId || '').trim()
  if (!safeOrderOrgInfo.orgId || !safeOrderId) {
    return
  }

  const targetOrganizationDoc = organizationDoc || await getOrganizationDocByOrgId(safeOrderOrgInfo.orgId)
  if (!targetOrganizationDoc) {
    return
  }

  const organizationBasic = targetOrganizationDoc.organization_basic || {}
  const organizationClass = targetOrganizationDoc.organization_class || {}
  const currentClassIdList = Array.isArray(organizationClass.class_id_list)
    ? organizationClass.class_id_list
    : []

  if (currentClassIdList.includes(safeOrderId)) {
    return
  }

  await db.collection(getCollectionName(ORGANIZATION_COLLECTION_BASE)).doc(targetOrganizationDoc._id).update({
    data: {
      organization_basic: {
        ...organizationBasic,
        updated_at: new Date()
      },
      organization_class: {
        ...organizationClass,
        class_id_list: currentClassIdList.concat(safeOrderId)
      }
    }
  })
}

// ---------------------------------------------------------------------------
// 订单读取
// ---------------------------------------------------------------------------

async function findOrder(orderId) {
  const collections = [getCollectionName(ORDER_COLLECTION_BASE)]
  for (const c of collections) {
    try {
      const res = await db.collection(c).doc(orderId).get()
      if (res.data) {
        return { data: res.data, collection: c, ref: db.collection(c).doc(orderId) }
      }
    } catch (e) {}
  }
  return { data: null, collection: null, ref: null }
}

module.exports = {
  db,
  _,
  getCollectionName,
  isMCodeOccupied,
  generateUniqueMCode,
  generateOrgSequenceMCode,
  getCurrentUserDocByOpenid,
  getOrganizationDocByOrgId,
  getOrganizationDocByInviteCode,
  ensureOrganizationPublishPermission,
  appendOrderIdToOrganizationClass,
  findOrder
}
