



// ===== deploy-meta:start =====
// 关键字段登记（2026-10-10）：本部署单元「是哪一侧 / 环境固定为什么 / 源目录是谁」全部登记在这一块。
// 环境已由「部署哪个函数」物理固定（D_ = develop，T_ = real），业务代码不再读请求判断环境，一律以本块为准。
// 不可覆写：sync-dev-to-true.js 每次同步都会强制覆写 T_ 侧本块 —— D_ 源里的值到不了 T_，手改 T_ 也会在下一次同步被覆盖。
const DEPLOY_META = Object.freeze({
  side: 'D',                 // 'D' = 开发版部署单元；'T' = 正式版部署单元
  envVersion: 'develop',     // 固定环境：'develop'（NDLdev_）| 'release'（代表 real，NDLreal_）
  isDev: true,               // = envVersion === 'develop' 的预计算值，业务代码直接用，不再做 === 'develop' 判断
  sourceDir: 'D_ForOrganizationDo',      // 源目录（T_ 侧登记它镜像的 D_ 目录名；仅排查用）
  managedBy: 'sync-dev-to-true.js'
});
// ===== deploy-meta:end =====

const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const path = require('path')

// 调整（2026-10-08）：cloud.init / 集合名 / 运行日志 / 出向 HTTP 统一走公共层 _shared（源在 NEW_DL_fun/_shared/，副本只读）。
const { initRuntime, dbHandle, runInContext, currentIsDev, currentEnvVersion } = require('./_shared/runtime')
const { normalizeCollectionName, prefix } = require('./_shared/collections')
const { make: makeLogger } = require('./_shared/logger')
const { ENDPOINTS, postJson } = require('./_shared/http')
// 调整（2026-10-09）：users 集合写入口收口到 userRepo（源在 _shared/repos/userRepo.js，副本只读）。
const userRepo = require('./_shared/repos/userRepo')
// 调整（2026-10-09）：organization 集合「写机构 + 写身份」两笔收口到 organizationRepo 一个事务。
const orgRepo = require('./_shared/repos/organizationRepo')

const db = dbHandle()
const ORGANIZATION_COLLECTION_BASE = 'organization'
const USER_COLLECTION_BASE = 'users'
// 集合前缀规则已下沉到 _shared/collections.js（develop → NDLdev_，trial/release → NDLreal_）。
// 调整（2026-10-08）：环境不再存模块级变量 —— 改由 _shared/runtime.js 的请求上下文提供。
// main 里用 runInContext(ctx, ...) 包裹后，任意深度的调用都能通过 currentIsDev() 读到本次请求的
// envVersion，并发请求互不干扰（AsyncLocalStorage 可用时；不可用则退化为现状，见 runtime.js 注释）。
function getCollectionPrefix() {
  return prefix(currentIsDev())
}

function getCollectionName(baseName) {
  return normalizeCollectionName(baseName, currentIsDev())
}

// 新增邀请码前缀标准化：前几位只允许英文或数字，并统一转为大写
// 调整（2026-09-05）：邀请码改为完全自定义，本函数现在负责标准化「完整邀请码」，
// 长度上限从 8 位放宽到 16 位（与前端输入过滤、加入侧 normalizeInvitationCode 截断长度保持一致）
// 调整（2026-09-16）：机构码构建规则修改为只允许英文——本函数不再放行数字，自动大写与 16 位上限不变；
// 注意：加入侧 normalizeInvitationCode 保持英数兼容不改动，历史已创建的含数字邀请码仍可正常加入
function normalizeInvitePrefix(prefix = '') {
  return String(prefix || '').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 16)
}

// 新增邀请码标准化：教练加入机构时统一收口成 16 位大写英数字符
// 调整（2026-09-05）：邀请码改为完全自定义（1-16 位均可），本函数保留英数过滤 + 大写 + 最长 16 位截断不变，
// 仅不再要求必须凑满 16 位
function normalizeInvitationCode(code = '') {
  return String(code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 16)
}

// 新增手机号标准化：机构联系方式统一收口成 11 位纯数字
function normalizePhone(phone = '') {
  return String(phone || '').replace(/\D/g, '').slice(0, 11)
}

function normalizeFileIdList(fileIdList = [], maxCount = 5) {
  if (!Array.isArray(fileIdList)) {
    return []
  }

  return fileIdList
    .map(item => String(item || '').trim())
    .filter(item => item)
    .slice(0, maxCount)
}

function isValidPhone(phone = '') {
  return /^1[3-9]\d{9}$/.test(normalizePhone(phone))
}

function buildHexString(length = 0) {
  if (!length) {
    return ''
  }

  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length).toUpperCase()
}

// 新增机构邀请码生成：前缀由用户决定，后续位数由系统用 16 进制随机串补足到 16 位
// 调整（2026-09-05）：邀请码改为完全自定义后本函数不再被调用（保留函数与注释按约定不删除），
// 创建机构改用下方 ensureUniqueCustomInvitationCode 对用户输入的完整邀请码做唯一性校验
async function buildUniqueInvitationCode(invitePrefix = '', organizationCollectionName = '') {
  const safePrefix = normalizeInvitePrefix(invitePrefix)
  const remainLength = Math.max(16 - safePrefix.length, 0)

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const invitationCode = `${safePrefix}${buildHexString(remainLength)}`
    const existed = await db.collection(organizationCollectionName).where({
      'organization_basic.invitation_code': invitationCode
    }).limit(1).get()

    if (!Array.isArray(existed.data) || !existed.data.length) {
      return invitationCode
    }
  }

  throw new Error('邀请码生成失败，请稍后重试')
}

// 新增（2026-09-05）完全自定义邀请码唯一性校验：用户输入什么就落什么（不做任何补齐），
// 唯一要求即「全局唯一」—— 按完整邀请码精确查重，已被占用直接报错让机构换一个；
// 抛错由外层 main 统一捕获转 fail 返回，前端展示 message
async function ensureUniqueCustomInvitationCode(invitationCode = '', organizationCollectionName = '') {
  const existed = await db.collection(organizationCollectionName).where({
    'organization_basic.invitation_code': invitationCode
  }).limit(1).get()

  if (Array.isArray(existed.data) && existed.data.length) {
    throw new Error('该邀请码已被其他机构使用，请更换一个')
  }
}

function buildOrganizationId() {
  return `org_${Date.now().toString(16)}${buildHexString(8).toLowerCase()}`
}

function getProfileSecurityStatus(userDoc = {}) {
  const review = userDoc.profile_security_review || {}
  return String(review.status || '').trim()
}

// 新增教练认证校验：创建机构和教练加入机构都必须先完成资料认证
function ensureCertifiedCoach(userDoc = {}) {
  const role = String(userDoc.role || userDoc.userRole || '').trim()
  const securityStatus = getProfileSecurityStatus(userDoc)
  if (role && role !== 'C') {
    throw new Error('只有教练身份可以进行机构操作')
  }
  if (securityStatus !== 'approved') {
    throw new Error('请先完成教练资料认证并审核通过')
  }
}

function buildMemberItem(userDoc = {}, openid = '', memberRole = 'coach', staffRole = '') {
  return {
    openid,
    user_id: String(userDoc._id || '').trim(),
    nickname: String(userDoc.nickname || '').trim(),
    avatarUrl: String(userDoc.avatarUrl || '').trim(),
    phone: normalizePhone(userDoc.phone || ''),
    member_role: memberRole,
    // 新增机构成员身份（主教 / 副教练 / 指导 / 训练分析 / 自填文本），随成员项一起入库
    staff_role: staffRole,
    joined_at: new Date(),
    status: 'active'
  }
}

// ===== 新增机构成员身份（staff_role）处理（2026-09-05） =====
// 身份是「人在机构里」的属性，只归属机构：入库 NDLdev_organization 的
// organization_member.admin_list / coach_list 成员项，不写入 NDLdev_users。
const STAFF_ROLE_PRESET_LIST = ['head_coach', 'assistant_coach', 'instructor', 'training_analyst']
const STAFF_ROLE_CUSTOM = 'custom'

// 新增身份标准化：预设枚举原样落库；custom 取用户自填文本；不认识的选项统一丢弃返回空串
function normalizeStaffRole(staffRole = '', staffRoleCustom = '') {
  const safeStaffRole = String(staffRole || '').trim()
  const safeCustom = String(staffRoleCustom || '').trim().slice(0, 20)
  if (safeStaffRole === STAFF_ROLE_CUSTOM) {
    return safeCustom || ''
  }
  return STAFF_ROLE_PRESET_LIST.indexOf(safeStaffRole) >= 0 ? safeStaffRole : ''
}

// 新增成员身份写入：只改当前用户在机构成员列表里的那一条，其余成员原样保留
function applyStaffRoleToMemberList(organizationMember = {}, openid = '', staffRole = '') {
  const adminList = Array.isArray(organizationMember.admin_list) ? organizationMember.admin_list : []
  const coachList = Array.isArray(organizationMember.coach_list) ? organizationMember.coach_list : []
  const isSameMember = (item) => String((item && item.openid) || '').trim() === openid
  const matchedAdmin = adminList.some(isSameMember)
  const matchedCoach = !matchedAdmin && coachList.some(isSameMember)

  return {
    admin_list: matchedAdmin
      ? adminList.map((item) => (isSameMember(item) ? { ...item, staff_role: staffRole } : item))
      : adminList,
    coach_list: matchedCoach
      ? coachList.map((item) => (isSameMember(item) ? { ...item, staff_role: staffRole } : item))
      : coachList,
    changed: matchedAdmin || matchedCoach
  }
}

// 新增成员身份读取：从成员列表里取当前用户已保存的 staff_role，随返回体带回前端回填
function readStaffRoleFromMemberList(organizationMember = {}, openid = '') {
  const adminList = Array.isArray(organizationMember.admin_list) ? organizationMember.admin_list : []
  const coachList = Array.isArray(organizationMember.coach_list) ? organizationMember.coach_list : []
  const memberItem = adminList.concat(coachList).find(
    (item) => String((item && item.openid) || '').trim() === openid
  )
  return String((memberItem && memberItem.staff_role) || '').trim()
}

// ===== 新增加入身份（管理 / 执行）与加入审核（2026-09-21） =====
// B 教练加入时把「身份选择」从原来的岗位文案（主教 / 副教练 / 指导 / 训练分析 / 自填）换成
// 「管理 / 执行」两项：管理 → 同意后进 admin_list（团队管理层）；执行 → 同意后进 coach_list（团队执行教练）。
// 调整（2026-09-21）：教练提交加入后不再直接入库成员列表 —— 先写入 organization_member.pending_list
// 置为 pending，由机构创建者（管理层）在「团队管理」页点「同意」后才正式写入对应成员列表，
// 并同步更新申请人 users 文档的 biz_role / organization_profile；点「拒绝」则标记 rejected 留在列表里，
// 前端据此提示「申请未通过，可重新提交」（重新提交会把该条重置回 pending）。
const MEMBER_ROLE_ADMIN = 'admin'
const MEMBER_ROLE_COACH = 'coach'
const JOIN_APPLY_STATUS_PENDING = 'pending'
const JOIN_APPLY_STATUS_REJECTED = 'rejected'
// 加入审核决策：approve（同意）/ reject（拒绝）
const JOIN_DECISION_APPROVE = 'approve'
const JOIN_DECISION_REJECT = 'reject'

// 新增加入身份标准化：只有显式传 admin 才是管理层，其余（含空值 / 老版本未传）一律按执行教练处理
function normalizeJoinRole(joinRole = '') {
  return String(joinRole || '').trim() === MEMBER_ROLE_ADMIN ? MEMBER_ROLE_ADMIN : MEMBER_ROLE_COACH
}

// 新增加入待审列表读取：老机构文档没有 pending_list 字段，这里统一兜底成空数组
function getPendingApplyList(organizationMember = {}) {
  return Array.isArray(organizationMember.pending_list) ? organizationMember.pending_list : []
}

// 新增加入待审项构造：快照申请人昵称 / 头像 / 手机号，管理层审批时无需再回查 users 即可展示
function buildPendingApplyItem(userDoc = {}, openid = '', joinRole = MEMBER_ROLE_COACH, staffRole = '') {
  return {
    openid,
    user_id: String(userDoc._id || '').trim(),
    nickname: String(userDoc.nickname || '').trim(),
    avatarUrl: String(userDoc.avatarUrl || '').trim(),
    phone: normalizePhone(userDoc.phone || ''),
    // 申请的身份：管理 / 执行，同意后决定进 admin_list 还是 coach_list
    join_role: normalizeJoinRole(joinRole),
    // 兼容老版本收集的自填身份文本（B 侧已不再收集，保留字段不删）
    staff_role: String(staffRole || '').trim(),
    status: JOIN_APPLY_STATUS_PENDING,
    applied_at: new Date(),
    reviewed_at: null,
    reviewed_by: '',
    review_remark: ''
  }
}

// 新增：待审项转正式成员项（同意时写入对应成员列表），沿用 buildMemberItem 的字段结构
function buildMemberItemFromApply(applyItem = {}, memberRole = MEMBER_ROLE_COACH) {
  return {
    openid: String((applyItem && applyItem.openid) || '').trim(),
    user_id: String((applyItem && applyItem.user_id) || '').trim(),
    nickname: String((applyItem && applyItem.nickname) || '').trim(),
    avatarUrl: String((applyItem && applyItem.avatarUrl) || '').trim(),
    phone: normalizePhone((applyItem && applyItem.phone) || ''),
    member_role: memberRole,
    staff_role: String((applyItem && applyItem.staff_role) || '').trim(),
    joined_at: new Date(),
    status: 'active'
  }
}

// 新增：按 openid 取该机构的待审申请（含下标，便于回填审批结果）
function findPendingApplyIndex(pendingList = [], openid = '') {
  return pendingList.findIndex((item) => String((item && item.openid) || '').trim() === openid)
}

// 新增（A 侧机构展示信息同步，2026-09-05）：机构资料 / 成员变更后静默顺推 B 侧展示信息。
// 链路：ForOrganizationDo --HTTPS POST--> 本环境 NEWDL_ResponseQRCode(syncOrganizationShow)
//       --HTTP--> B 侧 DLforP_entry_qrcode(sync_org_show) --> B 集合 dev_forPshowC。
// 调整（2026-09-06）：第一段从 cloud.callFunction 改为公网 HTTPS POST 直连 —— NEWDL_ResponseQRCode
// 部署为 HTTP 型云函数（scf_bootstrap + 监听 9000 端口），云函数间 cloud.callFunction 调它与
// 小程序端 wx.cloud.callFunction 调它走的是同一道函数类型网关，都会被拒（-501001 FunctionType
// parameter is invalid）；旧写法失败后被下方 catch 静默吞掉，导致「保存区块二 / 教练加入 / 保存身份」
// 三个自动推送点全部推不出去，B 库停在二维码生成时推的那条只有机构名 + Logo 的半成品上。
// 新写法与「B 侧云函数 HTTPS 直连 A 侧 twowaybinding」完全同款（见 B 侧 twowaybinding_1_DLforP 的 A_HTTP_BASE_URL）。
// 收口在 NEWDL_ResponseQRCode 的原因不变：B 侧 HTTP 地址、payload 组装、临时链接换取等能力都在那边，不重复实现。
// 静默约定：任何失败只打日志，不影响机构创建 / 编辑 / 教练加入主流程（下次任一触发点会幂等补推）。

// 出向地址已下沉到 _shared/http.js 的 ENDPOINTS.selfQrcode（原 A_SELF_QRCODE_HTTP_BASE_URL）：
// 域名与 B→A 调用 twowaybinding 的域名一致，访问路径即函数名；该地址不区分 develop / release——
// 同一云环境同一函数，请求体里的 envVersion 决定 HTTP 函数内部分流到 dev/true 模块。
//
// 新增（2026-09-06）：HTTPS POST JSON 调本环境 HTTP 云函数的最小封装，写法对齐 NEWDL_ResponseQRCode 的 postToBHttp。
// 返回 { success, statusCode, data }：HTTP 状态 <400 且业务体 status === 'success' 才算成功；
// 网络错误 / 超时直接 reject，由调用方静默 catch（同步失败不阻断机构操作主流程）。
// 调整（2026-10-08）：https 请求体与超时的具体实现下沉到 _shared/http.js 的 postJson，判定口径与超时（20s）不变。
function postToSelfHttp(action = '', payload = {}) {
  // 调整（2026-10-09 拆双函数）：按当前请求环境选 D_/T_ 二维码服务。
  return postJson(currentIsDev() ? ENDPOINTS.selfQrcodeD : ENDPOINTS.selfQrcodeT, { ...payload, action }, {
    timeoutMessage: '调用 A 侧二维码服务超时'
  })
}

async function pushOrgShowToB(organizationDoc = {}, remark = '') {
  try {
    const organizationId = String((((organizationDoc || {}).organization_basic || {}).organization_id) || '').trim()
    if (!organizationId) {
      console.warn('[ForOrganizationDo][WARN] pushOrgShowToB.no_orgid', { remark })
      return
    }
    // 调整（2026-09-06）：cloud.callFunction 改 HTTPS POST 直连（原因见本函数上方链路注释）。
    const httpRes = await postToSelfHttp('syncOrganizationShow', {
      // 显式带 organizationId：NEWDL_ResponseQRCode 侧按 ID 直查机构文档，
      // 避免 joinOrganization（教练身份）触发时被 admin 校验误拦；HTTP 通道没有微信身份上下文，也必须显式传。
      organizationId,
      // 透传 envVersion：HTTP 函数内按它分流 develop→dev 模块 / release→true 模块。
      // 调整（2026-10-08）：改从请求上下文读，取的是本次请求解析出的环境，不再依赖模块级变量。
      envVersion: currentEnvVersion()
    })
    console.log('[ForOrganizationDo][INFO] pushOrgShowToB.done', {
      remark,
      organizationId,
      httpStatus: httpRes.statusCode,
      resultStatus: httpRes.data ? httpRes.data.status : '',
      resultMessage: httpRes.data ? String(httpRes.data.message || '').slice(0, 160) : '',
      // 图片转存失败数量：B 侧图片没转成功但文字已落库时大于 0，下次推送会幂等重试。
      failedImageCount: httpRes.data ? httpRes.data.failedImageCount : ''
    })
    if (!httpRes.success) {
      // 业务失败（HTTP 通了但 syncOrganizationShow 返回 fail）：打 warn 便于对账，不抛错、不阻断主流程。
      console.warn('[ForOrganizationDo][WARN] pushOrgShowToB.business_fail', {
        remark,
        organizationId,
        httpStatus: httpRes.statusCode,
        resultMessage: httpRes.data ? String(httpRes.data.message || '').slice(0, 200) : ''
      })
    }
  } catch (err) {
    console.error('[ForOrganizationDo][ERROR] pushOrgShowToB.fail', {
      remark,
      message: err && err.message ? err.message : String(err)
    })
  }
}

async function getCurrentUserDoc(openid = '', usersCollectionName = '') {
  const res = await db.collection(usersCollectionName).where({ openid }).limit(1).get()
  const userDoc = Array.isArray(res.data) && res.data.length ? res.data[0] : null
  if (!userDoc) {
    throw new Error('未找到当前用户，请重新登录后重试')
  }
  return userDoc
}

function getCurrentOrganizationProfile(userDoc = {}) {
  return userDoc.organization_profile || {}
}

// 新增当前机构查询：机构管理层修改机构资料时，统一按当前用户 organization_profile 里的 orgId 反查机构
async function getCurrentOrganizationDoc(userDoc = {}, organizationCollectionName = '') {
  const currentOrganizationProfile = getCurrentOrganizationProfile(userDoc)
  const orgId = String(currentOrganizationProfile.orgId || '').trim()

  if (!orgId) {
    throw new Error('你当前还没有机构，无法修改机构资料')
  }

  const res = await db.collection(organizationCollectionName).where({
    'organization_basic.organization_id': orgId
  }).limit(1).get()
  const organizationDoc = Array.isArray(res.data) && res.data.length ? res.data[0] : null

  if (!organizationDoc) {
    throw new Error('未找到当前机构资料，请稍后重试')
  }

  // 新增（Logo 链路日志 - DB 读取快照）：本函数是 updateOrganization（含老机构「空值一次性补传」）的统一机构文档读取入口，
  // 这里打印「此刻 DB 里」的 DIY Logo 状态，与 NEWDL_ResponseQRCode 的 diy_logo.read_db 两端对账：
  // 若这里显示 hasKey=false，说明文档确实是老机构创建的；若 hasKey=true 但 valuePrefix 为空，说明字段存在但值为空串。
  const loadedOrgBasic = organizationDoc.organization_basic || {}
  console.log('[ForOrganizationDo][INFO] getCurrentOrganizationDoc.loaded', {
    docId: organizationDoc._id,
    organizationId: String(loadedOrgBasic.organization_id || '').trim(),
    orgBasicTopKeysCount: Object.keys(loadedOrgBasic).length,
    diyFieldExists: Object.prototype.hasOwnProperty.call(loadedOrgBasic, 'diy_qrcode_image'),
    diyFieldType: typeof loadedOrgBasic.diy_qrcode_image,
    diyValuePrefix: loadedOrgBasic.diy_qrcode_image
      ? String(loadedOrgBasic.diy_qrcode_image).slice(0, 50)
      : '',
  })

  return organizationDoc
}

async function createOrganization(event = {}, openid = '', usersCollectionName = '', organizationCollectionName = '') {
  const userDoc = await getCurrentUserDoc(openid, usersCollectionName)
  ensureCertifiedCoach(userDoc)

  const currentOrganizationProfile = getCurrentOrganizationProfile(userDoc)
  if (String(currentOrganizationProfile.orgId || '').trim()) {
    return {
      status: 'fail',
      message: `你已加入机构：${currentOrganizationProfile.orgName || '当前机构'}`
    }
  }

  const organizationBasicInput = event.organization_basic || {}
  const organizationName = String(organizationBasicInput.organization_name || '').trim()
  const invitePrefix = normalizeInvitePrefix(organizationBasicInput.invite_prefix)
  // 新增 DIY 二维码图片（区块一 Oncegenerated_cannotbemodified 字段）：机构上传的二维码中间 Logo（教练头像 / 品牌 Logo），
  // 创建时必填并入库 organization_basic.diy_qrcode_image，生成后不可修改（updateOrganization 不覆盖该字段）
  const diyQrcodeImage = String(organizationBasicInput.diy_qrcode_image || '').trim()
  const contactName = String(organizationBasicInput.contact_name || userDoc.nickname || '').trim()
  const contactPhone = normalizePhone(organizationBasicInput.contact_phone || userDoc.phone || '')
  const city = String(organizationBasicInput.city || '').trim()
  const address = String(organizationBasicInput.address || '').trim()
  const intro = String(organizationBasicInput.intro || '').trim()
  // 新增（2026-09-05）：品牌副标题 slogan，展示在机构首页 Hero 区机构名称下方（os-hero-subtitle）；
  // 随区块二一起收集提交并同步推 B（映射为 dev_forPshowC.show_basic.brand_slogan）
  const slogan = String(organizationBasicInput.slogan || '').trim()
  // 新增（2026-09-05）：机构展示页区块三（基本信息）四项展示字段，随区块二一起收集提交并同步推 B
  const coreServices = String(organizationBasicInput.core_services || '').trim()
  const serviceArea = String(organizationBasicInput.service_area || '').trim()
  const targetAudience = String(organizationBasicInput.target_audience || '').trim()
  const coachingPhilosophy = String(organizationBasicInput.coaching_philosophy || '').trim()
  const brandSwiperImages = normalizeFileIdList(organizationBasicInput.brand_swiper_images, 5)

  // 新增（诊断日志 - DIY 字段落库核对 1/3）：创建机构时前端到底传了哪些键、diy_qrcode_image 是什么形式、是否以 cloud:// 开头。
  // 与 NEWDL_ResponseQRCode 侧 `diy_logo.read_db` 的 orgBasicTopKeys / diyFieldRaw 两端对账，就能精确定位
  // 「前端没传 / 云函数读错路径 / 字段在组装时丢失 / DB add 被 trim」哪个环节丢了字段。
  console.log('[ForOrganizationDo][INFO] createOrganization.received_input', {
    openid: openid ? String(openid).slice(0, 10) + '...' : '',
    inputTopKeys: Object.keys(organizationBasicInput).slice(0, 20),
    diyFieldType: typeof organizationBasicInput.diy_qrcode_image,
    diyFieldRaw: organizationBasicInput.diy_qrcode_image == null
      ? '<null|undefined>'
      : String(organizationBasicInput.diy_qrcode_image),
    diyTrimmed: diyQrcodeImage,
    diyLooksValid: diyQrcodeImage.startsWith('cloud://'),
    organizationName,
    invitePrefix,
  })

  if (!organizationName) {
    return { status: 'fail', message: '请填写机构名称' }
  }
  // 调整（2026-09-05）：invitePrefix 现在承载「完整自定义邀请码」，提示文案同步更新
  if (!invitePrefix) {
    return { status: 'fail', message: '请填写自定义邀请码' }
  }
  // 新增 DIY 二维码图片必填校验：与前端区块一必填保持一致
  if (!diyQrcodeImage) {
    console.warn('[ForOrganizationDo][WARN] createOrganization.diy_qrcode_image_missing', {
      inputTopKeys: Object.keys(organizationBasicInput).slice(0, 20),
      diyFieldType: typeof organizationBasicInput.diy_qrcode_image,
    })
    return { status: 'fail', message: '请上传DIY二维码图片' }
  }
  // 调整（区块二 PendingSupplement 门控）：联系电话改为创建阶段选填 ——
  // 前端第二区在入口二维码生成后才解锁，创建时不收集联系电话；
  // 这里仅在用户确实填了手机号时校验格式，允许为空（补充信息保存时再强制校验）
  if (contactPhone && !isValidPhone(contactPhone)) {
    return { status: 'fail', message: '请填写正确的机构联系电话' }
  }

  const organizationId = buildOrganizationId()
  // 调整（2026-09-05）：邀请码完全自定义 —— 不再随机补齐 16 位，用户输入（已标准化为英数大写）直接作为最终邀请码，
  // 落库前用 ensureUniqueCustomInvitationCode 校验全局唯一，重复则整体报错不打库
  const invitationCode = invitePrefix
  await ensureUniqueCustomInvitationCode(invitationCode, organizationCollectionName)
  const adminItem = buildMemberItem(userDoc, openid, 'admin')
  const now = new Date()
  const organizationDoc = {
    // 预生成 _id：organizationRepo.createOrganizationWithIdentity 事务内用 set 建档需要稳定 _id（替代 add 自动生成）
    _id: orgRepo.generateOrganizationId(),
    organization_basic: {
      organization_id: organizationId,
      organization_name: organizationName,
      invitation_prefix: invitePrefix,
      invitation_code: invitationCode,
      // 新增入库 DIY 二维码图片 fileID（A 侧云存储）：生成入口二维码时由 NEWDL_ResponseQRCode
      // 读取并合成到二维码中间位置；生成后不可修改
      diy_qrcode_image: diyQrcodeImage,
      contact_name: contactName,
      contact_phone: contactPhone,
      city,
      address,
      intro,
      // 新增（2026-09-05）：品牌副标题 slogan，随机构文档落库（创建阶段表单未收集，先落空串，区块二保存时补齐）
      slogan,
      // 新增（2026-09-05）：区块三四项展示字段随机构文档一并落库（创建阶段表单未收集，先落空串，区块二保存时补齐）
      core_services: coreServices,
      service_area: serviceArea,
      target_audience: targetAudience,
      coaching_philosophy: coachingPhilosophy,
      brand_swiper_images: brandSwiperImages,
      owner_openid: openid,
      owner_user_id: String(userDoc._id || '').trim(),
      created_at: now,
      updated_at: now
    },
    organization_member: {
      admin_list: [adminItem],
      coach_list: []
    },
    organization_class: {
      class_id_list: []
    }
  }

  // 新增（诊断日志 - DIY 字段落库核对 2/3）：组装好 organization_basic 后写 DB 前立刻打印所有顶层键，
  // 确认 diy_qrcode_image 真正在要写入的对象里（不会在对象字面量里因为拼写、顺序或展开覆盖等原因被丢失）。
  console.log('[ForOrganizationDo][INFO] createOrganization.build_doc_ready', {
    organizationId,
    organizationBasicKeys: Object.keys(organizationDoc.organization_basic),
    hasDiyQrcodeImage: Object.prototype.hasOwnProperty.call(organizationDoc.organization_basic, 'diy_qrcode_image'),
    diyInDoc: organizationDoc.organization_basic.diy_qrcode_image
      ? String(organizationDoc.organization_basic.diy_qrcode_image).slice(0, 60)
      : '<empty>',
    diyInDocType: typeof organizationDoc.organization_basic.diy_qrcode_image,
  })

  // 调整（2026-10-09）：add(机构) + updateUserOrganizationProfile(users) 两笔独立写收口为
  // organizationRepo.createOrganizationWithIdentity 一个事务 —— 任何一笔失败整体回滚，不再产生孤儿机构。
  // add 改为「预生成 _id + 事务内 set」，事务提交前 _id 稳定（organizationDoc._id）。
  await orgRepo.createOrganizationWithIdentity(
    organizationCollectionName,
    usersCollectionName,
    organizationDoc,
    String(userDoc._id || '').trim(),
    'admin'
  )

  // 新增（诊断日志 - DIY 字段落库核对 3/3）：写 DB 成功后打印一次，确认这次创建没有抛异常且字段已在内存里存在。
  // 若后续 NEWDL_ResponseQRCode 仍显示 orgBasicTopKeys 里没有 diy_qrcode_image，则问题不在 ForOrganizationDo，
  // 而是 DB add 返回成功但实际没持久化 / 读到了冷数据。
  console.log('[ForOrganizationDo][INFO] createOrganization.create_ok', {
    organizationId,
    docId: organizationDoc._id,
    organizationName,
    invitationCode: String(invitationCode || '').slice(0, 8) + '...',
    diyFieldInDoc: (organizationDoc.organization_basic.diy_qrcode_image || '').slice(0, 60),
    collection: organizationCollectionName,
  })

  return {
    status: 'success',
    message: '机构创建成功，你已成为机构管理层',
    organizationId,
    organizationName,
    invitationCode,
    memberRole: 'admin',
    joinedAt: now
  }
}

// 新增机构资料修改：当前先支持机构管理层修改基础资料，不改邀请码和成员列表
async function updateOrganization(event = {}, openid = '', usersCollectionName = '', organizationCollectionName = '') {
  const userDoc = await getCurrentUserDoc(openid, usersCollectionName)
  ensureCertifiedCoach(userDoc)

  // 新增（2026-09-05）：不带 organization_basic 时表示只更新机构成员身份（staff_role），
  // 此时放宽到「机构成员本人」—— 执行教练也能更新自己在机构里的身份；
  // 一旦携带 organization_basic（要改机构资料），仍然必须是机构管理层
  const hasBasicInput = !!(event.organization_basic && typeof event.organization_basic === 'object')
  const currentOrganizationProfile = getCurrentOrganizationProfile(userDoc)
  if (hasBasicInput && String(currentOrganizationProfile.memberRole || '').trim() !== 'admin') {
    return {
      status: 'fail',
      message: '只有机构管理层可以修改机构资料'
    }
  }

  const organizationDoc = await getCurrentOrganizationDoc(userDoc, organizationCollectionName)
  const organizationBasic = organizationDoc.organization_basic || {}
  const organizationMember = organizationDoc.organization_member || {}
  const adminList = Array.isArray(organizationMember.admin_list) ? organizationMember.admin_list : []
  const isCurrentUserAdmin = adminList.some((item) => String(item.openid || '').trim() === openid)

  if (hasBasicInput && !isCurrentUserAdmin) {
    return {
      status: 'fail',
      message: '当前账号不是该机构管理层，不能修改机构资料'
    }
  }

  // 单独保存身份（staff_role）时前端不传 organization_basic，
  // 此时回退成 DB 现有值，basic 原样写回不覆盖，也不触发机构名称 / 联系电话校验
  const organizationBasicInput = hasBasicInput ? event.organization_basic : organizationBasic
  const organizationName = String(organizationBasicInput.organization_name || '').trim()
  // 新增机构成员身份收集：主教 / 副教练 / 指导 / 训练分析 / 自填，
  // 只写入 NDLdev_organization 的成员项 staff_role，不写入 NDLdev_users
  const staffRoleRaw = String(event.staff_role || '').trim()
  const staffRole = normalizeStaffRole(staffRoleRaw, event.staff_role_custom)
  // 新增 DIY 二维码图片「空值一次性补传」：DIY 功能上线前创建的老机构文档里没有该字段，
  // 而区块一约定生成后不可修改，导致老机构永远无法补传 Logo、入口二维码永远合成不了。
  // 折中方案：仅当旧值为空且本次传了非空值时才写入（首次补传）；已有值仍不在覆盖名单里，不可修改。
  const existingDiyQrcodeImage = String((organizationBasic.diy_qrcode_image || '')).trim()
  const incomingDiyQrcodeImage = String(organizationBasicInput.diy_qrcode_image || '').trim()
  const contactName = String(organizationBasicInput.contact_name || userDoc.nickname || '').trim()
  const contactPhone = normalizePhone(organizationBasicInput.contact_phone || userDoc.phone || '')
  const city = String(organizationBasicInput.city || '').trim()
  const address = String(organizationBasicInput.address || '').trim()
  const intro = String(organizationBasicInput.intro || '').trim()
  // 新增（2026-09-05）：品牌副标题 slogan，展示在机构首页 Hero 区机构名称下方（os-hero-subtitle）；
  // 随区块二一起收集提交并同步推 B（映射为 dev_forPshowC.show_basic.brand_slogan）
  const slogan = String(organizationBasicInput.slogan || '').trim()
  // 新增（2026-09-05）：机构展示页区块三（基本信息）四项展示字段，随区块二一起收集提交并同步推 B
  const coreServices = String(organizationBasicInput.core_services || '').trim()
  const serviceArea = String(organizationBasicInput.service_area || '').trim()
  const targetAudience = String(organizationBasicInput.target_audience || '').trim()
  const coachingPhilosophy = String(organizationBasicInput.coaching_philosophy || '').trim()
  const brandSwiperImages = normalizeFileIdList(organizationBasicInput.brand_swiper_images, 5)

  // 新增（诊断日志 - DIY 空值一次性补传核对 1/3）：老机构文档「键根本不存在」的情况下，
  // existingDiyQrcodeImage 会是 ''（因为 undefined || '' → ''），条件分支应当允许写入。
  // 这里把「DB 内原始值 / 本次传入值 / 条件判断结果」全部打出，避免日志里看不清楚「到底有没有触发补传」。
  const existingHasKey = Object.prototype.hasOwnProperty.call(organizationBasic, 'diy_qrcode_image')
  const patchEligible = !existingDiyQrcodeImage && !!incomingDiyQrcodeImage
  const patchBlockedByExisting = !!existingDiyQrcodeImage && !!incomingDiyQrcodeImage
  console.log('[ForOrganizationDo][INFO] updateOrganization.check_patch_diy_eligibility', {
    organizationId: String((organizationDoc.organization_basic || {}).organization_id || '').trim(),
    docId: organizationDoc._id,
    existingHasKey,
    existingDiyValuePrefix: existingDiyQrcodeImage ? existingDiyQrcodeImage.slice(0, 60) : '',
    incomingHasValue: !!incomingDiyQrcodeImage,
    incomingValuePrefix: incomingDiyQrcodeImage ? incomingDiyQrcodeImage.slice(0, 60) : '',
    patchEligible,
    patchBlockedByExisting,
    note: patchBlockedByExisting
      ? '本次带了值但 DB 已有值（区块一生成后不可修改）→ 忽略本次 diy 传入'
      : (patchEligible ? '满足补传条件：将写入 diy_qrcode_image' : '未触发（双方均空）'),
  })

  // 新增身份校验：选了「其他（自填）」却没填内容时直接拒绝，避免把无意义的 custom 存进机构资料
  if (staffRoleRaw === STAFF_ROLE_CUSTOM && !staffRole) {
    return { status: 'fail', message: '请填写自定义机构身份' }
  }
  // 新增空提交拦截：既没有机构资料也没有身份要改，直接返回，避免向 DB 发空 update
  if (!hasBasicInput && !staffRole) {
    return { status: 'fail', message: '没有需要更新的内容' }
  }
  if (hasBasicInput && !organizationName) {
    return { status: 'fail', message: '请填写机构名称' }
  }
  if (hasBasicInput && !isValidPhone(contactPhone)) {
    return { status: 'fail', message: '请填写正确的机构联系电话' }
  }

  // 调整（区块二 PendingSupplement 门控）：这里保持强制校验手机号 —— 补充信息保存（第二区解锁后）必须留联系方式。
  // 注意：nextOrganizationBasic 通过展开旧 organization_basic 再覆盖白名单字段实现，
  // 区块一（Oncegenerated_cannotbemodified）字段 organization_name 仍随表单原值回写（前端只读不变），
  // invitation_prefix / invitation_code / diy_qrcode_image 均不在覆盖名单里，生成后天然不可修改。
  // 补充（2026-09-04）：diy_qrcode_image 例外 —— 旧值为空时允许一次性补传（见上方 existingDiyQrcodeImage 逻辑），
  // 仅用于修复 DIY 功能上线前创建的老机构无 Logo 问题；已补传过（旧值非空）依旧不可修改。
  const nextOrganizationBasic = hasBasicInput
    ? {
      ...organizationBasic,
      organization_name: organizationName,
      // 新增：空值一次性补传 DIY 二维码图片 —— 旧值为空且本次传入非空时才落库；
      // 旧值已有时保持 ...organizationBasic 原值展开，天然不可修改（与区块一约定一致）。
      ...(existingDiyQrcodeImage ? {} : (incomingDiyQrcodeImage ? { diy_qrcode_image: incomingDiyQrcodeImage } : {})),
      contact_name: contactName,
      contact_phone: contactPhone,
      city,
      address,
      intro,
      // 新增（2026-09-05）：品牌副标题 slogan 进入覆盖白名单，随区块二保存一起落库并同步推 B
      slogan,
      // 新增（2026-09-05）：区块三四项展示字段进入覆盖白名单，随区块二保存一起落库并同步推 B
      core_services: coreServices,
      service_area: serviceArea,
      target_audience: targetAudience,
      coaching_philosophy: coachingPhilosophy,
      brand_swiper_images: brandSwiperImages,
      updated_at: new Date()
    }
    : { ...organizationBasic }

  // 新增成员身份写入（2026-09-05）：只把当前用户那一条成员项打上 staff_role，其余成员原样保留；
  // 当前用户不在成员列表里时 changed 为 false，成员结构保持不动
  const nextOrganizationMember = staffRole
    ? applyStaffRoleToMemberList(organizationMember, openid, staffRole)
    : organizationMember
  const staffRoleChanged = !!(staffRole && nextOrganizationMember.changed)
  console.log('[ForOrganizationDo][INFO] updateOrganization.staff_role', {
    organizationId: String((organizationDoc.organization_basic || {}).organization_id || '').trim(),
    docId: organizationDoc._id,
    incomingStaffRole: staffRoleRaw,
    normalizedStaffRole: staffRole,
    staffRoleChanged,
    hasBasicInput
  })

  // 新增（诊断日志 - DIY 空值一次性补传核对 2/3）：组装后写 DB 前核对 nextOrganizationBasic 里是否真的带了 diy_qrcode_image，
  // 与 NEWDL_ResponseQRCode diy_logo.read_db 的 orgBasicTopKeys 对账，看字段是否真的已落库。
  console.log('[ForOrganizationDo][INFO] updateOrganization.build_next_basic_ready', {
    organizationId: String(nextOrganizationBasic.organization_id || '').trim(),
    nextBasicKeys: Object.keys(nextOrganizationBasic),
    nextHasDiyKey: Object.prototype.hasOwnProperty.call(nextOrganizationBasic, 'diy_qrcode_image'),
    nextDiyType: typeof nextOrganizationBasic.diy_qrcode_image,
    nextDiyValuePrefix: nextOrganizationBasic.diy_qrcode_image
      ? String(nextOrganizationBasic.diy_qrcode_image).slice(0, 60)
      : '',
    patchEligible,
    // 关键断言：当 patchEligible 为 true 时，nextHasDiyKey 必须也是 true；否则说明三目条件写法有问题。
    patchAssertionOk: !patchEligible || Object.prototype.hasOwnProperty.call(nextOrganizationBasic, 'diy_qrcode_image'),
  })

  // 新增：捕获 DB update 返回值，取 stats.updated（实际更新的文档数），
  // 若为 0 说明 update 条件没匹配到文档（docId 失效/被删），此时字段自然没有落库。
  // 新增兜底：只改身份但当前用户不在机构成员列表里时无从写入，直接返回提示，
  // 避免组装出空 updateData 再向 DB 发空 update 报错
  if (!hasBasicInput && !staffRoleChanged) {
    console.warn('[ForOrganizationDo][WARN] updateOrganization.staff_role_member_not_found', {
      organizationId: String((organizationDoc.organization_basic || {}).organization_id || '').trim(),
      docId: organizationDoc._id,
      incomingStaffRole: staffRoleRaw
    })
    return { status: 'fail', message: '未找到你在该机构的成员记录，无法保存身份' }
  }

  // 新增：身份变更时把 organization_member 一起写回；只改身份时（hasBasicInput=false）
  // 不带 organization_basic，避免把未改动的机构资料重复覆盖一遍
  const updateData = hasBasicInput ? { organization_basic: nextOrganizationBasic } : {}
  if (staffRoleChanged) {
    updateData.organization_member = {
      admin_list: nextOrganizationMember.admin_list,
      coach_list: nextOrganizationMember.coach_list
    }
  }
  // 调整（2026-10-09）：hasBasicInput=true 时「写机构 + 写身份」两笔收口为一个事务（不再产生孤儿机构）；
  // hasBasicInput=false（只改 staff_role）时仍只写 organization 一笔，users 保持不动。
  let updateRes = null
  if (hasBasicInput) {
    updateRes = await orgRepo.updateOrganizationWithIdentity(
      organizationCollectionName,
      usersCollectionName,
      organizationDoc._id,
      updateData,
      String(userDoc._id || '').trim(),
      'admin',
      { organization_basic: nextOrganizationBasic }
    )
  } else {
    updateRes = await db.collection(organizationCollectionName).doc(organizationDoc._id).update({
      data: updateData
    })
  }

  // 新增（诊断日志 - DIY 空值一次性补传核对 3/3）：DB update 成功后再次确认，避免出现「云函数 update 返回 OK 但字段实际没写进去」的情况。
  console.log('[ForOrganizationDo][INFO] updateOrganization.update_ok', {
    organizationId: String(nextOrganizationBasic.organization_id || '').trim(),
    docId: organizationDoc._id,
    updatedCount: updateRes && updateRes.stats ? updateRes.stats.updated : '',
    diyFieldWritten: Object.prototype.hasOwnProperty.call(nextOrganizationBasic, 'diy_qrcode_image')
      ? String(nextOrganizationBasic.diy_qrcode_image || '').slice(0, 60)
      : '<did_not_write>',
    patchedThisTime: patchEligible,
  })

  const nextOrganizationDoc = {
    ...organizationDoc,
    organization_basic: nextOrganizationBasic,
    organization_member: {
      admin_list: nextOrganizationMember.admin_list,
      coach_list: nextOrganizationMember.coach_list
    }
  }

  // 调整（2026-10-09）：hasBasicInput=true 时的「写身份」已并入上方 orgRepo.updateOrganizationWithIdentity 事务，
  // 这里不再单独调 updateUserOrganizationProfile；hasBasicInput=false 时本就只写 organization、users 不动。

  // 新增（A 侧机构展示信息同步）：编辑保存成功后顺推 B 侧展示信息（名称/简介/地址/轮播图等可能已变更）。
  await pushOrgShowToB(nextOrganizationDoc, 'updateOrganization')

  return {
    status: 'success',
    message: hasBasicInput ? '机构信息修改成功' : '机构身份已更新',
    organizationId: String(nextOrganizationBasic.organization_id || '').trim(),
    organizationName: String(nextOrganizationBasic.organization_name || '').trim(),
    invitationCode: String(nextOrganizationBasic.invitation_code || '').trim(),
    memberRole: 'admin',
    // 新增身份回传：取成员项里当前用户最终落库的 staff_role，前端据此刷新身份选择区
    staffRole: readStaffRoleFromMemberList(nextOrganizationDoc.organization_member, openid),
    joinedAt: new Date()
  }
}

async function joinOrganization(event = {}, openid = '', usersCollectionName = '', organizationCollectionName = '') {
  const userDoc = await getCurrentUserDoc(openid, usersCollectionName)
  ensureCertifiedCoach(userDoc)

  const currentOrganizationProfile = getCurrentOrganizationProfile(userDoc)
  if (String(currentOrganizationProfile.orgId || '').trim()) {
    return {
      status: 'fail',
      message: `你已加入机构：${currentOrganizationProfile.orgName || '当前机构'}`
    }
  }

  const invitationCode = normalizeInvitationCode(event.invitation_code)
  // 调整（2026-09-05）：邀请码已改为完全自定义（不再固定 16 位），这里只做非空校验；
  // 是否有效由下方按完整邀请码精确匹配机构文档决定
  if (!invitationCode) {
    return {
      status: 'fail',
      message: '请填写机构邀请码'
    }
  }

  // 调整（2026-09-21）：B 教练加入侧的身份改为「管理 / 执行」二选一 ——
  // 管理 → 同意后进 admin_list（管理层）；执行 → 同意后进 coach_list（执行教练）。
  // 原「主教 / 副教练 / 指导 / 训练分析 / 自填」的 staff_role 收集协议保留兼容（老客户端仍可传），
  // 但前端已不再展示这些选项，新提交只带 join_role。
  const staffRoleRaw = String(event.staff_role || '').trim()
  const staffRole = normalizeStaffRole(staffRoleRaw, event.staff_role_custom)
  // 选了「其他（自填）」却没填内容时直接拒绝，避免把无意义的 custom 存进机构资料
  if (staffRoleRaw === STAFF_ROLE_CUSTOM && !staffRole) {
    return {
      status: 'fail',
      message: '请填写自定义机构身份'
    }
  }
  const joinRole = normalizeJoinRole(event.join_role)
  console.log('[ForOrganizationDo][INFO] joinOrganization.role', {
    openid: openid ? String(openid).slice(0, 10) + '...' : '',
    joinRole,
    staffRole
  })

  const queryRes = await db.collection(organizationCollectionName).where({
    'organization_basic.invitation_code': invitationCode
  }).limit(1).get()

  const organizationDoc = Array.isArray(queryRes.data) && queryRes.data.length ? queryRes.data[0] : null
  if (!organizationDoc) {
    return {
      status: 'fail',
      message: '邀请码无效，请检查后重试'
    }
  }

  // 新增（Logo 链路日志）：加入机构时打印该机构文档的 DIY Logo 状态快照。
  // joinOrganization 会把 organization_basic 原样透传（展开保留 diy_qrcode_image），
  // 这里留痕可确认教练加入的机构是否有 Logo，避免「加入后前端看不到 Logo」时无从对账。
  const joinOrgBasic = organizationDoc.organization_basic || {}
  console.log('[ForOrganizationDo][INFO] joinOrganization.org_doc_loaded', {
    docId: organizationDoc._id,
    organizationId: String(joinOrgBasic.organization_id || '').trim(),
    organizationName: String(joinOrgBasic.organization_name || '').trim(),
    diyFieldExists: Object.prototype.hasOwnProperty.call(joinOrgBasic, 'diy_qrcode_image'),
    diyFieldType: typeof joinOrgBasic.diy_qrcode_image,
    diyFileIdLooksValid: String(joinOrgBasic.diy_qrcode_image || '').startsWith('cloud://'),
  })

  const organizationMember = organizationDoc.organization_member || {}
  const adminList = Array.isArray(organizationMember.admin_list) ? organizationMember.admin_list : []
  const coachList = Array.isArray(organizationMember.coach_list) ? organizationMember.coach_list : []
  const alreadyAdmin = adminList.some((item) => String(item.openid || '').trim() === openid)
  const alreadyCoach = coachList.some((item) => String(item.openid || '').trim() === openid)

  if (alreadyAdmin) {
    return {
      status: 'fail',
      message: '你已经是该机构管理层'
    }
  }

  if (alreadyCoach) {
    // 新增身份更新：已经在机构里的教练再次提交时（多半是回来改身份），
    // 只更新 coach_list 里自己那一条的 staff_role，机构资料与其他成员不动
    const nextOrganizationMember = staffRole
      ? applyStaffRoleToMemberList(organizationMember, openid, staffRole)
      : organizationMember

    // 调整（2026-10-09）：改身份时「写机构成员 + 写 users 身份」两笔收口为一个事务（不再产生孤儿）；
    // 只重复提交（无 staffRole 变更）时仅写 users 身份一笔，保持幂等。
    if (staffRole && nextOrganizationMember.changed) {
      await orgRepo.updateOrganizationWithIdentity(
        organizationCollectionName,
        usersCollectionName,
        organizationDoc._id,
        {
          organization_member: {
            admin_list: nextOrganizationMember.admin_list,
            coach_list: nextOrganizationMember.coach_list
          }
        },
        String(userDoc._id || '').trim(),
        'coach',
        organizationDoc
      )
    } else {
      await userRepo.updateUserDoc(usersCollectionName, userDoc._id, orgRepo.buildIdentityPatch(organizationDoc, 'coach'))
    }
    return {
      status: 'success',
      message: staffRole ? '你的机构身份已更新' : '你已经加入该机构',
      organizationId: String((((organizationDoc || {}).organization_basic || {}).organization_id) || '').trim(),
      organizationName: String((((organizationDoc || {}).organization_basic || {}).organization_name) || '').trim(),
      invitationCode,
      memberRole: 'coach',
      staffRole: readStaffRoleFromMemberList(nextOrganizationMember, openid),
      joinedAt: new Date()
    }
  }

  // 调整（2026-09-21）：新教练提交加入 → 不再直接入库成员列表，先写入 organization_member.pending_list
  // 置为 pending，等待机构创建者（管理层）在「团队管理」页确认。
  // 期间不改动申请人 users 文档的 biz_role / organization_profile，也不推 B 侧展示信息
  //（成员列表尚未变化，正式同意后才由 reviewJoinRequest 统一处理）。
  const pendingList = getPendingApplyList(organizationMember)
  const existingApplyIndex = findPendingApplyIndex(pendingList, openid)
  const now = new Date()

  let nextPendingList = []
  let isReapply = false
  if (existingApplyIndex >= 0) {
    // 重复提交（含被拒绝后重新提交）：原地更新这一条的申请身份与快照，重置为待确认
    isReapply = true
    nextPendingList = pendingList.map((item, index) => (
      index === existingApplyIndex
        ? {
          ...item,
          user_id: String(userDoc._id || '').trim(),
          nickname: String(userDoc.nickname || '').trim(),
          avatarUrl: String(userDoc.avatarUrl || '').trim(),
          phone: normalizePhone(userDoc.phone || ''),
          join_role: joinRole,
          staff_role: staffRole,
          status: JOIN_APPLY_STATUS_PENDING,
          applied_at: now,
          reviewed_at: null,
          reviewed_by: '',
          review_remark: ''
        }
        : item
    ))
  } else {
    nextPendingList = pendingList.concat(buildPendingApplyItem(userDoc, openid, joinRole, staffRole))
  }

  await db.collection(organizationCollectionName).doc(organizationDoc._id).update({
    data: {
      organization_member: {
        admin_list: adminList,
        coach_list: coachList,
        pending_list: nextPendingList
      }
    }
  })

  console.log('[ForOrganizationDo][INFO] joinOrganization.pending_created', {
    docId: organizationDoc._id,
    organizationId: String(joinOrgBasic.organization_id || '').trim(),
    joinRole,
    isReapply,
    pendingCount: nextPendingList.filter((item) => String((item && item.status) || '').trim() === JOIN_APPLY_STATUS_PENDING).length
  })

  return {
    status: 'success',
    // 新增待审标记：前端据此不写本地机构身份、不跳机构首页，停留展示「等待创建者确认」
    joinStatus: JOIN_APPLY_STATUS_PENDING,
    message: isReapply ? '已重新提交加入申请，等待团队创建者确认' : '加入申请已提交，等待团队创建者确认',
    organizationId: String(joinOrgBasic.organization_id || '').trim(),
    organizationName: String(joinOrgBasic.organization_name || '').trim(),
    invitationCode,
    // 申请的身份（管理 / 执行）：同意后即成为该身份；待审期间不生效
    memberRole: joinRole,
    joinRole,
    staffRole,
    appliedAt: now
  }
}

// 新增（2026-09-21）：机构管理层处理教练加入申请（同意 / 拒绝）。
// 入口：pages/organization/organization_admin/organization_admin（团队管理页）。
// 权限：只有该机构 admin_list 里的成员（机构创建者 / 管理层）可以操作，执行教练点了直接拒绝。
// 同意：按申请身份写入 admin_list / coach_list → 更新申请人 users 文档（biz_role + organization_profile）
//       → 顺推 B 侧展示信息（成员列表变化）；待审条目从 pending_list 移除。
// 拒绝：待审条目标记 rejected 保留在 pending_list，申请人前端据此提示「未通过，可重新提交」。
async function reviewJoinRequest(event = {}, openid = '', usersCollectionName = '', organizationCollectionName = '') {
  const userDoc = await getCurrentUserDoc(openid, usersCollectionName)

  // 目标机构：优先按前端显式传的 organization_id 定位；未传时用审批人自己归属的机构
  const targetOrganizationId = String(event.organization_id || event.organizationId || '').trim()
  let organizationDoc = null
  if (targetOrganizationId) {
    const queryRes = await db.collection(organizationCollectionName).where({
      'organization_basic.organization_id': targetOrganizationId
    }).limit(1).get()
    organizationDoc = Array.isArray(queryRes.data) && queryRes.data.length ? queryRes.data[0] : null
    if (!organizationDoc) {
      return { status: 'fail', message: '未找到对应机构，请刷新后重试' }
    }
  } else {
    organizationDoc = await getCurrentOrganizationDoc(userDoc, organizationCollectionName)
  }

  const organizationMember = organizationDoc.organization_member || {}
  const adminList = Array.isArray(organizationMember.admin_list) ? organizationMember.admin_list : []
  const coachList = Array.isArray(organizationMember.coach_list) ? organizationMember.coach_list : []
  const isReviewerAdmin = adminList.some((item) => String((item && item.openid) || '').trim() === openid)
  if (!isReviewerAdmin) {
    return { status: 'fail', message: '只有团队管理层可以处理加入申请' }
  }

  const applyOpenid = String(event.apply_openid || '').trim()
  const decision = String(event.decision || '').trim()
  if (!applyOpenid) {
    return { status: 'fail', message: '缺少申请成员标识' }
  }
  if (decision !== JOIN_DECISION_APPROVE && decision !== JOIN_DECISION_REJECT) {
    return { status: 'fail', message: '审核动作无效，请刷新后重试' }
  }

  const pendingList = getPendingApplyList(organizationMember)
  const applyIndex = findPendingApplyIndex(pendingList, applyOpenid)
  if (applyIndex < 0) {
    return { status: 'fail', message: '未找到该加入申请，可能已被处理' }
  }

  const applyItem = pendingList[applyIndex] || {}
  const applyStatus = String(applyItem.status || JOIN_APPLY_STATUS_PENDING).trim()
  if (applyStatus !== JOIN_APPLY_STATUS_PENDING) {
    return { status: 'fail', message: '该申请已处理，请下拉刷新后重试' }
  }

  const now = new Date()
  const joinRole = normalizeJoinRole(applyItem.join_role)
  const organizationId = String(((organizationDoc.organization_basic || {}).organization_id) || '').trim()

  // 拒绝：只改这一条待审项的状态，成员列表与申请人 users 文档都不动
  if (decision === JOIN_DECISION_REJECT) {
    const nextPendingList = pendingList.map((item, index) => (
      index === applyIndex
        ? {
          ...item,
          status: JOIN_APPLY_STATUS_REJECTED,
          reviewed_at: now,
          reviewed_by: openid,
          review_remark: String(event.review_remark || '').trim().slice(0, 60)
        }
        : item
    ))

    await db.collection(organizationCollectionName).doc(organizationDoc._id).update({
      data: {
        organization_member: {
          admin_list: adminList,
          coach_list: coachList,
          pending_list: nextPendingList
        }
      }
    })

    console.log('[ForOrganizationDo][INFO] reviewJoinRequest.rejected', {
      organizationId,
      applyOpenid: applyOpenid.slice(0, 10) + '...',
      joinRole
    })

    return {
      status: 'success',
      decision: JOIN_DECISION_REJECT,
      message: '已拒绝该成员的加入申请',
      organizationId,
      applyOpenid
    }
  }

  // 同意：先防重 —— 该 openid 已经在某个成员列表里就直接结束，避免重复入库
  const isSameMember = (item) => String((item && item.openid) || '').trim() === applyOpenid
  if (adminList.some(isSameMember) || coachList.some(isSameMember)) {
    const nextPendingList = pendingList.filter((item, index) => index !== applyIndex)
    await db.collection(organizationCollectionName).doc(organizationDoc._id).update({
      data: {
        organization_member: {
          admin_list: adminList,
          coach_list: coachList,
          pending_list: nextPendingList
        }
      }
    })
    return { status: 'fail', message: '该成员已经在团队里了，请刷新列表' }
  }

  const memberItem = buildMemberItemFromApply(applyItem, joinRole)
  const nextAdminList = joinRole === MEMBER_ROLE_ADMIN ? adminList.concat(memberItem) : adminList
  const nextCoachList = joinRole === MEMBER_ROLE_ADMIN ? coachList : coachList.concat(memberItem)
  // 同意后该条待审项出列（不再留在 pending_list），申请人前端靠「已在成员列表里」判定加入成功
  const nextPendingList = pendingList.filter((item, index) => index !== applyIndex)

  const nextOrganizationDoc = {
    ...organizationDoc,
    organization_member: {
      admin_list: nextAdminList,
      coach_list: nextCoachList,
      pending_list: nextPendingList
    }
  }

  // 申请人 users 文档：写 biz_role（org_admin / org_coach）与 organization_profile，
  // 这一步做完对方下次进入机构页才会真正切换到机构身份
  const applicantUserDoc = await getCurrentUserDoc(applyOpenid, usersCollectionName)

  // 调整（2026-10-09）：审批同意时「写机构成员 + 写申请人身份」两笔收口为一个事务（不再产生孤儿成员）。
  await orgRepo.updateOrganizationWithIdentity(
    organizationCollectionName,
    usersCollectionName,
    organizationDoc._id,
    { organization_member: nextOrganizationDoc.organization_member },
    String((applicantUserDoc && applicantUserDoc._id) || applyOpenid || '').trim(),
    joinRole,
    nextOrganizationDoc
  )

  // 成员列表变化 → 顺推 B 侧家长端展示信息（与 joinOrganization 同一推送点，幂等覆盖）
  await pushOrgShowToB(nextOrganizationDoc, 'reviewJoinRequest.approve')

  console.log('[ForOrganizationDo][INFO] reviewJoinRequest.approved', {
    organizationId,
    applyOpenid: applyOpenid.slice(0, 10) + '...',
    joinRole,
    adminCount: nextAdminList.length,
    coachCount: nextCoachList.length,
    pendingCount: nextPendingList.length
  })

  return {
    status: 'success',
    decision: JOIN_DECISION_APPROVE,
    message: joinRole === MEMBER_ROLE_ADMIN
      ? '已同意，该成员已成为团队管理层'
      : '已同意，该成员已成为团队执行教练',
    organizationId,
    organizationName: String(((organizationDoc.organization_basic || {}).organization_name) || '').trim(),
    applyOpenid,
    memberRole: joinRole,
    joinedAt: now
  }
}

// 云函数入口函数
exports.main = async (event = {}, context) => {
  // 公共层：一次 initRuntime 拿到本次请求的 env / db / openid / traceId
  // 环境来自部署侧登记（deploy-meta）：D_ 恒 develop、T_ 恒 release，不再读调用方透传的 envVersion
  const ctx = initRuntime(Object.assign({}, event, { envVersion: DEPLOY_META.envVersion }))
  // 请求上下文包裹（2026-10-08）：把后续整条 await 链绑定到本次请求的 env，
  // 深层 helper 里的 getCollectionName 通过 currentIsDev() 读到的就是本次请求的环境。
  // 注：包裹块内的缩进沿用了包裹前的层次，未整体重排 —— 为的是把 diff 压到最小、便于逐行核对。
  return await runInContext(ctx, async () => {
  try {
    const openid = ctx.openid
    makeLogger(ctx).runtimeEnv({
      action: event.action || '',
      hasOpenid: !!openid
    })
    if (!openid) {
      return {
        status: 'fail',
        message: '未获取到用户身份，请重新登录'
      }
    }

    const usersCollectionName = getCollectionName(USER_COLLECTION_BASE)
    const organizationCollectionName = getCollectionName(ORGANIZATION_COLLECTION_BASE)

    if (event.action === 'createOrganization') {
      return await createOrganization(event, openid, usersCollectionName, organizationCollectionName)
    }

    if (event.action === 'joinOrganization') {
      return await joinOrganization(event, openid, usersCollectionName, organizationCollectionName)
    }

    if (event.action === 'updateOrganization') {
      return await updateOrganization(event, openid, usersCollectionName, organizationCollectionName)
    }

    // 新增（2026-09-21）：机构管理层处理教练加入申请（同意 / 拒绝），见 reviewJoinRequest 函数注释
    if (event.action === 'reviewJoinRequest') {
      return await reviewJoinRequest(event, openid, usersCollectionName, organizationCollectionName)
    }

    return {
      status: 'fail',
      message: '不支持的机构操作'
    }
  } catch (error) {
    // 新增（Logo 链路日志 - 异常留痕）：之前 catch 静默把异常转成 fail 返回，云函数日志里毫无痕迹，
    // 「Logo 落库中途抛错（DB 权限 / 字段异常）」这种问题完全无法定位。现在补 ERROR 级日志含堆栈。
    console.error('[ForOrganizationDo][ERROR] main.uncaught_exception', {
      action: (event && event.action) || '',
      message: error && error.message ? error.message : String(error),
      stack: error && error.stack ? String(error.stack).slice(0, 800) : ''
    })
    return {
      status: 'fail',
      message: error && error.message ? error.message : '机构操作失败'
    }
  }
  }) // ← runInContext 包裹结束
}
