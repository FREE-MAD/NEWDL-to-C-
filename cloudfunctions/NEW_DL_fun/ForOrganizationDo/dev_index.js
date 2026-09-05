const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const path = require('path')

cloud.init({ env: 'cloud1-6gh7jgl8c5b16a83' })

const db = cloud.database()
const ORGANIZATION_COLLECTION_BASE = 'organization'
const USER_COLLECTION_BASE = 'users'
// 调整（2026-09-04）：原先把 runtimeSource 硬编码成 'dev_index.js'，导致同步脚本生成 true_index.js 后，
// 云端明明执行 true_index.js，日志却仍显示 dev_index.js，误判为「新代码已生效」（本次 DIY Logo 不生效即由此掩盖）。
// 改为按实际入口文件名动态取值：dev_index.js 显示 dev_index.js，同步后的 true_index.js 显示 true_index.js。
const CURRENT_RUNTIME_SOURCE = path.basename(__filename)
let CURRENT_ENV_VERSION = 'develop'

function getCollectionPrefix() {
  return CURRENT_ENV_VERSION === 'develop' ? 'NDLdev_' : 'NDLreal_'
}

function getCollectionName(baseName) {
  return `${getCollectionPrefix()}${baseName}`
}

// 新增运行环境日志：用于快速判断当前机构云函数这次按什么环境、什么源码文件在执行
function logRuntimeEnvInfo(extra = {}) {
  console.log('[runtime_env]', {
    functionName: 'ForOrganizationDo',
    runtimeSource: CURRENT_RUNTIME_SOURCE,
    envVersion: CURRENT_ENV_VERSION,
    collectionPrefix: getCollectionPrefix(),
    ...extra
  })
}

// 新增邀请码前缀标准化：前几位只允许英文或数字，并统一转为大写
function normalizeInvitePrefix(prefix = '') {
  return String(prefix || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8)
}

// 新增邀请码标准化：教练加入机构时统一收口成 16 位大写英数字符
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

function buildMemberItem(userDoc = {}, openid = '', memberRole = 'coach') {
  return {
    openid,
    user_id: String(userDoc._id || '').trim(),
    nickname: String(userDoc.nickname || '').trim(),
    avatarUrl: String(userDoc.avatarUrl || '').trim(),
    phone: normalizePhone(userDoc.phone || ''),
    member_role: memberRole,
    joined_at: new Date(),
    status: 'active'
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

async function updateUserOrganizationProfile(usersCollectionName = '', userDoc = {}, organizationDoc = {}, memberRole = 'coach') {
  const organizationBasic = organizationDoc.organization_basic || {}
  await db.collection(usersCollectionName).doc(userDoc._id).update({
    data: {
      biz_role: memberRole === 'admin' ? 'org_admin' : 'org_coach',
      organization_profile: {
        orgId: String(organizationBasic.organization_id || '').trim(),
        orgName: String(organizationBasic.organization_name || '').trim(),
        memberRole,
        inviteCode: String(organizationBasic.invitation_code || '').trim(),
        joinedAt: new Date(),
        updatedAt: new Date()
      }
    }
  })
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
  if (!invitePrefix) {
    return { status: 'fail', message: '请填写邀请码前缀' }
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
  const invitationCode = await buildUniqueInvitationCode(invitePrefix, organizationCollectionName)
  const adminItem = buildMemberItem(userDoc, openid, 'admin')
  const now = new Date()
  const organizationDoc = {
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

  // 新增：捕获 DB add 返回值，取 _id（docId）用于与 NEWDL_ResponseQRCode 日志里的 docId 对账，
  // 确认「创建时写入的文档」和「生成二维码时读取的文档」是同一条。
  const addRes = await db.collection(organizationCollectionName).add({
    data: organizationDoc
  })

  // 新增（诊断日志 - DIY 字段落库核对 3/3）：写 DB 成功后打印一次，确认这次创建没有抛异常且字段已在内存里存在。
  // 若后续 NEWDL_ResponseQRCode 仍显示 orgBasicTopKeys 里没有 diy_qrcode_image，则问题不在 ForOrganizationDo，
  // 而是 DB add 返回成功但实际没持久化 / 读到了冷数据。
  console.log('[ForOrganizationDo][INFO] createOrganization.create_ok', {
    organizationId,
    docId: addRes && addRes._id ? addRes._id : '',
    organizationName,
    invitationCode: String(invitationCode || '').slice(0, 8) + '...',
    diyFieldInDoc: (organizationDoc.organization_basic.diy_qrcode_image || '').slice(0, 60),
    collection: organizationCollectionName,
  })

  await updateUserOrganizationProfile(usersCollectionName, userDoc, organizationDoc, 'admin')

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

  const currentOrganizationProfile = getCurrentOrganizationProfile(userDoc)
  if (String(currentOrganizationProfile.memberRole || '').trim() !== 'admin') {
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

  if (!isCurrentUserAdmin) {
    return {
      status: 'fail',
      message: '当前账号不是该机构管理层，不能修改机构资料'
    }
  }

  const organizationBasicInput = event.organization_basic || {}
  const organizationName = String(organizationBasicInput.organization_name || '').trim()
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

  if (!organizationName) {
    return { status: 'fail', message: '请填写机构名称' }
  }
  if (!isValidPhone(contactPhone)) {
    return { status: 'fail', message: '请填写正确的机构联系电话' }
  }

  // 调整（区块二 PendingSupplement 门控）：这里保持强制校验手机号 —— 补充信息保存（第二区解锁后）必须留联系方式。
  // 注意：nextOrganizationBasic 通过展开旧 organization_basic 再覆盖白名单字段实现，
  // 区块一（Oncegenerated_cannotbemodified）字段 organization_name 仍随表单原值回写（前端只读不变），
  // invitation_prefix / invitation_code / diy_qrcode_image 均不在覆盖名单里，生成后天然不可修改。
  // 补充（2026-09-04）：diy_qrcode_image 例外 —— 旧值为空时允许一次性补传（见上方 existingDiyQrcodeImage 逻辑），
  // 仅用于修复 DIY 功能上线前创建的老机构无 Logo 问题；已补传过（旧值非空）依旧不可修改。
  const nextOrganizationBasic = {
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
    brand_swiper_images: brandSwiperImages,
    updated_at: new Date()
  }

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
  const updateRes = await db.collection(organizationCollectionName).doc(organizationDoc._id).update({
    data: {
      organization_basic: nextOrganizationBasic
    }
  })

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
    organization_basic: nextOrganizationBasic
  }

  await updateUserOrganizationProfile(usersCollectionName, userDoc, nextOrganizationDoc, 'admin')

  return {
    status: 'success',
    message: '机构信息修改成功',
    organizationId: String(nextOrganizationBasic.organization_id || '').trim(),
    organizationName: String(nextOrganizationBasic.organization_name || '').trim(),
    invitationCode: String(nextOrganizationBasic.invitation_code || '').trim(),
    memberRole: 'admin',
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
  if (invitationCode.length !== 16) {
    return {
      status: 'fail',
      message: '机构邀请码必须是 16 位'
    }
  }

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
    await updateUserOrganizationProfile(usersCollectionName, userDoc, organizationDoc, 'coach')
    return {
      status: 'success',
      message: '你已经加入该机构',
      organizationId: String((((organizationDoc || {}).organization_basic || {}).organization_id) || '').trim(),
      organizationName: String((((organizationDoc || {}).organization_basic || {}).organization_name) || '').trim(),
      invitationCode,
      memberRole: 'coach',
      joinedAt: new Date()
    }
  }

  const nextCoachList = coachList.concat(buildMemberItem(userDoc, openid, 'coach'))
  const nextOrganizationDoc = {
    ...organizationDoc,
    organization_basic: {
      ...(organizationDoc.organization_basic || {}),
      updated_at: new Date()
    },
    organization_member: {
      admin_list: adminList,
      coach_list: nextCoachList
    }
  }

  await db.collection(organizationCollectionName).doc(organizationDoc._id).update({
    data: {
      organization_basic: nextOrganizationDoc.organization_basic,
      organization_member: nextOrganizationDoc.organization_member
    }
  })

  await updateUserOrganizationProfile(usersCollectionName, userDoc, nextOrganizationDoc, 'coach')

  return {
    status: 'success',
    message: '邀请码校验通过，你已成为机构执行教练',
    organizationId: String((((organizationDoc || {}).organization_basic || {}).organization_id) || '').trim(),
    organizationName: String((((organizationDoc || {}).organization_basic || {}).organization_name) || '').trim(),
    invitationCode,
    memberRole: 'coach',
    joinedAt: new Date()
  }
}

// 云函数入口函数
exports.main = async (event = {}, context) => {
  try {
    CURRENT_ENV_VERSION = event.envVersion || 'develop'
    const wxContext = cloud.getWXContext()
    const openid = wxContext.OPENID || ''
    logRuntimeEnvInfo({
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
}
