// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({  env: 'cloud1-6gh7jgl8c5b16a83'}) // 使用当前云环境
const db = cloud.database()

// 新增审核链路追踪号：线上日志里用 traceId 串起入口、文本检查、图片检查和最终出口
function buildTraceId(action = '') {
  return `security_center_${String(action || 'unknown')}_${Date.now()}_${Math.floor(Math.random() * 10000)}`
}

// 新增 openid 脱敏：日志里保留足够定位信息，同时避免直接打印完整身份标识
function maskOpenid(openid = '') {
  const text = String(openid || '').trim()
  if (!text) {
    return ''
  }
  if (text.length <= 6) {
    return text
  }
  return `${text.slice(0, 3)}***${text.slice(-3)}`
}

// 新增 fileID 脱敏：图片审核日志只打印前后缀和长度，避免日志过长难以排查
function summarizeFileID(fileID = '') {
  const text = String(fileID || '').trim()
  if (!text) {
    return ''
  }
  if (text.length <= 24) {
    return text
  }
  return `${text.slice(0, 12)}...${text.slice(-8)}`
}

// 新增资料审核摘要：线上先看文本条数和图片条数，就能快速判断到底有没有走到审核主体
function buildProfileSummary(profile = {}) {
  return {
    nickname: String(profile.nickname || '').trim(),
    textCount: collectProfileTextList(profile).length,
    imageCount: collectProfileImageList(profile).length,
    hasAvatar: !!String(profile.avatarUrl || '').trim(),
    hasBasicPhotoProof: !!String(profile.basicPhotoProof || '').trim(),
    hasEducationPhotoProof: !!String(profile.educationPhotoProof || '').trim()
  }
}

// 新增错误日志收口：把 errCode / errMsg / stack 都收成统一结构，便于线上直接复制排查
function normalizeErrorLog(error) {
  return {
    name: String((error && error.name) || ''),
    message: String((error && error.message) || ''),
    errCode: Number((error && (error.errCode || error.errcode || error.code)) || 0),
    errMsg: String((error && (error.errMsg || error.errmsg)) || ''),
    stack: String((error && error.stack) || '')
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

// 新增权限缺失识别：统一把云函数未开通 OpenAPI 权限的报错收口成可读提示
function isOpenAPIPermissionError(error) {
  if (!error) {
    return false
  }

  const errorCode = Number(error.errCode || error.errcode || error.code || 0)
  const errorMessage = String(error.errMsg || error.errmsg || error.message || '')
  return errorCode === -604101 || /has no permission to call this api/i.test(errorMessage)
}

// 新增图片超限识别：微信图片安全接口命中内容大小上限时，统一返回可直接提示给用户的文案
function isImageSizeLimitError(error) {
  if (!error) {
    return false
  }

  const errorCode = Number(error.errCode || error.errcode || error.code || 0)
  const errorMessage = String(error.errMsg || error.errmsg || error.message || '')
  return errorCode === 45002 || /content size out of limit/i.test(errorMessage)
}

// 新增安全检查结果封装：所有业务云函数统一按同一返回结构读取 safe / message
function buildSafeResult(extra = {}) {
  return {
    status: 'success',
    safe: true,
    message: '内容检查通过',
    ...extra
  }
}

// 新增违规结果封装：命中风险内容时统一返回前端已在使用的提示文案
function buildBlockedResult(extra = {}) {
  return {
    status: 'success',
    safe: false,
    message: '您发布的内容含违规信息',
    ...extra
  }
}

// 新增图片超限结果封装：资料图片过大时直接返回前端可读提示，避免继续显示权限类误导文案
function buildImageTooLargeResult(extra = {}) {
  return {
    status: 'success',
    safe: false,
    message: '图片过大，请压缩后再上传',
    reason: 'image_too_large',
    ...extra
  }
}

// 新增文本安全检测：登录昵称、资料文本统一按资料发布场景进行审核
async function checkTextSecurity(content = '', openid = '', traceId = '') {
  const text = String(content || '').replace(/\s+/g, ' ').trim()
  if (!text) {
    console.log('[NEWDL_security_center] [TEXT_SKIP_EMPTY]', {
      traceId,
      openid: maskOpenid(openid)
    })
    return buildSafeResult({
      checkType: 'text',
      content
    })
  }

  try {
    console.log('[NEWDL_security_center] [TEXT_START]', {
      traceId,
      openid: maskOpenid(openid),
      textLength: text.length,
      preview: text.slice(0, 30)
    })
    const result = await cloud.openapi.security.msgSecCheck({
      content: text,
      version: 2,
      scene: 1,
      openid
    })

    if (isSecurityCheckPassed(result)) {
      console.log('[NEWDL_security_center] [TEXT_PASS]', {
        traceId,
        openid: maskOpenid(openid),
        textLength: text.length
      })
      return buildSafeResult({
        checkType: 'text',
        content
      })
    }

    console.warn('[NEWDL_security_center] [TEXT_BLOCKED]', {
      traceId,
      openid: maskOpenid(openid),
      textLength: text.length,
      result
    })
    return buildBlockedResult({
      checkType: 'text',
      content
    })
  } catch (error) {
    if (isSecurityViolationError(error)) {
      console.warn('[NEWDL_security_center] [TEXT_VIOLATION]', {
        traceId,
        openid: maskOpenid(openid),
        textLength: text.length,
        error: normalizeErrorLog(error)
      })
      return buildBlockedResult({
        checkType: 'text',
        content
      })
    }
    console.error('[NEWDL_security_center] [TEXT_ERROR]', {
      traceId,
      openid: maskOpenid(openid),
      textLength: text.length,
      error: normalizeErrorLog(error)
    })
    throw error
  }
}

// 新增图片安全检测：资料页图片统一下载为 Buffer 后走微信图片安全接口
async function checkImageSecurity(fileID = '', traceId = '') {
  const trimmedFileId = String(fileID || '').trim()
  if (!trimmedFileId) {
    console.log('[NEWDL_security_center] [IMAGE_SKIP_EMPTY]', {
      traceId
    })
    return buildSafeResult({
      checkType: 'image',
      fileID
    })
  }

  try {
    console.log('[NEWDL_security_center] [IMAGE_DOWNLOAD_START]', {
      traceId,
      fileID: summarizeFileID(trimmedFileId)
    })
    const downloadResult = await cloud.downloadFile({
      fileID: trimmedFileId
    })
    console.log('[NEWDL_security_center] [IMAGE_DOWNLOAD_SUCCESS]', {
      traceId,
      fileID: summarizeFileID(trimmedFileId),
      fileSize: Number((downloadResult && downloadResult.fileContent && downloadResult.fileContent.length) || 0)
    })
    const result = await cloud.openapi.security.imgSecCheck({
      media: {
        contentType: guessImageContentType(trimmedFileId),
        value: downloadResult.fileContent
      }
    })

    if (isSecurityCheckPassed(result)) {
      console.log('[NEWDL_security_center] [IMAGE_PASS]', {
        traceId,
        fileID: summarizeFileID(trimmedFileId)
      })
      return buildSafeResult({
        checkType: 'image',
        fileID
      })
    }

    console.warn('[NEWDL_security_center] [IMAGE_BLOCKED]', {
      traceId,
      fileID: summarizeFileID(trimmedFileId),
      result
    })
    return buildBlockedResult({
      checkType: 'image',
      fileID
    })
  } catch (error) {
    if (isSecurityViolationError(error)) {
      console.warn('[NEWDL_security_center] [IMAGE_VIOLATION]', {
        traceId,
        fileID: summarizeFileID(trimmedFileId),
        error: normalizeErrorLog(error)
      })
      return buildBlockedResult({
        checkType: 'image',
        fileID
      })
    }
    if (isImageSizeLimitError(error)) {
      console.warn('[NEWDL_security_center] [IMAGE_TOO_LARGE]', {
        traceId,
        fileID: summarizeFileID(trimmedFileId),
        error: normalizeErrorLog(error)
      })
      return buildImageTooLargeResult({
        checkType: 'image',
        fileID,
        errCode: Number(error.errCode || error.errcode || error.code || 0),
        errMsg: String(error.errMsg || error.errmsg || error.message || '')
      })
    }
    console.error('[NEWDL_security_center] [IMAGE_ERROR]', {
      traceId,
      fileID: summarizeFileID(trimmedFileId),
      error: normalizeErrorLog(error)
    })
    throw error
  }
}

// 新增资料发布安全校验：保存资料前统一审核当前资料里的文本和图片，避免漏掉任意发布入口
async function validateProfileSecurity(profile = {}, openid = '', traceId = '') {
  const textList = collectProfileTextList(profile)
  const imageList = collectProfileImageList(profile)
  console.log('[NEWDL_security_center] [PROFILE_VALIDATE_START]', {
    traceId,
    openid: maskOpenid(openid),
    summary: buildProfileSummary(profile)
  })

  for (let index = 0; index < textList.length; index += 1) {
    console.log('[NEWDL_security_center] [PROFILE_TEXT_ITEM_START]', {
      traceId,
      openid: maskOpenid(openid),
      index,
      textLength: String(textList[index] || '').length
    })
    const textResult = await checkTextSecurity(textList[index], openid, `${traceId}_text_${index}`)
    if (!textResult.safe) {
      console.warn('[NEWDL_security_center] [PROFILE_TEXT_ITEM_BLOCKED]', {
        traceId,
        openid: maskOpenid(openid),
        index,
        result: textResult
      })
      return buildBlockedResult({
        checkType: 'profile_text',
        failedTextIndex: index,
        failedText: textList[index]
      })
    }
  }

  for (let index = 0; index < imageList.length; index += 1) {
    console.log('[NEWDL_security_center] [PROFILE_IMAGE_ITEM_START]', {
      traceId,
      openid: maskOpenid(openid),
      index,
      fileID: summarizeFileID(imageList[index])
    })
    const imageResult = await checkImageSecurity(imageList[index], `${traceId}_image_${index}`)
    if (!imageResult.safe) {
      console.warn('[NEWDL_security_center] [PROFILE_IMAGE_ITEM_BLOCKED]', {
        traceId,
        openid: maskOpenid(openid),
        index,
        result: imageResult
      })
      return {
        ...imageResult,
        checkType: 'profile_image',
        failedImageIndex: index,
        failedImage: imageList[index]
      }
    }
  }

  const finalResult = buildSafeResult({
    checkType: 'profile',
    textCount: textList.length,
    imageCount: imageList.length
  })
  console.log('[NEWDL_security_center] [PROFILE_VALIDATE_PASS]', {
    traceId,
    openid: maskOpenid(openid),
    textCount: textList.length,
    imageCount: imageList.length
  })
  return finalResult
}

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const action = String((event && event.action) || '').trim()
  const operatorOpenid = String((event && event.openid) || wxContext.OPENID || '').trim()
  const traceId = String((event && event.traceId) || buildTraceId(action)).trim()

  // 新增数据库初始化保留：当前版本虽然未直接读库，但先保留统一云函数骨架，方便后续扩展审计日志
  void db

  try {
    console.log('[NEWDL_security_center] [ENTER]', {
      traceId,
      action,
      operatorOpenid: maskOpenid(operatorOpenid),
      eventKeys: Object.keys(event || {})
    })

    switch (action) {
      case 'checkNickname':
      case 'checkText':
        return await checkTextSecurity(event && event.content, operatorOpenid, traceId)

      case 'checkImage':
        return await checkImageSecurity(event && event.fileID, traceId)

      case 'validateProfile':
        return await validateProfileSecurity((event && event.profile) || {}, operatorOpenid, traceId)

      default:
        console.warn('[NEWDL_security_center] [UNKNOWN_ACTION]', {
          traceId,
          action,
          operatorOpenid: maskOpenid(operatorOpenid)
        })
        return {
          status: 'fail',
          message: '未知安全检查动作',
          action,
          traceId,
          openid: operatorOpenid,
          appid: wxContext.APPID,
          unionid: wxContext.UNIONID
        }
    }
  } catch (error) {
    const permissionMessage = isOpenAPIPermissionError(error)
      ? 'NEWDL_security_center 缺少 OpenAPI 权限，请重新上传新云函数并确认 config.json 已生效'
      : '安全检查失败'
    console.error('NEWDL_security_center 执行失败', {
      traceId,
      action,
      operatorOpenid: maskOpenid(operatorOpenid),
      error: normalizeErrorLog(error)
    })
    return {
      status: 'fail',
      safe: false,
      message: permissionMessage,
      action,
      traceId,
      error
    }
  }
}
