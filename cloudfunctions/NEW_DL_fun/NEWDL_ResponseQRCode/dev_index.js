// A 侧「入口二维码响应」云函数（HTTP 云函数模式 + callFunction 双入口）。
//
// 设计目的：
// 1) 小程序 A（机构 / 教练管理端）自己【绝不】调 wxacode 生成小程序码，
//    入口二维码必须归属于小程序 B（家长端）——否则家长扫码会打开错误的小程序。
// 2) 本函数作为 A 侧统一联动出口，通过 HTTP POST 调用 B 环境
//    （cloud1-d7g77k8il914e5b12）的 DLforP_entry_qrcode 云函数完成生成 / 查询 / 刷新 / 停用。
// 3) B 侧返回的 cloud:// fileID 只能在 B 环境渲染，A 端无法直接 <image> 显示，
//    所以本函数会再通过 B 侧给的临时 HTTPS 链接把二维码图片下载回来，转存到 A 侧云存储，
//    机构文档里最终存的是 A 侧 fileID，前端展示永久有效、不受临时链接过期影响。
// 4) 新增 DIY 二维码 Logo 合成：转存前读取机构 DIY 二维码图片（organization_basic.diy_qrcode_image，
//    区块一必填字段），用 pngjs / jpeg-js 纯 JS 合成为二维码中间的样式（中间放教练头像 / 品牌 Logo）；
//    合成失败自动退化为普通码，不阻断主流程；B 侧协议零改动。
//
// 链路：
//   A 前端 --wx.cloud.callFunction(或 HTTP 网关)--> 本函数
//        --HTTP POST--> B 环境 /DLforP_entry_qrcode?action=generate_entry_qrcode
//        --> B 侧 wxacode.getUnlimited + B 云存储 --> 返回 entryId / B fileID / 临时链接
//        --> 本函数下载图片并转存 A 侧云存储 --> 回填机构文档 entry_qrcode 字段
//
// 双入口说明（镜像 B 侧 DLforP_entry_qrcode 的写法）：
// - callFunction：平台 require 本文件后调用 exports.main，能拿到微信 openid，按机构管理员鉴权；
// - HTTP 云函数：scf_bootstrap 执行 `node index.js`，由 index.js 在 require.main === module 时
//   调 startHttpServer() 监听 9000 端口；HTTP 请求没有微信身份，必须显式传 organizationId。
const http = require('http')
const https = require('https')
const { URL } = require('url')
const cloud = require('wx-server-sdk')
// 新增图片合成依赖（均为纯 JS 实现，体积小，避免超出云函数代码包上限）：
// - pngjs：解码 / 编码 PNG（B 侧小程序码是 PNG）；
// - jpeg-js：解码 JPEG（机构上传的 DIY 二维码 Logo 可能是 JPG）。
// 用途：生成入口二维码后，把机构 DIY 二维码图片（organization_basic.diy_qrcode_image）
// 合成为二维码中间的样式（中间放教练头像 / 品牌 Logo），再转存 A 侧云存储。
const { PNG } = require('pngjs')
const JPEG = require('jpeg-js')

cloud.init({ env: 'cloud1-6gh7jgl8c5b16a83' })

const db = cloud.database()

// ===== 环境与集合约定（与 ForOrganizationDo / NEWDL_execution_order 保持一致）=====
const A_ENV_ID = 'cloud1-6gh7jgl8c5b16a83'
const ORGANIZATION_COLLECTION_BASE = 'organization'
const USER_COLLECTION_BASE = 'users'
const CURRENT_RUNTIME_SOURCE = 'dev_index.js'
let CURRENT_ENV_VERSION = 'develop'

// ===== B 侧联动地址（HTTP 云接入）=====
// B 环境 cloud1-d7g77k8il914e5b12 的 HTTP 访问服务路由：
//   域名 cloud1-d7g77k8il914e5b12-1476831641.ap-shanghai.app.tcloudbase.com，
//   访问路径 /DLforP_entry_qrcode，网关转发时会【去掉触发路径】，
//   所以 B 函数收到的 path 是 "/"，query/body 照常透传。
// 如后续 B 侧更换路由，只改这一个常量即可，不动业务逻辑。
const B_QRCODE_HTTP_BASE_URL = 'https://cloud1-d7g77k8il914e5b12-1476831641.ap-shanghai.app.tcloudbase.com/DLforP_entry_qrcode'
// B 侧动作名（与 DLforP_entry_qrcode 的 ACTION_HANDLERS 严格对应，不要擅自改名）。
const B_ACTION_GENERATE = 'generate_entry_qrcode'
const B_ACTION_GET = 'get_entry_qrcode'
const B_ACTION_REFRESH_SNAPSHOT = 'refresh_entry_snapshot'
const B_ACTION_DISABLE = 'disable_entry'
// 入口类型：当前只开放机构入口；个人教练入口 B 侧已预留 individual，A 侧后续再接。
const TARGET_TYPE_ORGANIZATION = 'organization'
// A 侧二维码转存目录：每个机构一张 PNG，按 targetId 固定路径覆盖上传，fileID 保持稳定。
const A_QR_STORAGE_DIR = 'NEWDL/entry_qrcode'
// 新增 DIY 二维码 Logo 合成参数：Logo 宽占二维码宽度比例与白色衬底边距比例。
// 20% 是中心 Logo 的常用安全比例：占比太大容易破坏扫码容错，太小则品牌图看不清。
const DIY_LOGO_WIDTH_RATIO = 0.2
const DIY_LOGO_PLATE_PADDING_RATIO = 0.08
// 机构文档里存放二维码联动结果的字段名。
const ORG_QR_FIELD = 'entry_qrcode'
// 调 B 侧 HTTP 的超时时间（毫秒）：B 侧要调微信 wxacode 接口，留足时间。
const B_HTTP_TIMEOUT_MS = 15000
// 下载二维码图片的超时时间（毫秒）。
const DOWNLOAD_TIMEOUT_MS = 15000

function getCollectionPrefix() {
  return CURRENT_ENV_VERSION === 'develop' ? 'NDLdev_' : 'NDLreal_'
}

function getCollectionName(baseName) {
  return `${getCollectionPrefix()}${baseName}`
}

// 运行环境日志：用于快速判断本次调用按什么环境、什么源码文件在执行（沿用 A 侧统一约定）。
function logRuntimeEnvInfo(extra = {}) {
  console.log('[runtime_env]', {
    functionName: 'NEWDL_ResponseQRCode',
    runtimeSource: CURRENT_RUNTIME_SOURCE,
    envVersion: CURRENT_ENV_VERSION,
    collectionPrefix: getCollectionPrefix(),
    ...extra
  })
}

// A 侧 develop 联调时二维码指向 B 的 develop 版本；trial/release 对应 B 的 release 版本。
function resolveBEnvVersion() {
  return CURRENT_ENV_VERSION === 'develop' ? 'develop' : 'release'
}

function normalizeStr(value = '', maxLen = 0) {
  let s = String(value == null ? '' : value).trim()
  if (maxLen > 0) {
    s = s.slice(0, maxLen)
  }
  return s
}

// ===== 对 B 侧的 HTTP 调用 =====

// 统一以 POST JSON 调 B 侧 HTTP 云函数。
// 注意：snapshot 是对象，若走 GET query 会被 JSON 字符串化，B 侧拿到的是字符串而非对象，
// 快照会被 normalizeSnapshot 判空，所以这里一律用 POST JSON body 透传。
function postToBHttp(action = '', payload = {}) {
  const body = JSON.stringify({ ...payload, action })
  const requestUrl = `${B_QRCODE_HTTP_BASE_URL}?action=${encodeURIComponent(action)}`

  // 请求前日志：记录调 B 侧的 action、URL、body 大小与预览（snapshot 整体不打，避免日志膨胀）。
  console.log('[NEWDL_ResponseQRCode][INFO] postToBHttp.request.start', {
    action,
    url: B_QRCODE_HTTP_BASE_URL,
    bodyLen: Buffer.byteLength(body),
    targetId: payload.targetId || '',
    targetType: payload.targetType || '',
    entryId: payload.entryId || '',
    envVersion: payload.envVersion || '',
    hasSnapshot: !!(payload.snapshot && typeof payload.snapshot === 'object')
  })

  return new Promise((resolve, reject) => {
    let urlObj
    try {
      urlObj = new URL(requestUrl)
    } catch (err) {
      reject(new Error('B 侧二维码服务地址格式非法'))
      return
    }

    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: `${urlObj.pathname}${urlObj.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (response) => {
        let rawText = ''
        response.on('data', (chunk) => {
          rawText += chunk
        })
        response.on('end', () => {
          // 响应日志：记录 B 侧返回的 HTTP 状态码、原始文本长度与预览，便于排查 B 侧 502 / access_token 等错误。
          console.log('[NEWDL_ResponseQRCode][INFO] postToBHttp.response.received', {
            action,
            httpStatus: response.statusCode || 0,
            rawLen: rawText ? rawText.length : 0,
            rawPreview: rawText ? String(rawText).slice(0, 500) : ''
          })
          let parsed = null
          try {
            parsed = rawText ? JSON.parse(rawText) : {}
          } catch (error) {
            console.warn('[NEWDL_ResponseQRCode][WARN] postToBHttp.response.not_json', {
              action,
              parseError: error && error.message ? error.message : String(error)
            })
            parsed = {
              success: false,
              message: 'B 侧返回的不是 JSON',
              rawText: rawText.slice(0, 500)
            }
          }
          resolve({
            success: (response.statusCode || 0) < 400 && !!parsed && parsed.success !== false,
            statusCode: response.statusCode || 0,
            data: parsed || {}
          })
        })
      }
    )

    req.on('error', (err) => {
      console.error('[NEWDL_ResponseQRCode][ERROR] postToBHttp.request.error', {
        action,
        message: err && err.message ? err.message : String(err),
        stack: err && err.stack ? String(err.stack).slice(0, 800) : ''
      })
      reject(err)
    })
    req.setTimeout(B_HTTP_TIMEOUT_MS, () => {
      console.error('[NEWDL_ResponseQRCode][ERROR] postToBHttp.request.timeout', {
        action,
        timeoutMs: B_HTTP_TIMEOUT_MS
      })
      req.destroy(new Error('调用 B 侧二维码服务超时'))
    })
    req.write(body)
    req.end()
  })
}

// 通过 B 侧返回的临时 HTTPS 链接下载二维码图片 buffer。
// B 侧 cloud:// fileID 在 A 环境无法使用，必须先经临时链接把图片字节拿回来再转存。
// 兼容 COS 链接的 3xx 跳转，最多跟随 3 次。
// 新增（诊断日志）：下载前打印 URL 协议/域名、301/302 跳转链、最终字节数，便于区分「B 侧签名过期 / COS 403 / 网络抖动超时」。
function downloadBufferFromUrl(fileUrl = '', redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    let urlObj
    try {
      urlObj = new URL(fileUrl)
    } catch (error) {
      reject(new Error('二维码临时链接格式非法'))
      return
    }

    const protocol = urlObj.protocol
    const host = urlObj.hostname
    // 新增：请求前日志，便于判断是 http/https、域名是否正确。
    console.log('[NEWDL_ResponseQRCode][INFO] downloadBufferFromUrl.start', {
      protocol,
      host,
      pathPrefix: String(urlObj.pathname).slice(0, 80),
      redirectsLeft,
      urlLen: String(fileUrl).length,
    })

    const client = protocol === 'http:' ? http : https
    const req = client.get(fileUrl, (response) => {
      const status = response.statusCode || 0
      const redirectLocation = response.headers && response.headers.location
      if ([301, 302, 303, 307, 308].indexOf(status) >= 0 && redirectLocation && redirectsLeft > 0) {
        response.resume()
        const nextUrl = new URL(redirectLocation, fileUrl).toString()
        console.log('[NEWDL_ResponseQRCode][INFO] downloadBufferFromUrl.redirect', {
          fromStatus: status,
          redirectsLeft,
          nextHost: new URL(nextUrl).hostname,
        })
        downloadBufferFromUrl(nextUrl, redirectsLeft - 1).then(resolve, reject)
        return
      }
      if (status >= 400) {
        response.resume()
        // 新增：HTTP 错误时打完整 status 和 content-type，403 通常是 COS 签名过期、404 是文件被误删。
        console.error('[NEWDL_ResponseQRCode][ERROR] downloadBufferFromUrl.http_error', {
          protocol,
          host,
          httpStatus: status,
          contentType: (response.headers && response.headers['content-type']) || '',
          contentLen: (response.headers && response.headers['content-length']) || '',
        })
        reject(new Error(`下载二维码图片失败，HTTP ${status}`))
        return
      }

      const chunks = []
      response.on('data', (chunk) => {
        chunks.push(chunk)
      })
      response.on('end', () => {
        const buffer = Buffer.concat(chunks)
        // 新增：下载成功打印字节数、content-type，与 transfer.download.ok 的 bufferLen 对应。
        console.log('[NEWDL_ResponseQRCode][INFO] downloadBufferFromUrl.ok', {
          protocol,
          host,
          httpStatus: status,
          contentType: (response.headers && response.headers['content-type']) || '',
          bufferLen: buffer.length,
        })
        resolve(buffer)
      })
    })

    req.on('error', (err) => {
      console.error('[NEWDL_ResponseQRCode][ERROR] downloadBufferFromUrl.net_error', {
        protocol,
        host,
        message: err && err.message ? err.message : String(err),
      })
      reject(err)
    })
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      console.error('[NEWDL_ResponseQRCode][ERROR] downloadBufferFromUrl.timeout', {
        protocol,
        host,
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
      })
      req.destroy(new Error('下载二维码图片超时'))
    })
  })
}

// ===== A 侧用户 / 机构查询（鉴权规则与 ForOrganizationDo 保持一致）=====

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

// 按当前用户 organization_profile 里的 orgId 反查机构文档。
async function getCurrentOrganizationDoc(userDoc = {}, organizationCollectionName = '') {
  const profile = getCurrentOrganizationProfile(userDoc)
  const orgId = String(profile.orgId || '').trim()
  if (!orgId) {
    throw new Error('你当前还没有机构，无法操作机构入口二维码')
  }

  const res = await db.collection(organizationCollectionName)
    .where({ 'organization_basic.organization_id': orgId })
    .limit(1)
    .get()
  const organizationDoc = Array.isArray(res.data) && res.data.length ? res.data[0] : null
  if (!organizationDoc) {
    throw new Error('未找到当前机构资料，请稍后重试')
  }
  return organizationDoc
}

// HTTP 模式（服务器间调用）没有微信身份，按显式传入的 organizationId 直查机构文档。
async function findOrganizationDocById(organizationCollectionName = '', organizationId = '') {
  const res = await db.collection(organizationCollectionName)
    .where({ 'organization_basic.organization_id': organizationId })
    .limit(1)
    .get()
  return Array.isArray(res.data) && res.data.length ? res.data[0] : null
}

// 机构入口二维码属于机构级资料，只有机构管理层（admin）可以生成 / 刷新 / 停用。
function ensureOrganizationAdmin(userDoc = {}, organizationDoc = {}, openid = '') {
  const profile = getCurrentOrganizationProfile(userDoc)
  if (String(profile.memberRole || '').trim() !== 'admin') {
    throw new Error('只有机构管理层可以操作机构入口二维码')
  }
  const organizationMember = organizationDoc.organization_member || {}
  const adminList = Array.isArray(organizationMember.admin_list) ? organizationMember.admin_list : []
  const isAdmin = adminList.some((item) => String(item.openid || '').trim() === openid)
  if (!isAdmin) {
    throw new Error('当前账号不是该机构管理层，不能操作机构入口二维码')
  }
}

// 统一解析目标机构文档：
// - callFunction 模式：按登录教练身份取当前机构，并校验机构管理层；
// - HTTP 模式：无微信身份，必须显式传 organizationId（或 targetId）直查。
async function resolveTargetOrganization(event = {}, openid = '', isHttpCall = false, usersCollectionName = '', organizationCollectionName = '') {
  if (isHttpCall) {
    const organizationId = normalizeStr(event.organizationId || event.targetId, 64)
    if (!organizationId) {
      console.warn('[NEWDL_ResponseQRCode][WARN] resolveTarget.missing_orgid_http')
      throw new Error('HTTP 调用必须传 organizationId')
    }
    console.log('[NEWDL_ResponseQRCode][INFO] resolveTarget.http.start', { organizationId, collection: organizationCollectionName })
    const organizationDoc = await findOrganizationDocById(organizationCollectionName, organizationId)
    if (!organizationDoc) {
      console.warn('[NEWDL_ResponseQRCode][WARN] resolveTarget.http.not_found', { organizationId })
      throw new Error('未找到对应机构，请检查 organizationId')
    }
    console.log('[NEWDL_ResponseQRCode][INFO] resolveTarget.http.ok', {
      organizationId,
      docId: organizationDoc._id
    })
    return organizationDoc
  }

  console.log('[NEWDL_ResponseQRCode][INFO] resolveTarget.callfn.start', { hasOpenid: !!openid })
  const userDoc = await getCurrentUserDoc(openid, usersCollectionName)
  const organizationDoc = await getCurrentOrganizationDoc(userDoc, organizationCollectionName)
  ensureOrganizationAdmin(userDoc, organizationDoc, openid)
  console.log('[NEWDL_ResponseQRCode][INFO] resolveTarget.callfn.ok', {
    organizationId: String((organizationDoc.organization_basic || {}).organization_id || '')
  })
  return organizationDoc
}

// ===== 快照与转存 =====

// 从 A 侧机构文档构造推给 B 的入口快照。
// 字段名对齐 B 侧 normalizeSnapshot：institutionName / logoFileId / intro / updatedAt。
// A 侧没有单独 logo 字段，暂取品牌轮播图第一张作为 logo。
function buildOrganizationSnapshot(organizationDoc = {}) {
  const basic = organizationDoc.organization_basic || {}
  const brandImages = Array.isArray(basic.brand_swiper_images) ? basic.brand_swiper_images : []
  return {
    institutionName: String(basic.organization_name || '').trim(),
    logoFileId: String(brandImages[0] || '').trim(),
    intro: String(basic.intro || '').trim(),
    updatedAt: basic.updated_at || new Date()
  }
}

// ===== 新增 DIY 二维码 Logo 合成（生成二维码时携带图片作为二维码中间的样式）=====

// 从 A 侧云存储下载机构 DIY 二维码图片 buffer（organization_basic.diy_qrcode_image 是 A 侧 fileID）。
// 说明：Logo 只存在 A 侧，B 侧生成原始小程序码时不感知 Logo，合成在 A 侧转存前完成，B 侧协议零改动。
// 任何失败都返回 null 并只打日志，绝不阻断二维码生成主流程（退化为无 Logo 的普通码）。
// 新增（诊断日志）：下载成功时补充字节数与魔数首字节，避免「下载成功了但格式错→解码失败→合成失败」链条无法定位。
async function downloadAFileBuffer(fileID = '') {
  const trimmedFileId = String(fileID || '').trim()
  if (!trimmedFileId) {
    return null
  }
  try {
    const res = await cloud.downloadFile({ fileID: trimmedFileId })
    const buffer = res && res.fileContent ? res.fileContent : null
    if (!buffer || !buffer.length) {
      console.warn('[NEWDL_ResponseQRCode][WARN] download_diy_logo.empty', { fileID: trimmedFileId })
      return null
    }
    // 新增：下载成功时打印字节数 + 魔数首 4 字节，方便与后续 decodeImageToRgba 的识别结果对账。
    const magic = buffer.length >= 4
      ? Array.from(buffer.slice(0, 4)).map((b) => b.toString(16).padStart(2, '0')).join(' ')
      : ''
    console.log('[NEWDL_ResponseQRCode][INFO] download_diy_logo.ok', {
      fileIDPrefix: trimmedFileId.slice(0, 60),
      bufferLen: buffer.length,
      magicHex: magic,
      statusCode: res && res.statusCode ? res.statusCode : '',
    })
    return buffer
  } catch (error) {
    console.error('[NEWDL_ResponseQRCode][ERROR] download_diy_logo.fail', {
      fileID: trimmedFileId,
      message: error && (error.message || error.errMsg) ? (error.message || error.errMsg) : String(error)
    })
    return null
  }
}

// 按魔数识别图片格式并解码成 RGBA 像素 { width, height, data }。
// 支持 PNG（小程序码本身 / 带透明通道的 Logo）与 JPEG（相机图 / 压缩图）。
// 新增（诊断日志）：魔数识别是合成链路最常见的失败点（例如前端压缩时保存成 WEBP / GIF、或者 .jpg 后缀实际是 PNG），
// 现在把每个分支的判定结果与解码结果明确打出，与 downloadAFileBuffer 的 magicHex 对账即可定位格式问题。
function decodeImageToRgba(buffer = null) {
  if (!buffer || !buffer.length) {
    return null
  }
  const bufLen = buffer.length
  const magic = bufLen >= 4
    ? Array.from(buffer.slice(0, 4)).map((b) => b.toString(16).padStart(2, '0')).join(' ')
    : ''
  // PNG 魔数：0x89 'P' 'N' 'G'
  if (bufLen > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    try {
      const png = PNG.sync.read(buffer)
      console.log('[NEWDL_ResponseQRCode][INFO] decode_image.png_ok', {
        bufLen,
        magicHex: magic,
        width: png.width,
        height: png.height,
      })
      return { width: png.width, height: png.height, data: png.data }
    } catch (pngErr) {
      // 魔数匹配但解析失败：比如文件损坏、截断的 PNG，明确报错以便要求机构重传。
      console.error('[NEWDL_ResponseQRCode][ERROR] decode_image.png_magic_match_but_decode_fail', {
        bufLen,
        magicHex: magic,
        message: pngErr && pngErr.message ? pngErr.message : String(pngErr),
      })
      return null
    }
  }
  // JPEG 魔数：0xFF 0xD8
  if (bufLen > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    try {
      // maxMemoryUsageInMB 放宽到 1024：Logo 已在前端压缩到 500KB 内，防止极端大图解码爆内存
      const jpeg = JPEG.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 1024 })
      console.log('[NEWDL_ResponseQRCode][INFO] decode_image.jpeg_ok', {
        bufLen,
        magicHex: magic,
        width: jpeg.width,
        height: jpeg.height,
      })
      return { width: jpeg.width, height: jpeg.height, data: Buffer.from(jpeg.data) }
    } catch (jpgErr) {
      console.error('[NEWDL_ResponseQRCode][ERROR] decode_image.jpeg_magic_match_but_decode_fail', {
        bufLen,
        magicHex: magic,
        message: jpgErr && jpgErr.message ? jpgErr.message : String(jpgErr),
      })
      return null
    }
  }
  // 魔数既不是 PNG 也不是 JPEG —— 格式不支持，打日志让机构重新上传正确格式的图片。
  console.warn('[NEWDL_ResponseQRCode][WARN] decode_image.unsupported_format', {
    bufLen,
    magicHex: magic,
    // 打印首 16 字节的十六进制，帮助鉴别格式（如 WEBP 是 52 49 46 46 "RIFF"，GIF 是 47 49 46 38 "GIF8"，BMP 是 42 4d "BM"）
    extraMagic16: bufLen >= 16
      ? Array.from(buffer.slice(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join(' ')
      : '',
    recommendation: '请要求机构重新上传 PNG 或 JPEG 格式的 DIY Logo 图片（常见问题：上传了 .webp / .gif / .bmp / 改了后缀的伪 PNG/JPG）',
  })
  return null
}

// 双线性插值缩放 RGBA 像素，返回新的 { width, height, data }。
// Logo 要缩到二维码宽度 20% 左右，用插值而不是直接丢像素，避免品牌图出现马赛克感。
function resizeRgbaBilinear(src = {}, dstWidth = 0, dstHeight = 0) {
  const srcWidth = src.width || 0
  const srcHeight = src.height || 0
  const srcData = src.data
  if (!srcWidth || !srcHeight || !srcData || !dstWidth || !dstHeight) {
    return null
  }
  if (srcWidth === dstWidth && srcHeight === dstHeight) {
    return { width: dstWidth, height: dstHeight, data: Buffer.from(srcData) }
  }

  const dstData = Buffer.alloc(dstWidth * dstHeight * 4)
  for (let y = 0; y < dstHeight; y += 1) {
    // 映射到源图像素中心后采样，四角夹紧防止越界
    const srcY = ((y + 0.5) * srcHeight) / dstHeight - 0.5
    const y0 = Math.max(0, Math.floor(srcY))
    const y1 = Math.min(srcHeight - 1, y0 + 1)
    const fy = Math.min(Math.max(srcY - y0, 0), 1)
    for (let x = 0; x < dstWidth; x += 1) {
      const srcX = ((x + 0.5) * srcWidth) / dstWidth - 0.5
      const x0 = Math.max(0, Math.floor(srcX))
      const x1 = Math.min(srcWidth - 1, x0 + 1)
      const fx = Math.min(Math.max(srcX - x0, 0), 1)
      const dstIndex = (y * dstWidth + x) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        const p00 = srcData[(y0 * srcWidth + x0) * 4 + channel]
        const p10 = srcData[(y0 * srcWidth + x1) * 4 + channel]
        const p01 = srcData[(y1 * srcWidth + x0) * 4 + channel]
        const p11 = srcData[(y1 * srcWidth + x1) * 4 + channel]
        const top = p00 + (p10 - p00) * fx
        const bottom = p01 + (p11 - p01) * fx
        dstData[dstIndex + channel] = Math.round(top + (bottom - top) * fy)
      }
    }
  }
  return { width: dstWidth, height: dstHeight, data: dstData }
}

// 把 DIY Logo 合成到二维码中间（中间放教练头像 / 品牌 Logo）：
// 1) Logo 目标宽 = 二维码宽 * DIY_LOGO_WIDTH_RATIO（约 20%，保证扫码容错），高度按原比例缩放；
// 2) Logo 先贴到一块白色衬底上（四周留 DIY_LOGO_PLATE_PADDING_RATIO 边距），
//    再整体居中盖到二维码中心，视觉上正好替换掉小程序码自带的中心图标区域；
// 3) 带 alpha 通道的 PNG Logo 与白色衬底做 alpha 混合，透明背景不会发黑。
// 任一步失败都返回原二维码 buffer（只打日志），绝不阻断生成主流程。
// 新增（诊断日志）：中间每一步关键计算（解码尺寸 / 缩放结果 / 衬底大小 / 居中偏移）都打出来，
// 避免 Logo 位置偏、尺寸错、或缩放失败后静默退化造成排查盲区。
function compositeDiyLogoOntoQrcode(qrBuffer = null, logoBuffer = null) {
  if (!qrBuffer || !qrBuffer.length || !logoBuffer || !logoBuffer.length) {
    return qrBuffer
  }
  try {
    const qrImage = decodeImageToRgba(qrBuffer)
    const logoImage = decodeImageToRgba(logoBuffer)
    if (!qrImage || !qrImage.width || !qrImage.height || !logoImage || !logoImage.width || !logoImage.height) {
      // 新增：解码失败时把各自的宽高打出来（如果一方解码成功、另一方失败时特别有价值）
      console.warn('[NEWDL_ResponseQRCode][WARN] composite_diy_logo.decode_fail', {
        qrDecoded: !!qrImage,
        qrWidth: qrImage ? qrImage.width : 0,
        qrHeight: qrImage ? qrImage.height : 0,
        logoDecoded: !!logoImage,
        logoWidth: logoImage ? logoImage.width : 0,
        logoHeight: logoImage ? logoImage.height : 0,
      })
      return qrBuffer
    }

    const qrSize = Math.min(qrImage.width, qrImage.height)
    const logoWidth = Math.max(1, Math.floor(qrSize * DIY_LOGO_WIDTH_RATIO))
    const logoHeight = Math.max(1, Math.floor((logoImage.height * logoWidth) / logoImage.width))
    console.log('[NEWDL_ResponseQRCode][INFO] composite_diy_logo.size_plan', {
      qrWidth: qrImage.width,
      qrHeight: qrImage.height,
      qrSize,
      logoRatio: DIY_LOGO_WIDTH_RATIO,
      originLogoW: logoImage.width,
      originLogoH: logoImage.height,
      targetLogoW: logoWidth,
      targetLogoH: logoHeight,
    })
    const resizedLogo = resizeRgbaBilinear(logoImage, logoWidth, logoHeight)
    if (!resizedLogo) {
      // 新增：双线性缩放返回 null 时（无效参数、0 尺寸等）明确告警，避免静默退化。
      console.warn('[NEWDL_ResponseQRCode][WARN] composite_diy_logo.resize_fail', {
        originLogoW: logoImage.width,
        originLogoH: logoImage.height,
        targetLogoW: logoWidth,
        targetLogoH: logoHeight,
      })
      return qrBuffer
    }

    // 白色衬底：先建一块纯白 RGBA，再把 Logo 以 alpha 混合贴上去
    const padding = Math.max(2, Math.floor(logoWidth * DIY_LOGO_PLATE_PADDING_RATIO))
    const plateSize = logoWidth + padding * 2
    const offsetX = Math.floor((qrImage.width - plateSize) / 2)
    const offsetY = Math.floor((qrImage.height - plateSize) / 2)
    // 新增：衬底 + 居中偏移参数，用于排查 Logo 是否被裁掉（比如当 plateSize > qrSize 时会越界写）
    console.log('[NEWDL_ResponseQRCode][INFO] composite_diy_logo.plate_params', {
      platePadding: padding,
      plateSize,
      qrWidth: qrImage.width,
      qrHeight: qrImage.height,
      offsetX,
      offsetY,
      plateFitsQr: plateSize <= Math.min(qrImage.width, qrImage.height),
    })
    const plate = Buffer.alloc(plateSize * plateSize * 4, 0xff)
    for (let y = 0; y < logoHeight; y += 1) {
      for (let x = 0; x < logoWidth; x += 1) {
        const srcIndex = (y * logoWidth + x) * 4
        const alpha = resizedLogo.data[srcIndex + 3] / 255
        const dstIndex = ((y + padding) * plateSize + (x + padding)) * 4
        for (let channel = 0; channel < 3; channel += 1) {
          plate[dstIndex + channel] = Math.round(
            plate[dstIndex + channel] * (1 - alpha) + resizedLogo.data[srcIndex + channel] * alpha
          )
        }
        plate[dstIndex + 3] = 255
      }
    }

    // 衬底整体居中覆盖到二维码中心（直接覆写像素，衬底不透明所以无需再混合）
    for (let y = 0; y < plateSize; y += 1) {
      for (let x = 0; x < plateSize; x += 1) {
        const srcIndex = (y * plateSize + x) * 4
        const dstIndex = ((y + offsetY) * qrImage.width + (x + offsetX)) * 4
        for (let channel = 0; channel < 4; channel += 1) {
          qrImage.data[dstIndex + channel] = plate[srcIndex + channel]
        }
      }
    }

    const compositedBuffer = PNG.sync.write(qrImage)
    console.log('[NEWDL_ResponseQRCode][INFO] composite_diy_logo.ok', {
      qrWidth: qrImage.width,
      qrHeight: qrImage.height,
      logoWidth,
      logoHeight,
      plateSize,
      compositedLen: compositedBuffer.length
    })
    return compositedBuffer
  } catch (error) {
    console.error('[NEWDL_ResponseQRCode][ERROR] composite_diy_logo.fail', {
      message: error && (error.message || error.errMsg) ? (error.message || error.errMsg) : String(error),
      stack: error && error.stack ? String(error.stack).slice(0, 800) : ''
    })
    // 合成失败退化为普通二维码，绝不阻断生成主流程
    return qrBuffer
  }
}

// 把 B 侧二维码图片经临时链接下载后转存到 A 侧云存储。
// 固定 cloudPath 覆盖上传：同一机构反复生成 / 重试，A 侧 fileID 保持稳定，前端引用不会断。
// 新增 diyLogoBuffer 入参：传入机构 DIY 二维码图片 buffer 时，先合成到二维码中间再上传；
// 转存失败不抛给主流程（返回空字符串），调用方决定是否沿用旧 fileID。
// 新增（2026-09-04）：同时产出两份——原始码（不带 Logo）+ 合成码（带 DIY Logo），两份都转存到 A 侧云存储，
// 返回 { rawFileId, composedFileId }；前端并列展示两张图，便于对比与备用。无 Logo 时合成码退化为原始码副本。
async function transferQrToAStorage(tempUrl = '', targetId = '', diyLogoBuffer = null) {
  const EMPTY_RESULT = { rawFileId: '', composedFileId: '' }
  if (!tempUrl || !targetId) {
    console.warn('[NEWDL_ResponseQRCode][WARN] transfer.skip_empty_input', { hasTempUrl: !!tempUrl, hasTargetId: !!targetId })
    return EMPTY_RESULT
  }
  // 下载前日志：便于排查 B 侧临时链接过期 / 跨域 / 403 等问题。
  console.log('[NEWDL_ResponseQRCode][INFO] transfer.download.start', {
    targetId,
    tempUrlPreview: String(tempUrl).slice(0, 120),
    hasDiyLogo: !!diyLogoBuffer
  })
  try {
    const rawBuffer = await downloadBufferFromUrl(tempUrl)
    if (!rawBuffer || !rawBuffer.length) {
      throw new Error('下载到的二维码图片为空')
    }
    console.log('[NEWDL_ResponseQRCode][INFO] transfer.download.ok', {
      targetId,
      bufferLen: rawBuffer.length
    })

    // 第 1 份：原始码（不带 Logo）单独转存一份，前端与合成码并列展示，便于对比与备用。
    // cloudPath 用 _raw 后缀与合成码区分，同一机构反复生成覆盖上传，fileID 保持稳定。
    const rawCloudPath = `${A_QR_STORAGE_DIR}/${targetId}_raw.png`
    const rawUploadRes = await cloud.uploadFile({ cloudPath: rawCloudPath, fileContent: rawBuffer })
    const rawFileId = rawUploadRes.fileID || ''
    console.log('[NEWDL_ResponseQRCode][INFO] transfer.upload.raw.ok', {
      targetId,
      cloudPath: rawCloudPath,
      aRawQrcodeFileId: rawFileId
    })

    // 第 2 份：合成码（带 DIY Logo）。带 DIY Logo 时合成到二维码中间（中间放教练头像 / 品牌 Logo），
    // 失败自动退化为普通码（compositeDiyLogoOntoQrcode 内部会回退返回原 buffer，不阻断主流程）。
    // 无 Logo 时 composedBuffer 直接复用 rawBuffer，此时合成码等同原始码，两份一致属正常表现。
    let composedBuffer = rawBuffer
    if (diyLogoBuffer) {
      composedBuffer = compositeDiyLogoOntoQrcode(rawBuffer, diyLogoBuffer)
    }
    const composedCloudPath = `${A_QR_STORAGE_DIR}/${targetId}.png`
    const composedUploadRes = await cloud.uploadFile({ cloudPath: composedCloudPath, fileContent: composedBuffer })
    const composedFileId = composedUploadRes.fileID || ''
    console.log('[NEWDL_ResponseQRCode][INFO] transfer.upload.composed.ok', {
      targetId,
      cloudPath: composedCloudPath,
      aComposedQrcodeFileId: composedFileId,
      hasDiyLogo: !!diyLogoBuffer,
      composedSameAsRaw: composedBuffer === rawBuffer
    })
    return { rawFileId, composedFileId }
  } catch (error) {
    console.error('[NEWDL_ResponseQRCode][ERROR] transfer.fail', {
      targetId,
      message: error && (error.message || error.errMsg) ? (error.message || error.errMsg) : String(error),
      stack: error && error.stack ? String(error.stack).slice(0, 800) : ''
    })
    return EMPTY_RESULT
  }
}

// 组装写入机构文档的二维码联动记录（A 侧自有字段，与 B 侧 dev_entry_registry 互不依赖）。
function buildEntryQrcodeRecord(partial = {}) {
  const now = new Date()
  return {
    targetType: TARGET_TYPE_ORGANIZATION,
    targetId: String(partial.targetId || '').trim(),
    entryId: String(partial.entryId || '').trim(),
    scene: String(partial.scene || partial.entryId || '').trim(),
    // B 侧云存储 fileID：仅留档 / 后续调 B 侧动作时核对，A 端不能直接渲染。
    b_qrcode_file_id: String(partial.bQrcodeFileId || '').trim(),
    // A 侧云存储「原始码」fileID（不带 Logo）：前端并列展示用，与合成码对照。
    // 新增（2026-09-04）：原始码单独转存一份，前端与合成码同时展示。
    raw_qrcode_file_id: String(partial.rawQrcodeFileId || '').trim(),
    // A 侧云存储「合成码」fileID（带 DIY Logo）：前端 <image> 主展示用这个。
    qrcode_file_id: String(partial.composedQrcodeFileId || partial.aQrcodeFileId || '').trim(),
    // 最近一次 B 侧返回的临时链接（会过期，仅作兜底展示，正常展示用 qrcode_file_id）。
    qrcode_temp_url: String(partial.qrcodeTempUrl || '').trim(),
    page: String(partial.page || '').trim(),
    env_version: String(partial.envVersion || '').trim(),
    // 推给 B 侧的机构快照缓存，便于排查与本地展示。
    snapshot: partial.snapshot || {},
    status: 'active',
    reused: !!partial.reused,
    synced_at: now,
    updated_at: now
  }
}

// 从机构文档安全读取已有的二维码联动记录。
function getEntryQrcodeRecord(organizationDoc = {}) {
  const record = organizationDoc[ORG_QR_FIELD]
  return record && typeof record === 'object' ? record : null
}

// ===== 业务动作 =====

// 动作 1：生成（或复用 B 侧幂等记录）机构入口二维码，并转存到 A 侧云存储。
// 入参（callFunction）：{ action: 'generateOrganizationQrcode', envVersion? }
// 入参（HTTP）：{ action, organizationId }
async function generateOrganizationQrcode(event = {}, openid = '', isHttpCall = false) {
  const usersCollectionName = getCollectionName(USER_COLLECTION_BASE)
  const organizationCollectionName = getCollectionName(ORGANIZATION_COLLECTION_BASE)
  console.log('[NEWDL_ResponseQRCode][INFO] generateOrganizationQrcode.start', {
    isHttpCall,
    hasOpenid: !!openid,
    hasOrganizationId: !!(event.organizationId || event.targetId),
    envVersion: event.envVersion || ''
  })

  const organizationDoc = await resolveTargetOrganization(
    event,
    openid,
    isHttpCall,
    usersCollectionName,
    organizationCollectionName
  )
  const organizationId = String((organizationDoc.organization_basic || {}).organization_id || '').trim()
  const snapshot = buildOrganizationSnapshot(organizationDoc)
  const bEnvVersion = normalizeStr(event.envVersion, 16) || resolveBEnvVersion()
  // 调 B 侧前日志：确认目标机构、目标类型、envVersion 都对齐。
  console.log('[NEWDL_ResponseQRCode][INFO] generateOrganizationQrcode.call_b.start', {
    organizationId,
    targetType: TARGET_TYPE_ORGANIZATION,
    bEnvVersion,
    snapshotKeys: Object.keys(snapshot)
  })

  // 1) 调 B 侧生成二维码（B 侧按 targetType+targetId 幂等，已生成过会直接复用）。
  const bRes = await postToBHttp(B_ACTION_GENERATE, {
    targetType: TARGET_TYPE_ORGANIZATION,
    targetId: organizationId,
    snapshot,
    envVersion: bEnvVersion
  })
  console.log('[NEWDL_ResponseQRCode][INFO] generateOrganizationQrcode.call_b.result', {
    organizationId,
    success: bRes.success,
    bStatusCode: bRes.statusCode,
    bCode: bRes.data ? bRes.data.code : '',
    bSuccess: bRes.data ? bRes.data.success : '',
    bEntryId: bRes.data ? bRes.data.entryId : '',
    bHasTempUrl: !!(bRes.data && bRes.data.qrcodeTempUrl)
  })
  if (!bRes.success) {
    const bMessage = bRes.data.message || bRes.data.errorMessage || '未知错误'
    const wxErrcode = bRes.data.wxErrcode || ''
    // 新增：把 B 侧失败详情打进 A 侧云函数日志，方便两端联动排查（wxErrcode 是微信原始错误码）。
    console.error('[NEWDL_ResponseQRCode][ERROR] B generate_entry_qrcode fail', {
      organizationId,
      targetType: TARGET_TYPE_ORGANIZATION,
      bStatusCode: bRes.statusCode,
      bCode: bRes.data.code || '',
      wxErrcode,
      bMessage,
      bEntryId: bRes.data.entryId || '',
      // 把 B 侧返回的原始数据快照一并打出，便于定位 access_token / wxErrcode 来源。
      bDataSnapshot: {
        code: bRes.data.code,
        success: bRes.data.success,
        message: String(bRes.data.message || '').slice(0, 300),
        errorMessage: String(bRes.data.errorMessage || '').slice(0, 300),
        wxErrcode: bRes.data.wxErrcode
      }
    })
    const wxHint = wxErrcode ? `（微信错误码：${wxErrcode}）` : ''
    return {
      status: 'fail',
      message: `B 侧生成二维码失败：${bMessage}${wxHint}`,
      bCode: bRes.data.code || bRes.statusCode,
      wxErrcode
    }
  }

  const bData = bRes.data || {}
  const previousRecord = getEntryQrcodeRecord(organizationDoc)

  // 新增：下载机构 DIY 二维码图片（区块一 Oncegenerated_cannotbemodified 必填字段，
  // organization_basic.diy_qrcode_image 存的是 A 侧 fileID），转存前合成到二维码中间位置。
  // Logo 下载失败返回 null，转存时自动退化为无 Logo 的普通码，不阻断主流程。
  const organizationBasic = organizationDoc.organization_basic || {}
  const diyQrcodeImageFileId = String(organizationBasic.diy_qrcode_image || '').trim()
  const diyFieldExistsInDoc = Object.prototype.hasOwnProperty.call(organizationBasic, 'diy_qrcode_image')
  // 新增（诊断日志 - DIY Logo 读取核对）：用户反馈「DIY 二维码失败」最大疑点是「数据库里该字段到底有没有值」
  // 现在直接把 organization_basic 顶层键列表、字段类型、实际读取值全部打印出来，
  // 一锤定音区分是「未入库 / 字段名错 / 类型错 / 空字符串 / 有值但后续链路失败」。
  console.log('[NEWDL_ResponseQRCode][INFO] generateOrganizationQrcode.diy_logo.read_db', {
    organizationId,
    docId: organizationDoc._id,
    orgBasicTopKeys: Object.keys(organizationBasic).slice(0, 20),
    diyFieldExistsInDoc,
    diyFieldType: typeof organizationBasic.diy_qrcode_image,
    diyFieldRaw: organizationBasic.diy_qrcode_image == null ? '<null|undefined>' : String(organizationBasic.diy_qrcode_image),
    diyFileIdTrimmed: diyQrcodeImageFileId,
    diyFileIdLooksValid: diyQrcodeImageFileId.startsWith('cloud://'),
  })

  // 新增：DIY Logo 字段缺失/为空时，加 WARN 级别排障指引，直接给用户后续操作建议。
  // 关键区分：
  //   diyFieldExistsInDoc=false → 文档里根本没有 diy_qrcode_image 这个键
  //     场景1：该机构在「ForOrganizationDo 部署 diy_qrcode_image 字段之前」创建（老机构）
  //     场景2：ForOrganizationDo 新版已改但还没部署，新机构创建时写入没有这个字段
  //     处理建议：进入机构编辑页补传 PNG/JPG 图片 → 触发 updateOrganization「空值一次性补传」
  //   diyFieldExistsInDoc=true 但 diyFileIdTrimmed='' → 字段存在但值为空串
  //     处理建议：同上，编辑页补传
  let diyLogoStatus = 'missing' // 前端提示用的三档枚举：missing / has_logo / download_or_decode_failed
  if (!diyFieldExistsInDoc) {
    console.warn('[NEWDL_ResponseQRCode][WARN] generateOrganizationQrcode.diy_logo.missing_key', {
      organizationId,
      docId: organizationDoc._id,
      orgBasicTopKeysCount: Object.keys(organizationBasic).length,
      recommendation: '该机构文档里不存在 diy_qrcode_image 字段（通常由两种情况导致：1) 该机构是旧版 ForOrganizationDo 创建的老机构；2) ForOrganizationDo 新版已加字段但尚未部署）。解决方式：进入机构编辑页点击 DIY 二维码框重新上传 PNG/JPG 图片 → 保存补充信息（触发 updateOrganization「空值一次性补传」逻辑）→ 重新生成入口二维码。',
    })
  } else if (!diyQrcodeImageFileId) {
    console.warn('[NEWDL_ResponseQRCode][WARN] generateOrganizationQrcode.diy_logo.empty_value', {
      organizationId,
      docId: organizationDoc._id,
      recommendation: 'diy_qrcode_image 字段存在但值为空字符串。解决方式：进入机构编辑页点击 DIY 二维码框重新上传 PNG/JPG 图片 → 保存补充信息 → 重新生成入口二维码。',
    })
  }
  const diyLogoBuffer = diyQrcodeImageFileId ? await downloadAFileBuffer(diyQrcodeImageFileId) : null
  if (diyQrcodeImageFileId && !diyLogoBuffer) {
    console.warn('[NEWDL_ResponseQRCode][WARN] generateOrganizationQrcode.diy_logo_unavailable', {
      organizationId,
      diyQrcodeImageFileId,
    })
    diyLogoStatus = 'download_or_decode_failed'
  } else if (diyLogoBuffer) {
    // Logo 下载成功时打印字节数 + 魔数首 4 字节（十六进制），用于后续魔数识别链路对账。
    const magic = diyLogoBuffer.length >= 4
      ? Array.from(diyLogoBuffer.slice(0, 4)).map((b) => b.toString(16).padStart(2, '0')).join(' ')
      : ''
    console.log('[NEWDL_ResponseQRCode][INFO] generateOrganizationQrcode.diy_logo.download_ok', {
      organizationId,
      diyQrcodeImageFileIdPrefix: String(diyQrcodeImageFileId).slice(0, 60),
      logoBufferLen: diyLogoBuffer.length,
      logoMagicHex: magic,
    })
    diyLogoStatus = 'has_logo'
  }

  // 2) 把二维码图片转存到 A 侧云存储；失败时沿用历史 A 侧 fileID，避免前端展示断档。
  // 新增（2026-09-04）：转存同时产出原始码 + 合成码两份，分别沿用各自历史 fileID 兜底，互不影响。
  const transferResult = await transferQrToAStorage(String(bData.qrcodeTempUrl || ''), organizationId, diyLogoBuffer)
  let composedFileId = transferResult.composedFileId || ''
  let rawFileId = transferResult.rawFileId || ''
  if (!composedFileId && previousRecord) {
    composedFileId = String(previousRecord.qrcode_file_id || '').trim()
    console.warn('[NEWDL_ResponseQRCode][WARN] generateOrganizationQrcode.reuse_old_composed_fileid', { organizationId, oldFileId: composedFileId })
  }
  if (!rawFileId && previousRecord) {
    rawFileId = String(previousRecord.raw_qrcode_file_id || '').trim()
    console.warn('[NEWDL_ResponseQRCode][WARN] generateOrganizationQrcode.reuse_old_raw_fileid', { organizationId, oldFileId: rawFileId })
  }

  // 3) 回填机构文档。
  const record = buildEntryQrcodeRecord({
    targetId: organizationId,
    entryId: bData.entryId,
    scene: bData.scene,
    bQrcodeFileId: bData.qrcodeFileId,
    rawQrcodeFileId: rawFileId,
    composedQrcodeFileId: composedFileId,
    qrcodeTempUrl: bData.qrcodeTempUrl,
    page: bData.page,
    envVersion: bData.envVersion || bEnvVersion,
    snapshot,
    reused: bData.reused
  })
  console.log('[NEWDL_ResponseQRCode][INFO] generateOrganizationQrcode.update_org.start', {
    organizationId,
    docId: organizationDoc._id,
    entryId: record.entryId,
    aQrcodeFileId: record.qrcode_file_id,
    aRawQrcodeFileId: record.raw_qrcode_file_id
  })
  await db.collection(organizationCollectionName).doc(organizationDoc._id).update({
    data: { [ORG_QR_FIELD]: record }
  })
  console.log('[NEWDL_ResponseQRCode][INFO] generateOrganizationQrcode.update_org.ok', {
    organizationId,
    entryId: record.entryId
  })

  return {
    status: 'success',
    message: bData.reused ? '机构入口二维码已存在，已直接复用' : '机构入口二维码生成成功',
    entryId: record.entryId,
    scene: record.scene,
    // 前端展示统一用 A 侧 fileID：合成码为主展示码，原始码并列展示用于对照。
    qrcodeFileId: record.qrcode_file_id,
    rawQrcodeFileId: record.raw_qrcode_file_id,
    bQrcodeFileId: record.b_qrcode_file_id,
    qrcodeTempUrl: record.qrcode_temp_url,
    targetType: record.targetType,
    envVersion: record.env_version,
    reused: record.reused,
    // 转存失败但 B 侧已成功时给前端一个明确提示，可稍后重试本动作。
    transferWarning: composedFileId ? '' : '二维码已在 B 侧生成，但转存 A 侧云存储失败，请稍后重试',
    // 新增：DIY Logo 合成状态三档枚举（前端可据此给用户明确提示，不再只给「生成成功」的 Toast）：
    //   has_logo → DB 里有 fileID + 下载/解码/合成全部成功 → 中心 Logo 正常展示
    //   missing → 文档里没有 diy_qrcode_image 字段（老机构 / 未部署新版 ForOrganizationDo / 传了空值）
    //              前端提示：点击编辑页补传 PNG/JPG 图片后重新生成
    //   download_or_decode_failed → 有 fileID 但云存储下载失败或图片格式（WEBP/GIF 等）不被支持
    //              前端提示：DIY Logo 下载失败，请确认上传图片为 PNG/JPG 格式后重新上传并生成
    diyLogoStatus,
  }
}

// 动作 2：查询机构入口二维码（前端展示用）。
// 优先返回机构文档里的 A 侧 fileID；同时向 B 侧确认入口状态并取最新临时链接，
// 若历史上转存失败（A 侧 fileID 为空），这里借 B 侧临时链接补一次转存自愈。
// 新增（诊断日志）：前端「展示二维码」按钮点击后看到空白，大多数是这几个点出问题：
// 1) 机构文档里 record 为空（先生成再查）；2) B 侧不可达；3) 自愈转存失败但没日志。
async function getOrganizationQrcode(event = {}, openid = '', isHttpCall = false) {
  const usersCollectionName = getCollectionName(USER_COLLECTION_BASE)
  const organizationCollectionName = getCollectionName(ORGANIZATION_COLLECTION_BASE)
  console.log('[NEWDL_ResponseQRCode][INFO] getOrganizationQrcode.start', {
    isHttpCall,
    hasOpenid: !!openid,
    hasOrganizationId: !!(event.organizationId || event.targetId),
  })

  const organizationDoc = await resolveTargetOrganization(
    event,
    openid,
    isHttpCall,
    usersCollectionName,
    organizationCollectionName
  )
  const organizationId = String((organizationDoc.organization_basic || {}).organization_id || '').trim()

  // 新增（与 generateOrganizationQrcode 对齐）：查询机构二维码的结果也要带 diyLogoStatus，
  // 否则「编辑态进页后直接展示二维码」的场景前端不知道 Logo 状态，用户只会看到「没 Logo 但没任何提示」。
  // 注意：查询场景默认不下载/解码 Logo（避免无谓的云存储读取开销 & 图片解码开销），
  // 所以 diyLogoStatus 仅基于 DB 字段状态做判断；后续若进入自愈分支（needSelfHeal=true）且有 Logo 时，
  // 自愈内部的下载/解码判断会把状态覆盖为 has_logo / download_or_decode_failed。
  let diyLogoStatus = 'missing'
  {
    const orgBasicLocal = organizationDoc.organization_basic || {}
    const diyFieldExists = Object.prototype.hasOwnProperty.call(orgBasicLocal, 'diy_qrcode_image')
    const diyFileId = String(orgBasicLocal.diy_qrcode_image || '').trim()
    if (diyFieldExists && diyFileId) {
      diyLogoStatus = 'has_logo' // DB 有值，先乐观标记 has_logo；若自愈分支解码失败会被覆盖为 download_or_decode_failed
    }
    // 新增：查询场景下的 DIY 状态快照日志（一条 INFO 足够；字段缺失时前端会给用户提示）
    console.log('[NEWDL_ResponseQRCode][INFO] getOrganizationQrcode.diy_logo.status_before_action', {
      organizationId,
      docId: organizationDoc._id,
      diyFieldExists,
      diyFileIdLooksValid: diyFileId.startsWith('cloud://'),
      diyFileIdPrefix: diyFileId ? diyFileId.slice(0, 40) : '',
      diyLogoStatus,
      note: '查询场景基于 DB 字段乐观判断；若进入自愈分支会在下载/解码后把该状态更新为真实结果',
    })
  }

  const record = getEntryQrcodeRecord(organizationDoc)
  if (!record || !String(record.entryId || '').trim()) {
    console.warn('[NEWDL_ResponseQRCode][WARN] getOrganizationQrcode.record_missing', {
      organizationId,
      hasRecord: !!record,
      recordEntryId: record ? record.entryId : '',
    })
    return {
      status: 'fail',
      code: 'NOT_GENERATED',
      message: '机构入口二维码尚未生成，请先生成'
    }
  }
  console.log('[NEWDL_ResponseQRCode][INFO] getOrganizationQrcode.local_record', {
    organizationId,
    entryId: record.entryId,
    hasComposedFileId: !!String(record.qrcode_file_id || '').trim(),
    hasRawFileId: !!String(record.raw_qrcode_file_id || '').trim(),
    recordStatus: String(record.status || '').trim(),
  })

  // 向 B 侧查询（不重新生成码），拿入口最新状态与临时链接；B 侧不可达时降级用本地记录。
  let bStatus = 'unreachable'
  let freshTempUrl = ''
  let bEntryId = record.entryId
  console.log('[NEWDL_ResponseQRCode][INFO] getOrganizationQrcode.call_b.start', {
    organizationId,
    targetId: organizationId,
  })
  try {
    const bRes = await postToBHttp(B_ACTION_GET, { targetId: organizationId })
    if (bRes.success) {
      bStatus = 'active'
      freshTempUrl = String((bRes.data || {}).qrcodeTempUrl || '').trim()
      bEntryId = String((bRes.data || {}).entryId || record.entryId).trim()
    } else if (Number((bRes.data || {}).code || 0) === 404) {
      bStatus = 'missing'
    } else {
      bStatus = 'error'
    }
    console.log('[NEWDL_ResponseQRCode][INFO] getOrganizationQrcode.call_b.result', {
      organizationId,
      bStatus,
      bSuccess: bRes.success,
      bCode: (bRes.data || {}).code || '',
      bEntryId,
      hasTempUrl: !!freshTempUrl,
    })
  } catch (error) {
    console.warn('[NEWDL_ResponseQRCode][WARN] getOrganizationQrcode.b_unreachable', {
      organizationId,
      message: error && error.message ? error.message : String(error),
    })
    bStatus = 'unreachable'
  }

  // 自愈：本地没有 A 侧 fileID 但 B 侧给了临时链接时，补一次转存并回写。
  // 新增（2026-09-04）：自愈补转存同样同时产出原始码 + 合成码两份，回写两个字段，互不影响。
  let composedFileId = String(record.qrcode_file_id || '').trim()
  let rawFileId = String(record.raw_qrcode_file_id || '').trim()
  const needSelfHeal = (!composedFileId || !rawFileId) && freshTempUrl
  if (needSelfHeal) {
    console.log('[NEWDL_ResponseQRCode][INFO] getOrganizationQrcode.self_heal.start', {
      organizationId,
      missingComposed: !composedFileId,
      missingRaw: !rawFileId,
      hasTempUrl: !!freshTempUrl,
    })
    // 新增：自愈补转存同样带 DIY Logo 合成，保证 A 侧展示的二维码始终带机构品牌图（教练头像 / 品牌 Logo）
    // 新增（诊断日志 - 与 generateOrganizationQrcode 对齐）：自愈场景是老机构/转存失败后再查二维码时触发，
    // 同样需要核对 diy_qrcode_image 字段在 DB 里是否存在值，区分「空值」「下载失败」「格式错」。
    const organizationBasicSelfHeal = organizationDoc.organization_basic || {}
    const diyQrcodeImageFileId = String(organizationBasicSelfHeal.diy_qrcode_image || '').trim()
    console.log('[NEWDL_ResponseQRCode][INFO] getOrganizationQrcode.self_heal.diy_logo.read_db', {
      organizationId,
      docId: organizationDoc._id,
      orgBasicTopKeys: Object.keys(organizationBasicSelfHeal).slice(0, 20),
      diyFieldType: typeof organizationBasicSelfHeal.diy_qrcode_image,
      diyFieldRaw: organizationBasicSelfHeal.diy_qrcode_image == null ? '<null|undefined>' : String(organizationBasicSelfHeal.diy_qrcode_image),
      diyFileIdTrimmed: diyQrcodeImageFileId,
      diyFileIdLooksValid: diyQrcodeImageFileId.startsWith('cloud://'),
    })
    const diyLogoBuffer = diyQrcodeImageFileId ? await downloadAFileBuffer(diyQrcodeImageFileId) : null
    if (diyQrcodeImageFileId && !diyLogoBuffer) {
      console.warn('[NEWDL_ResponseQRCode][WARN] getOrganizationQrcode.self_heal_diy_logo_unavailable', {
        organizationId,
        diyQrcodeImageFileId,
      })
      // 自愈场景有 fileId 但下载/解码失败 → 覆盖查询场景的乐观判断，明确告诉前端真实状态
      diyLogoStatus = 'download_or_decode_failed'
    } else if (diyLogoBuffer) {
      const magic = diyLogoBuffer.length >= 4
        ? Array.from(diyLogoBuffer.slice(0, 4)).map((b) => b.toString(16).padStart(2, '0')).join(' ')
        : ''
      console.log('[NEWDL_ResponseQRCode][INFO] getOrganizationQrcode.self_heal_diy_logo.download_ok', {
        organizationId,
        diyQrcodeImageFileIdPrefix: String(diyQrcodeImageFileId).slice(0, 60),
        logoBufferLen: diyLogoBuffer.length,
        logoMagicHex: magic,
      })
      // 自愈场景成功下载到 buffer → 真实标记为 has_logo（查询场景之前如果因为字段空设成 missing，这里覆盖掉）
      diyLogoStatus = 'has_logo'
    }
    const selfHealResult = await transferQrToAStorage(freshTempUrl, organizationId, diyLogoBuffer)
    let patched = false
    if (selfHealResult.composedFileId) {
      composedFileId = selfHealResult.composedFileId
      patched = true
    }
    if (selfHealResult.rawFileId) {
      rawFileId = selfHealResult.rawFileId
      patched = true
    }
    console.log('[NEWDL_ResponseQRCode][INFO] getOrganizationQrcode.self_heal.result', {
      organizationId,
      composedOk: !!(selfHealResult && selfHealResult.composedFileId),
      rawOk: !!(selfHealResult && selfHealResult.rawFileId),
      patched,
    })
    if (patched) {
      try {
        const patchedRecord = { ...record, qrcode_file_id: composedFileId, raw_qrcode_file_id: rawFileId, qrcode_temp_url: freshTempUrl, updated_at: new Date() }
        await db.collection(organizationCollectionName).doc(organizationDoc._id).update({
          data: { [ORG_QR_FIELD]: patchedRecord }
        })
        console.log('[NEWDL_ResponseQRCode][INFO] getOrganizationQrcode.self_heal.patch_ok', {
          organizationId,
          docId: organizationDoc._id,
        })
      } catch (dbErr) {
        console.error('[NEWDL_ResponseQRCode][ERROR] getOrganizationQrcode.self_heal.patch_fail', {
          organizationId,
          docId: organizationDoc._id,
          message: dbErr && dbErr.message ? dbErr.message : String(dbErr),
        })
        // DB 回写失败不抛给主流程，前端本次仍可通过 freshTempUrl 展示二维码，下次查询再自愈一次。
      }
    }
  }

  const result = {
    status: 'success',
    message: '查询成功',
    entryId: bEntryId,
    scene: String(record.scene || bEntryId || '').trim(),
    qrcodeFileId: composedFileId,
    rawQrcodeFileId: rawFileId,
    bQrcodeFileId: String(record.b_qrcode_file_id || '').trim(),
    qrcodeTempUrl: freshTempUrl || String(record.qrcode_temp_url || '').trim(),
    targetType: record.targetType || TARGET_TYPE_ORGANIZATION,
    envVersion: record.env_version || '',
    recordStatus: String(record.status || '').trim(),
    bStatus,
    // 新增：与 generateOrganizationQrcode 返回对齐（三档枚举：missing/has_logo/download_or_decode_failed）。
    // 查询场景下的状态含义：
    //   has_logo → DB 字段存在且值非空；若本次还执行了自愈且下载/解码成功，则确认 Logo 已成功合成
    //   missing → DB 字段不存在或值为空（老机构 / 未部署新版 ForOrganizationDo），前端提示编辑页补传
    //   download_or_decode_failed → 本次进入自愈分支下载/解码失败（格式错或云存储不可达），前端提示换图片重试
    diyLogoStatus,
  }
  console.log('[NEWDL_ResponseQRCode][INFO] getOrganizationQrcode.complete', {
    organizationId,
    entryId: result.entryId,
    hasComposedFileId: !!result.qrcodeFileId,
    hasRawFileId: !!result.rawQrcodeFileId,
    hasTempUrl: !!result.qrcodeTempUrl,
    bStatus,
  })
  return result
}

// 动作 3：刷新 B 侧入口快照（机构改了名称 / 简介 / 品牌图后调用）。
// 只更新 B 侧展示快照，不触碰二维码本身，避免无谓重新生成。
// 新增（诊断日志）：机构编辑后刷快照经常被反馈「扫码后名称还是旧的」，补齐每个分支的日志，
// 便于区分是本地没 entryId、B 侧调用失败、还是 DB 回写失败。
async function refreshOrganizationSnapshot(event = {}, openid = '', isHttpCall = false) {
  const usersCollectionName = getCollectionName(USER_COLLECTION_BASE)
  const organizationCollectionName = getCollectionName(ORGANIZATION_COLLECTION_BASE)
  console.log('[NEWDL_ResponseQRCode][INFO] refreshOrganizationSnapshot.start', {
    isHttpCall,
    hasOpenid: !!openid,
    hasOrganizationId: !!(event.organizationId || event.targetId),
  })

  const organizationDoc = await resolveTargetOrganization(
    event,
    openid,
    isHttpCall,
    usersCollectionName,
    organizationCollectionName
  )
  const organizationId = String((organizationDoc.organization_basic || {}).organization_id || '').trim()
  const record = getEntryQrcodeRecord(organizationDoc)
  const entryId = String((record && record.entryId) || '').trim()
  if (!entryId) {
    console.warn('[NEWDL_ResponseQRCode][WARN] refreshOrganizationSnapshot.no_entryid', { organizationId })
    return {
      status: 'fail',
      code: 'NOT_GENERATED',
      message: '机构入口二维码尚未生成，无需刷新快照'
    }
  }

  const snapshot = buildOrganizationSnapshot(organizationDoc)
  console.log('[NEWDL_ResponseQRCode][INFO] refreshOrganizationSnapshot.call_b.start', {
    organizationId,
    entryId,
    snapshotKeys: Object.keys(snapshot),
    institutionName: snapshot.institutionName || '',
  })
  const bRes = await postToBHttp(B_ACTION_REFRESH_SNAPSHOT, { entryId, snapshot })
  console.log('[NEWDL_ResponseQRCode][INFO] refreshOrganizationSnapshot.call_b.result', {
    organizationId,
    entryId,
    bSuccess: bRes.success,
    bStatusCode: bRes.statusCode,
    bCode: (bRes.data || {}).code || '',
    bMessage: String(((bRes.data || {}).message || (bRes.data || {}).errorMessage || '')).slice(0, 200),
  })
  if (!bRes.success) {
    return {
      status: 'fail',
      message: `B 侧刷新快照失败：${bRes.data.message || bRes.data.errorMessage || '未知错误'}`,
      bCode: bRes.data.code || bRes.statusCode
    }
  }

  // 同步更新本地缓存快照。
  const patchedRecord = { ...record, snapshot, updated_at: new Date() }
  try {
    await db.collection(organizationCollectionName).doc(organizationDoc._id).update({
      data: { [ORG_QR_FIELD]: patchedRecord }
    })
    console.log('[NEWDL_ResponseQRCode][INFO] refreshOrganizationSnapshot.patch_local.ok', {
      organizationId,
      docId: organizationDoc._id,
      entryId,
    })
  } catch (dbErr) {
    console.error('[NEWDL_ResponseQRCode][ERROR] refreshOrganizationSnapshot.patch_local.fail', {
      organizationId,
      docId: organizationDoc._id,
      entryId,
      message: dbErr && dbErr.message ? dbErr.message : String(dbErr),
    })
    // 本地快照回写失败时：B 侧实际已生效，前端拿不到错误，这里不抛阻断，只打日志；下次查询会再拉到机构文档最新 snapshot 覆盖。
  }

  return {
    status: 'success',
    message: '机构入口快照已刷新',
    entryId,
    targetId: organizationId
  }
}

// 动作 4：停用机构入口二维码（机构停用 / 二维码作废时调用）。
// B 侧无法吊销已发出去的小程序码图片，靠 resolve_entry 查不到 active 记录来拦截扫码。
// 新增（诊断日志）：机构停用入口是敏感动作，必须完整打印 B 侧返回 + 本地 DB 状态切换，便于事后审计。
async function disableOrganizationQrcode(event = {}, openid = '', isHttpCall = false) {
  const usersCollectionName = getCollectionName(USER_COLLECTION_BASE)
  const organizationCollectionName = getCollectionName(ORGANIZATION_COLLECTION_BASE)
  console.log('[NEWDL_ResponseQRCode][INFO] disableOrganizationQrcode.start', {
    isHttpCall,
    hasOpenid: !!openid,
    hasOrganizationId: !!(event.organizationId || event.targetId),
  })

  const organizationDoc = await resolveTargetOrganization(
    event,
    openid,
    isHttpCall,
    usersCollectionName,
    organizationCollectionName
  )
  const organizationId = String((organizationDoc.organization_basic || {}).organization_id || '').trim()
  const record = getEntryQrcodeRecord(organizationDoc)
  const entryId = String((record && record.entryId) || '').trim()
  const oldLocalStatus = String((record && record.status) || '').trim()
  if (!entryId) {
    console.warn('[NEWDL_ResponseQRCode][WARN] disableOrganizationQrcode.no_entryid', { organizationId })
    return {
      status: 'fail',
      code: 'NOT_GENERATED',
      message: '机构入口二维码尚未生成，无需停用'
    }
  }

  // 调 B 侧停用；B 侧返回 404（记录本来就不存在）也视为停用成功。
  let bOk = true
  let bMessage = ''
  let bStatusCode = 0
  let bCode = 0
  try {
    console.log('[NEWDL_ResponseQRCode][INFO] disableOrganizationQrcode.call_b.start', {
      organizationId,
      entryId,
    })
    const bRes = await postToBHttp(B_ACTION_DISABLE, { entryId })
    bStatusCode = bRes.statusCode
    bCode = Number((bRes.data || {}).code || 0)
    bOk = bRes.success || bCode === 404
    bMessage = (bRes.data || {}).message || ''
    console.log('[NEWDL_ResponseQRCode][INFO] disableOrganizationQrcode.call_b.result', {
      organizationId,
      entryId,
      bSuccess: bRes.success,
      bStatusCode,
      bCode,
      bOk,
      treat404AsOk: bCode === 404,
      bMessage: String(bMessage).slice(0, 200),
    })
  } catch (error) {
    bOk = false
    bMessage = error && error.message ? error.message : String(error)
    console.error('[NEWDL_ResponseQRCode][ERROR] disableOrganizationQrcode.call_b.exception', {
      organizationId,
      entryId,
      message: bMessage,
    })
  }

  // 本地记录无论 B 侧结果如何都标记 disabled（B 侧 404 等价于已停用）；B 侧不可达时保留状态待重试。
  const nextStatus = bOk ? 'disabled' : oldLocalStatus || 'active'
  const patchedRecord = {
    ...record,
    status: nextStatus,
    disabled_at: bOk ? new Date() : (record && record.disabled_at) || null,
    updated_at: new Date()
  }
  try {
    await db.collection(organizationCollectionName).doc(organizationDoc._id).update({
      data: { [ORG_QR_FIELD]: patchedRecord }
    })
    console.log('[NEWDL_ResponseQRCode][INFO] disableOrganizationQrcode.patch_local.ok', {
      organizationId,
      docId: organizationDoc._id,
      entryId,
      oldStatus: oldLocalStatus,
      newStatus: nextStatus,
    })
  } catch (dbErr) {
    console.error('[NEWDL_ResponseQRCode][ERROR] disableOrganizationQrcode.patch_local.fail', {
      organizationId,
      docId: organizationDoc._id,
      entryId,
      intendedStatus: nextStatus,
      message: dbErr && dbErr.message ? dbErr.message : String(dbErr),
    })
    throw dbErr
  }

  if (!bOk) {
    return {
      status: 'fail',
      message: `B 侧停用失败：${bMessage}；本地状态未改动，请稍后重试`,
      entryId
    }
  }

  return {
    status: 'success',
    message: '机构入口二维码已停用',
    entryId
  }
}

// ===== 动作分发 =====
const ACTION_HANDLERS = {
  generateOrganizationQrcode,
  getOrganizationQrcode,
  refreshOrganizationSnapshot,
  disableOrganizationQrcode
}

async function handleMain(event = {}, context = {}) {
  CURRENT_ENV_VERSION = event.envVersion || 'develop'

  // callFunction 模式能拿到微信 openid；HTTP 云函数模式是普通 HTTP 请求，没有微信身份。
  let openid = ''
  try {
    openid = (cloud.getWXContext() || {}).OPENID || ''
  } catch (error) {
    openid = ''
  }
  const isHttpCall = !openid

  logRuntimeEnvInfo({
    action: event.action || '',
    hasOpenid: !!openid,
    isHttpCall
  })

  const action = normalizeStr(event.action, 64)
  // 入口日志：打印 action 与关键入参快照，便于从日志反推前端传了什么。
  console.log('[NEWDL_ResponseQRCode][INFO] handleMain.entry', {
    action,
    isHttpCall,
    hasOpenid: !!openid,
    organizationId: event.organizationId || '',
    targetId: event.targetId || '',
    entryId: event.entryId || '',
    envVersion: event.envVersion || ''
  })
  const handler = ACTION_HANDLERS[action]
  if (!handler) {
    console.warn('[NEWDL_ResponseQRCode][WARN] handleMain.unknown_action', { action })
    return {
      status: 'fail',
      message: `不支持的二维码操作类型：${action || '(空)'}`
    }
  }

  try {
    const result = await handler(event, openid, isHttpCall)
    // 出口日志：打印 action 执行结果摘要，便于排查整条链路。
    console.log('[NEWDL_ResponseQRCode][INFO] handleMain.complete', {
      action,
      status: result ? result.status : '',
      bCode: result ? result.bCode : '',
      wxErrcode: result ? result.wxErrcode : '',
      message: result ? String(result.message || '').slice(0, 200) : '',
      entryId: result ? result.entryId : ''
    })
    return result
  } catch (error) {
    console.error('[NEWDL_ResponseQRCode][ERROR] handleMain.fail', {
      action,
      message: error && (error.message || error.errMsg) || String(error),
      stack: error && error.stack ? String(error.stack).slice(0, 1000) : ''
    })
    return {
      status: 'fail',
      message: error && error.message ? error.message : '二维码联动操作失败'
    }
  }
}

exports.main = handleMain
module.exports = { main: handleMain, startHttpServer }

// ===== HTTP 云函数入口（监听 9000，镜像 B 侧 DLforP_entry_qrcode 的模式）=====
function writeJson(res, status, body) {
  const payload = JSON.stringify(body || {})
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  })
  res.end(payload)
}

// 收集 POST body，最大 1MB，防止超大请求打满内存。
function collectRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

// 把 HTTP 请求（query + body）拼成云函数风格的 event，复用同一套 handleMain。
// 新增（诊断日志）：与 B 侧 buildHttpEvent 同样补齐 JSON / querystring 解析失败日志，
// 避免前端调 HTTP 云函数时 body 格式错了却只看到「不支持的操作类型」，找不到根因。
async function buildHttpEvent(req, rawBody = '') {
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')
  const event = { action: '' }

  // query 参数优先。
  let queryParamCount = 0
  requestUrl.searchParams.forEach((value, key) => {
    event[key] = value
    queryParamCount += 1
  })

  // POST body：JSON 直接合并；querystring 形式也兼容。
  const bodyText = typeof rawBody === 'string' ? rawBody.trim() : ''
  if (bodyText) {
    if (bodyText.startsWith('{')) {
      try {
        const parsedBody = JSON.parse(bodyText)
        const bodyKeyCount = Object.keys(parsedBody).length
        Object.assign(event, parsedBody)
        console.log('[NEWDL_ResponseQRCode][INFO] buildHttpEvent.json_body.merge_ok', {
          queryParamCount,
          bodyKeyCount,
          bodyTopKeys: Object.keys(parsedBody).slice(0, 10),
        })
      } catch (e) {
        // 新增：JSON 解析失败被静默吞掉 → 前端经常看到 action 为空但日志毫无线索，现在明确打出。
        console.warn('[NEWDL_ResponseQRCode][WARN] buildHttpEvent.json_body.parse_fail', {
          queryParamCount,
          bodyLen: bodyText.length,
          bodyPreview: bodyText.slice(0, 200),
          parseError: e && e.message ? e.message : String(e),
          fallback: 'ignore_body_use_query_only',
        })
      }
    } else {
      try {
        const bodyUrl = new URL(`?${bodyText}`, 'http://127.0.0.1')
        let bodyParamCount = 0
        bodyUrl.searchParams.forEach((value, key) => {
          event[key] = value
          bodyParamCount += 1
        })
        console.log('[NEWDL_ResponseQRCode][INFO] buildHttpEvent.qs_body.merge_ok', {
          queryParamCount,
          bodyParamCount,
        })
      } catch (qsErr) {
        console.warn('[NEWDL_ResponseQRCode][WARN] buildHttpEvent.qs_body.parse_fail', {
          queryParamCount,
          bodyLen: bodyText.length,
          bodyPreview: bodyText.slice(0, 200),
          parseError: qsErr && qsErr.message ? qsErr.message : String(qsErr),
          fallback: 'ignore_body_use_query_only',
        })
      }
    }
  }

  return event
}

// 启动 9000 端口 HTTP 服务：由 scf_bootstrap 执行 `node index.js` 触发，
// 也由本文件被直接 `node dev_index.js` 调试时触发。
function startHttpServer() {
  const port = Number(process.env.PORT || 9000) || 9000

  const server = http.createServer(async (req, res) => {
    try {
      const method = String(req.method || 'GET').toUpperCase()
      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')

      console.log('[NEWDL_ResponseQRCode][INFO] http.request', {
        method,
        path: requestUrl.pathname,
        search: requestUrl.search || ''
      })

      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'content-type, authorization',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
        })
        res.end()
        return
      }

      // 健康检查：GET / 或 /health 无业务参数时返回探活信息。
      if (
        requestUrl.pathname === '/health' ||
        (requestUrl.pathname === '/' && method === 'GET' && !requestUrl.search)
      ) {
        writeJson(res, 200, {
          status: 'success',
          message: 'NEWDL_ResponseQRCode HTTP 云函数已启动',
          aEnv: A_ENV_ID,
          bTarget: B_QRCODE_HTTP_BASE_URL
        })
        return
      }

      const rawBody = method === 'POST' ? await collectRequestBody(req) : ''
      // 打印请求体大小与预览，便于排查 A 侧前端调用是否带 organizationId。
      console.log('[NEWDL_ResponseQRCode][INFO] http.body.received', {
        method,
        bodyLen: rawBody ? rawBody.length : 0,
        bodyPreview: rawBody ? String(rawBody).slice(0, 300) : ''
      })
      const event = await buildHttpEvent(req, rawBody)
      // 打印解析后的 event 关键字段，便于定位 organizationId 是否被正确识别。
      console.log('[NEWDL_ResponseQRCode][INFO] http.event.parsed', {
        action: event.action || '',
        organizationId: event.organizationId || '',
        targetId: event.targetId || '',
        entryId: event.entryId || '',
        envVersion: event.envVersion || ''
      })
      const result = await handleMain(event, {})
      // 打印响应摘要，便于排查 A 侧最终给前端 / 调用方返回了什么。
      console.log('[NEWDL_ResponseQRCode][INFO] http.response.send', {
        httpStatus: 200,
        status: result ? result.status : '',
        message: result ? String(result.message || '').slice(0, 200) : '',
        entryId: result ? result.entryId : '',
        wxErrcode: result ? result.wxErrcode : ''
      })
      writeJson(res, 200, result)
    } catch (error) {
      console.error('[NEWDL_ResponseQRCode][ERROR] http.fail', {
        message: error && (error.message || error.errMsg) || String(error),
        stack: error && error.stack || ''
      })
      writeJson(res, 500, {
        status: 'fail',
        message: 'NEWDL_ResponseQRCode HTTP 服务执行失败',
        errorMessage: error && (error.message || error.errMsg) || String(error)
      })
    }
  })

  server.listen(port, '0.0.0.0', () => {
    console.log('[NEWDL_ResponseQRCode][INFO] http.listen', { port })
  })
}

// 本地直接 `node dev_index.js` 调试时自启动；线上由 index.js 在 require.main === module 时启动。
if (require.main === module) {
  startHttpServer()
}
