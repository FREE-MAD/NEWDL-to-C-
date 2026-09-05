// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({ env:'cloud1-6gh7jgl8c5b16a83' }) // 使用当前云环境
const db = cloud.database()

// 新增集合前缀规则：develop 使用 NDLdev_，trial/release 使用 NDLreal_
const CURRENT_RUNTIME_SOURCE = 'dev_index.js'
let CURRENT_ENV_VERSION = 'develop'

function getCollectionPrefix() {
  return CURRENT_ENV_VERSION === 'develop' ? 'NDLdev_' : 'NDLreal_'
}

function getCollectionName(baseName) {
  return `${getCollectionPrefix()}${baseName}`
}

// 新增运行环境日志：用于快速判断当前资料云函数这次按什么环境、什么源码文件在执行
function logRuntimeEnvInfo(extra = {}) {
  console.log('[runtime_env]', {
    functionName: 'NEWDL_mine_user',
    runtimeSource: CURRENT_RUNTIME_SOURCE,
    envVersion: CURRENT_ENV_VERSION,
    collectionPrefix: getCollectionPrefix(),
    ...extra
  })
}

// 新增资料分享日志读取：用户档案里单独维护资料分享访问轨迹，结构与课程 share_visibility.entry_logs 保持接近
function getProfileShareVisibility(userDoc = {}) {
  const profileShareVisibility = userDoc.profile_share_visibility || {}
  const entryLogs = Array.isArray(profileShareVisibility.entry_logs)
    ? profileShareVisibility.entry_logs
    : []

  return {
    ...profileShareVisibility,
    entry_logs: entryLogs
  }
}

// 新增资料分享日志组装：和订单 entry_logs 一样保留 from / page / pageMode / sharerOpenid / viewerOpenid / createdAt
function buildProfileShareEntryLog(openid = '', viewerDoc = {}, shareLog = {}, appid = '') {
  return {
    createdAt: new Date(),
    from: typeof shareLog.from === 'string' ? shareLog.from.trim() : 'share',
    page: typeof shareLog.page === 'string' ? shareLog.page.trim() : 'profile_edit',
    pageMode: typeof shareLog.pageMode === 'string' ? shareLog.pageMode.trim() : 'share_viewer',
    sharerOpenid: typeof shareLog.sharerOpenid === 'string' ? shareLog.sharerOpenid.trim() : '',
    viewerOpenid: openid,
    viewerUserId: String((viewerDoc && viewerDoc._id) || '').trim(),
    extra: {
      sourcePage: typeof shareLog.sourcePage === 'string' ? shareLog.sourcePage.trim() : 'share',
      clientAppId: typeof shareLog.clientAppId === 'string' ? shareLog.clientAppId.trim() : '',
      pagePath: typeof shareLog.pagePath === 'string' ? shareLog.pagePath.trim() : '/pages/profile/edit/edit',
      enteredAt: typeof shareLog.enteredAt === 'string' ? shareLog.enteredAt.trim() : '',
      appid: typeof appid === 'string' ? appid.trim() : ''
    }
  }
}

// 新增手机号标准化：资料页联系电话统一收口成 11 位纯数字，避免历史分隔符或空格混入
function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').slice(0, 11)
}

// 新增手机号格式校验：资料页联系电话必须是中国大陆 11 位手机号
function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(normalizePhone(phone))
}

// 新增资料文本标准化：统一去掉输入前后空格，避免昵称等字段被空白字符卡住保存
function normalizeProfile(profile = {}) {
  return {
    avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl.trim() : '',
    nickname: typeof profile.nickname === 'string' ? profile.nickname.trim() : '',
    phone: normalizePhone(profile.phone),
    gender: typeof profile.gender === 'string' ? profile.gender.trim() : '',
    experienceLevel: typeof profile.experienceLevel === 'string' ? profile.experienceLevel.trim() : '',
    studentCountLevel: typeof profile.studentCountLevel === 'string' ? profile.studentCountLevel.trim() : '',
    city: typeof profile.city === 'string' ? profile.city.trim() : '',
    address: typeof profile.address === 'string' ? profile.address.trim() : '',
    basicPhotoProof: typeof profile.basicPhotoProof === 'string' ? profile.basicPhotoProof.trim() : '',
    aboutMe: typeof profile.aboutMe === 'string' ? profile.aboutMe.trim() : '',
    workExperience: typeof profile.workExperience === 'string' ? profile.workExperience.trim() : '',
    education: typeof profile.education === 'string' ? profile.education.trim() : '',
    educationPhotoProof: typeof profile.educationPhotoProof === 'string' ? profile.educationPhotoProof.trim() : '',
    skills: typeof profile.skills === 'string' ? profile.skills.trim() : '',
    languages: typeof profile.languages === 'string' ? profile.languages.trim() : '',
    honors: typeof profile.honors === 'string' ? profile.honors.trim() : '',
    relatedCertificates: typeof profile.relatedCertificates === 'string' ? profile.relatedCertificates.trim() : '',
    honorShowcase: typeof profile.honorShowcase === 'string' ? profile.honorShowcase.trim() : ''
  }
}

// 新增图片类型识别：头像和资料佐证图统一按文件后缀推断 MIME，方便内容安全接口识别
function guessImageContentType(fileID = '') {
  const lowerFileId = String(fileID || '').toLowerCase()
  if (lowerFileId.endsWith('.png')) {
    return 'image/png'
  }
  if (lowerFileId.endsWith('.webp')) {
    return 'image/webp'
  }
  if (lowerFileId.endsWith('.gif')) {
    return 'image/gif'
  }
  return 'image/jpeg'
}

// 新增多块资料解析：把证书/荣誉字段中的 JSON 字符串转成结构化数组，便于分别提取文本和图片
function parseMultiBlockValue(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue
  }

  const text = String(rawValue || '').trim()
  if (!text) {
    return []
  }

  try {
    const parsedValue = JSON.parse(text)
    return Array.isArray(parsedValue) ? parsedValue : []
  } catch (error) {
    return []
  }
}

// 新增资料文本提取：把需要发布给家长看的文本内容统一收口到内容安全校验列表中
function collectProfileTextList(profile = {}) {
  const textList = [
    profile.nickname,
    profile.experienceLevel,
    profile.studentCountLevel,
    profile.city,
    profile.address,
    profile.aboutMe,
    profile.workExperience,
    profile.education,
    profile.skills,
    profile.languages,
    profile.honors
  ]

  parseMultiBlockValue(profile.relatedCertificates).forEach((item) => {
    textList.push(item && item.content)
  })

  parseMultiBlockValue(profile.honorShowcase).forEach((item) => {
    textList.push(item && item.content)
  })

  return textList
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

// 新增资料图片提取：头像、教育佐证、证书佐证、荣誉佐证统一纳入图片安全检测
function collectProfileImageList(profile = {}) {
  const imageList = [
    profile.avatarUrl,
    profile.basicPhotoProof,
    profile.educationPhotoProof
  ]

  parseMultiBlockValue(profile.relatedCertificates).forEach((item) => {
    imageList.push(item && item.proof)
  })

  parseMultiBlockValue(profile.honorShowcase).forEach((item) => {
    imageList.push(item && item.proof)
  })

  return [...new Set(
    imageList
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )]
}

// 新增内容安全结果判断：兼容 openapi 新旧返回结构，统一按 suggest 是否为 pass 判断
function isSecurityCheckPassed(checkResult) {
  const errorCode = Number(
    checkResult && (checkResult.errCode || checkResult.errcode || 0)
  )
  if (errorCode === 0) {
    return true
  }

  const suggest = checkResult && checkResult.result && checkResult.result.suggest
    ? checkResult.result.suggest
    : checkResult && checkResult.suggest
  return suggest === 'pass'
}

// 新增内容违规错误识别：微信安全接口命中违规内容时，统一拦截为通用提示
function isSecurityViolationError(error) {
  if (!error) {
    return false
  }

  const errorCode = Number(error.errCode || error.errcode || error.code || 0)
  const errorMessage = String(error.errMsg || error.errmsg || error.message || '')
  return errorCode === 87014 || /risky|block|违规|违法|敏感/.test(errorMessage)
}

// 新增权限缺失识别：资料云函数如果缺少云调用权限，统一输出可读报错方便继续定位
function isOpenAPIPermissionError(error) {
  if (!error) {
    return false
  }

  const errorCode = Number(error.errCode || error.errcode || error.code || 0)
  const errorMessage = String(error.errMsg || error.errmsg || error.message || '')
  return errorCode === -604101 || /has no permission to call this api/i.test(errorMessage)
}

// 新增图片超限识别：图片安全接口超出内容大小上限时，统一转成用户能直接看懂的提示
function isImageSizeLimitError(error) {
  if (!error) {
    return false
  }

  const errorCode = Number(error.errCode || error.errcode || error.code || 0)
  const errorMessage = String(error.errMsg || error.errmsg || error.message || '')
  return errorCode === 45002 || /content size out of limit/i.test(errorMessage)
}

// 新增独立日志集合说明：当前资料分享访问记录不再单独落独立集合，统一写入 users 文档字段中维护
// function isCollectionNotFoundError(error) {
//   if (!error) {
//     return false
//   }
//
//   const errorCode = Number(error.errCode || error.errcode || error.code || 0)
//   const errorMessage = String(error.errMsg || error.errmsg || error.message || '')
//   return errorCode === -502005 || /Db or Table not exist|collection not exists/i.test(errorMessage)
// }

// 新增安全通过结果封装：资料保存链路统一按 safe / message 结构返回，便于前端直接展示
function buildSafeResult(extra = {}) {
  return {
    safe: true,
    message: '内容检查通过',
    ...extra
  }
}

// 新增内容违规结果封装：文本或图片命中违规时统一返回现有通用提示
function buildBlockedResult(extra = {}) {
  return {
    safe: false,
    message: '您发布的内容含违规信息',
    reason: 'security_blocked',
    ...extra
  }
}

// 新增图片超限结果封装：资料图过大时直接提示压缩后再上传，减少用户反复试错
function buildImageTooLargeResult(extra = {}) {
  return {
    safe: false,
    message: '图片过大，请压缩后再上传',
    reason: 'image_too_large',
    ...extra
  }
}

// 新增文本安全检测：资料页所有可发布文本统一按资料场景进行审核
async function checkTextSecurity(content = '', openid = '') {
  const text = String(content || '').replace(/\s+/g, ' ').trim()
  if (!text) {
    return buildSafeResult({
      checkType: 'text',
      content
    })
  }

  // 新增直接云调用：资料文本审核改为在首层业务云函数内直接调用，避免二次云函数转发导致权限不生效
  try {
    const result = await cloud.openapi.security.msgSecCheck({
      content: text,
      version: 2,
      scene: 1,
      openid
    })
    if (isSecurityCheckPassed(result)) {
      return buildSafeResult({
        checkType: 'text',
        content
      })
    }
    return buildBlockedResult({
      checkType: 'text',
      content
    })
  } catch (error) {
    if (isSecurityViolationError(error)) {
      return buildBlockedResult({
        checkType: 'text',
        content
      })
    }
    if (isOpenAPIPermissionError(error)) {
      throw new Error('NEWDL_mine_user 缺少 OpenAPI 权限，请重新上传云函数并确认 config.json 已生效')
    }
    throw error
  }
}

// 新增图片安全检测：资料页图片统一下载为 Buffer 后走微信图片安全接口
async function checkImageSecurity(fileID = '') {
  const trimmedFileId = String(fileID || '').trim()
  if (!trimmedFileId) {
    return buildSafeResult({
      checkType: 'image',
      fileID
    })
  }

  // 新增直接云调用：资料图片审核改为在首层业务云函数内直接调用，避免二次云函数转发导致权限不生效
  try {
    const downloadResult = await cloud.downloadFile({
      fileID: trimmedFileId
    })
    const result = await cloud.openapi.security.imgSecCheck({
      media: {
        contentType: guessImageContentType(trimmedFileId),
        value: downloadResult.fileContent
      }
    })
    if (isSecurityCheckPassed(result)) {
      return buildSafeResult({
        checkType: 'image',
        fileID: trimmedFileId
      })
    }
    return buildBlockedResult({
      checkType: 'image',
      fileID: trimmedFileId
    })
  } catch (error) {
    if (isSecurityViolationError(error)) {
      return buildBlockedResult({
        checkType: 'image',
        fileID: trimmedFileId
      })
    }
    if (isImageSizeLimitError(error)) {
      return buildImageTooLargeResult({
        checkType: 'image',
        fileID: trimmedFileId,
        errCode: Number(error.errCode || error.errcode || error.code || 0),
        errMsg: String(error.errMsg || error.errmsg || error.message || '')
      })
    }
    if (isOpenAPIPermissionError(error)) {
      throw new Error('NEWDL_mine_user 缺少 OpenAPI 权限，请重新上传云函数并确认 config.json 已生效')
    }
    throw error
  }
}

// 新增资料发布安全校验：保存资料前统一审核当前资料里的文本和图片，避免漏掉任意发布入口
async function validateProfileSecurity(profile = {}, openid = '') {
  const textList = collectProfileTextList(profile)
  for (let index = 0; index < textList.length; index += 1) {
    const textResult = await checkTextSecurity(textList[index], openid)
    if (!textResult.safe) {
      return {
        ...textResult,
        checkType: 'profile_text',
        failedTextIndex: index,
        failedText: textList[index]
      }
    }
  }

  const imageList = collectProfileImageList(profile)
  for (let index = 0; index < imageList.length; index += 1) {
    const imageResult = await checkImageSecurity(imageList[index])
    if (!imageResult.safe) {
      return {
        ...imageResult,
        checkType: 'profile_image',
        failedImageIndex: index,
        failedImage: imageList[index]
      }
    }
  }

  return buildSafeResult({
    checkType: 'profile',
    textCount: textList.length,
    imageCount: imageList.length
  })
}

// 新增用户资料提取：把数据库里的用户文档整理成前端页面直接可用的资料结构
function buildProfile(userDoc = {}) {
  const profileDetail = userDoc.profile_detail || {}
  return {
    avatarUrl: userDoc.avatarUrl || '',
    nickname: userDoc.nickname || '',
    phone: userDoc.phone || '',
    // 新增性别：资料页基础信息区收集，用于未上传照片时决定默认教练头像
    gender: userDoc.gender || '',
    experienceLevel: userDoc.experienceLevel || '',
    studentCountLevel: userDoc.studentCountLevel || '',
    city: userDoc.city || '',
    address: userDoc.address || '',
    basicPhotoProof: profileDetail.basicPhotoProof || '',
    aboutMe: profileDetail.aboutMe || '',
    workExperience: profileDetail.workExperience || '',
    education: profileDetail.education || '',
    educationPhotoProof: profileDetail.educationPhotoProof || '',
    skills: profileDetail.skills || '',
    languages: profileDetail.languages || '',
    honors: profileDetail.honors || '',
    relatedCertificates: profileDetail.relatedCertificates || '',
    honorShowcase: profileDetail.honorShowcase || ''
  }
}

// 新增资料审核状态兜底：前端统一读取 pending / approved / rejected，避免每次自己猜字段结构
function getProfileSecurityReview(userDoc = {}) {
  const review = userDoc.profile_security_review || {}
  return {
    status: typeof review.status === 'string' ? review.status.trim() : '',
    reason: typeof review.reason === 'string' ? review.reason.trim() : '',
    message: typeof review.message === 'string' ? review.message.trim() : '',
    checkType: typeof review.checkType === 'string' ? review.checkType.trim() : '',
    failedTextIndex: typeof review.failedTextIndex === 'number' ? review.failedTextIndex : -1,
    failedImageIndex: typeof review.failedImageIndex === 'number' ? review.failedImageIndex : -1,
    lastSubmittedAt: review.lastSubmittedAt || null,
    updatedAt: review.updatedAt || null
  }
}

// 新增资料审核状态空值：分享查看别人资料时仍返回统一结构，避免前端自己补默认值
function buildEmptyProfileSecurityReview() {
  return {
    status: '',
    reason: '',
    message: '',
    checkType: '',
    failedTextIndex: -1,
    failedImageIndex: -1,
    lastSubmittedAt: null,
    updatedAt: null
  }
}

// 新增资料待审状态：保存资料或头像后先标记为待审核，前端可立即提示“已保存，后台检测中”
function buildPendingProfileSecurityReview(extra = {}) {
  return {
    status: 'pending',
    reason: '',
    message: '资料已保存，图片正在后台检测',
    checkType: '',
    failedTextIndex: -1,
    failedImageIndex: -1,
    lastSubmittedAt: new Date(),
    updatedAt: new Date(),
    ...extra
  }
}

// 新增资料通过状态：后台审核通过后统一回写 approved，便于后续分享页或资料页扩展展示
function buildApprovedProfileSecurityReview(extra = {}) {
  return {
    status: 'approved',
    reason: '',
    message: '资料检测通过',
    checkType: 'profile',
    failedTextIndex: -1,
    failedImageIndex: -1,
    updatedAt: new Date(),
    ...extra
  }
}

// 新增资料驳回状态：后台审核未通过时把失败类型和索引一起回写，方便后端和前端共同定位
function buildRejectedProfileSecurityReview(extra = {}) {
  return {
    status: 'rejected',
    reason: typeof extra.reason === 'string' ? extra.reason : 'security_blocked',
    message: typeof extra.message === 'string' ? extra.message : '资料检测未通过',
    checkType: typeof extra.checkType === 'string' ? extra.checkType : '',
    failedTextIndex: typeof extra.failedTextIndex === 'number' ? extra.failedTextIndex : -1,
    failedImageIndex: typeof extra.failedImageIndex === 'number' ? extra.failedImageIndex : -1,
    updatedAt: new Date(),
    ...extra
  }
}

// 新增后台资料审核：读取当前最新资料后慢慢检查，再把 true / false 结果回写到 users 文档
async function runProfileSecurityReview(usersCollection, openid = '', reviewProfile = null) {
  const latestUserDoc = await getCurrentUserDoc(usersCollection, openid)
  if (!latestUserDoc) {
    return {
      status: 'fail',
      message: '未找到当前用户资料'
    }
  }

  // 新增审核资料来源：优先使用前端单独上传的超小审核图，没有时再回退到数据库里的原资料
  const latestProfile = reviewProfile && typeof reviewProfile === 'object'
    ? normalizeProfile(reviewProfile)
    : buildProfile(latestUserDoc)
  const securityResult = await validateProfileSecurity(latestProfile, openid)
  const reviewData = securityResult.safe
    ? buildApprovedProfileSecurityReview({
      textCount: typeof securityResult.textCount === 'number' ? securityResult.textCount : 0,
      imageCount: typeof securityResult.imageCount === 'number' ? securityResult.imageCount : 0
    })
    : buildRejectedProfileSecurityReview({
      reason: securityResult.reason || '',
      message: securityResult.message || '资料检测未通过',
      checkType: securityResult.checkType || '',
      failedTextIndex: typeof securityResult.failedTextIndex === 'number' ? securityResult.failedTextIndex : -1,
      failedImageIndex: typeof securityResult.failedImageIndex === 'number' ? securityResult.failedImageIndex : -1
    })

  await db.collection(usersCollection).doc(latestUserDoc._id || openid).update({
    data: {
      openid,
      updatedAt: new Date(),
      profile_security_review: reviewData
    }
  })

  return {
    status: 'success',
    review: reviewData
  }
}

// 新增当前用户选档：优先命中 _id=openid 的标准档案，兼容旧数据继续按 openid 字段回查
function pickUserDoc(userDocs = [], openid = '') {
  const validDocs = userDocs.filter(item => !!item)
  if (!validDocs.length) {
    return null
  }

  const standardDoc = validDocs.find(item => item._id === openid)
  if (standardDoc) {
    return standardDoc
  }

  return validDocs.sort((a, b) => {
    const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime()
    const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime()
    return bTime - aTime
  })[0]
}

// 新增用户读取兜底：兼容一人一档新结构和历史 openid 查询结构
async function getCurrentUserDoc(usersCollection, openid) {
  let standardDoc = null
  try {
    const standardRes = await db.collection(usersCollection).doc(openid).get()
    standardDoc = standardRes && standardRes.data ? standardRes.data : null
  } catch (error) {
    standardDoc = null
  }

  const queryRes = await db.collection(usersCollection).where({ openid }).get()
  return pickUserDoc([standardDoc].concat(queryRes.data || []), openid)
}

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { OPENID, APPID, UNIONID } = wxContext
  const { action = 'getStats', profile = {}, reviewProfile = null, shareLog = {}, targetOpenid = '', envVersion = 'develop' } = event || {}
  CURRENT_ENV_VERSION = envVersion
  logRuntimeEnvInfo({
    action,
    targetOpenid: String(targetOpenid || '').trim(),
    hasOpenid: !!OPENID
  })
  const usersCollection = getCollectionName('users')
  // 新增资料分享访问日志落点说明：不再使用独立集合，统一写入 users.profile_share_visibility.entry_logs
  const shareVisitLogsCollection = getCollectionName('profile_share_visit_logs')

  if (!OPENID) {
    return {
      status: 'fail',
      message: '未获取到 openid'
    }
  }

  try {
    // 新增统一查当前用户：优先读取 _id=openid 的标准档案，同时兼容旧结构
    const userDoc = await getCurrentUserDoc(usersCollection, OPENID)

    if (action === 'getProfile') {
      // 新增资料分享读取：分享查看时允许按 sharerOpenid 读取被分享教练资料，避免误回退成访客自己的空资料
      const normalizedTargetOpenid = String(targetOpenid || '').trim()
      const profileOwnerOpenid = normalizedTargetOpenid || OPENID
      const targetUserDoc = profileOwnerOpenid === OPENID
        ? (userDoc || {})
        : await getCurrentUserDoc(usersCollection, profileOwnerOpenid)

      if (profileOwnerOpenid !== OPENID && !targetUserDoc) {
        return {
          status: 'fail',
          message: '分享资料不存在或已删除'
        }
      }

      return {
        status: 'success',
        profile: buildProfile(targetUserDoc || {}),
        // 新增审核状态隔离：查看别人资料时不返回对方审核细节，只保留统一空结构给前端兜底
        securityReview: profileOwnerOpenid === OPENID
          ? getProfileSecurityReview(targetUserDoc || {})
          : buildEmptyProfileSecurityReview(),
        profileOwnerOpenid,
        isSharedProfile: profileOwnerOpenid !== OPENID
      }
    }

    if (action === 'submitProfileSecurityReview') {
      return await runProfileSecurityReview(usersCollection, OPENID, reviewProfile)
    }

    if (action === 'logSharedProfileView') {
      // 新增分享访问归属修正：资料分享访问日志应该落到“分享者本人”的资料档案里，而不是访客自己的 users 文档
      const sharerOpenid = typeof shareLog.sharerOpenid === 'string' ? shareLog.sharerOpenid.trim() : ''
      if (!sharerOpenid) {
        return {
          status: 'fail',
          message: '缺少分享者 openid，无法记录分享访问日志'
        }
      }

      const sharerUserDoc = await getCurrentUserDoc(usersCollection, sharerOpenid)
      if (!sharerUserDoc) {
        return {
          status: 'fail',
          message: '未找到分享者资料，无法记录分享访问日志'
        }
      }

      // 新增分享访问入库：资料分享访问记录只写入分享者 users.profile_share_visibility.entry_logs，不再写独立集合
      const profileShareEntryLog = buildProfileShareEntryLog(OPENID, userDoc || {}, shareLog, APPID || '')
      // 新增独立集合停用说明：shareVisitLogsCollection 变量暂保留，避免影响同文件其他上下文；资料分享日志主写入已收口到 users 文档
      void shareVisitLogsCollection

      const currentProfileShareVisibility = getProfileShareVisibility(sharerUserDoc || {})
      const nextProfileShareVisibility = {
        ...currentProfileShareVisibility,
        entry_logs: currentProfileShareVisibility.entry_logs.concat(profileShareEntryLog)
      }

      await db.collection(usersCollection).doc(sharerUserDoc._id || sharerOpenid).update({
        data: {
          openid: sharerOpenid,
          updatedAt: new Date(),
          profile_share_visibility: nextProfileShareVisibility
        }
      })

      return {
        status: 'success',
        message: '分享访问日志记录成功'
      }
    }

    if (action === 'updateProfile') {
      const normalizedProfile = normalizeProfile(profile)
      if (!normalizedProfile.nickname) {
        return {
          status: 'fail',
          message: '请填写昵称'
        }
      }
      if (!isValidPhone(normalizedProfile.phone)) {
        return {
          status: 'fail',
          message: '请填写正确的11位手机号'
        }
      }

      const updateData = {
        updatedAt: new Date(),
        openid: OPENID,
        role: 'C',
        avatarUrl: normalizedProfile.avatarUrl || '',
        nickname: normalizedProfile.nickname || '',
        phone: normalizedProfile.phone || '',
        gender: normalizedProfile.gender || '',
        experienceLevel: normalizedProfile.experienceLevel || '',
        studentCountLevel: normalizedProfile.studentCountLevel || '',
        city: normalizedProfile.city || '',
        address: normalizedProfile.address || '',
        profile_detail: {
          basicPhotoProof: normalizedProfile.basicPhotoProof || '',
          aboutMe: normalizedProfile.aboutMe || '',
          workExperience: normalizedProfile.workExperience || '',
          education: normalizedProfile.education || '',
          educationPhotoProof: normalizedProfile.educationPhotoProof || '',
          skills: normalizedProfile.skills || '',
          languages: normalizedProfile.languages || '',
          honors: normalizedProfile.honors || '',
          relatedCertificates: normalizedProfile.relatedCertificates || '',
          honorShowcase: normalizedProfile.honorShowcase || ''
        },
        // 新增先保存后审核：资料入库时先记为待审核，后台慢慢查完后再回写最终状态
        profile_security_review: buildPendingProfileSecurityReview()
      }

      if (userDoc) {
        await db.collection(usersCollection).doc(userDoc._id || OPENID).update({
          data: updateData
        })
      } else {
        // 新增一人一档建档：新用户直接使用 openid 作为 _id，避免重复资料导致提交看起来没生效
        await db.collection(usersCollection).doc(OPENID).set({
          data: {
            openid: OPENID,
            nickname: normalizedProfile.nickname || '微信用户',
            phone: normalizedProfile.phone || '',
            gender: normalizedProfile.gender || '',
            experienceLevel: normalizedProfile.experienceLevel || '',
            studentCountLevel: normalizedProfile.studentCountLevel || '',
            role: 'C',
            city: normalizedProfile.city || '',
            address: normalizedProfile.address || '',
            avatarUrl: normalizedProfile.avatarUrl || '',
            createdAt: new Date(),
            updatedAt: new Date(),
            isFirstLogin: false,
            profile_detail: {
              basicPhotoProof: normalizedProfile.basicPhotoProof || '',
              aboutMe: normalizedProfile.aboutMe || '',
              workExperience: normalizedProfile.workExperience || '',
              education: normalizedProfile.education || '',
              educationPhotoProof: normalizedProfile.educationPhotoProof || '',
              skills: normalizedProfile.skills || '',
              languages: normalizedProfile.languages || '',
              honors: normalizedProfile.honors || '',
              relatedCertificates: normalizedProfile.relatedCertificates || '',
              honorShowcase: normalizedProfile.honorShowcase || ''
            }
          }
        })
      }

      const latestDoc = await getCurrentUserDoc(usersCollection, OPENID)
      return {
        status: 'success',
        message: '保存成功，图片正在后台检测',
        profile: buildProfile(latestDoc || {}),
        securityReview: getProfileSecurityReview(latestDoc || {})
      }
    }

    if (action === 'updateAvatar') {
      const nextAvatarUrl = typeof profile.avatarUrl === 'string' ? profile.avatarUrl.trim() : ''
      if (!nextAvatarUrl) {
        return {
          status: 'fail',
          message: '请先上传头像'
        }
      }

      const updateData = {
        avatarUrl: nextAvatarUrl,
        openid: OPENID,
        role: 'C',
        updatedAt: new Date(),
        // 新增头像异步审核：头像先保存，审核状态改成 pending，后续由后台检测回写结果
        profile_security_review: buildPendingProfileSecurityReview()
      }

      if (userDoc) {
        await db.collection(usersCollection).doc(userDoc._id || OPENID).update({
          data: updateData
        })
      } else {
        await db.collection(usersCollection).doc(OPENID).set({
          data: {
            openid: OPENID,
            nickname: '微信用户',
            phone: '',
            role: 'C',
            avatarUrl: nextAvatarUrl,
            createdAt: new Date(),
            updatedAt: new Date(),
            isFirstLogin: false,
            profile_detail: {}
          }
        })
      }

      const latestDoc = await getCurrentUserDoc(usersCollection, OPENID)
      return {
        status: 'success',
        message: '头像已保存，后台检测中',
        profile: buildProfile(latestDoc || {}),
        securityReview: getProfileSecurityReview(latestDoc || {})
      }
    }

    // 保留 mine 页原调用：没有统计数据时先返回最小可用零值
    return {
      status: 'success',
      stats: {
        posts: 0,
        parttime: 0,
        followers: 0
      },
      openid: OPENID,
      appid: APPID,
      unionid: UNIONID
    }
  } catch (error) {
    console.error('NEWDL_mine_user 执行失败', error)
    return {
      status: 'fail',
      message: String((error && error.message) || '用户信息处理失败'),
      error
    }
  }
}
