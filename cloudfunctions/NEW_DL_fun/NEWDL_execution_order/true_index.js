
const https = require('https')
const cloud = require('wx-server-sdk')
cloud.init({ env: 'cloud1-6gh7jgl8c5b16a83' });

const db = cloud.database()
const _ = db.command
// 新增集合前缀规则：develop 使用 NDLdev_，trial/release 使用 NDLreal_
const ORDER_COLLECTION_BASE = 'execution_orders'
const USER_COLLECTION_BASE = 'users'
const ORGANIZATION_COLLECTION_BASE = 'organization'
const CURRENT_RUNTIME_SOURCE = 'dev_index.js'
let CURRENT_ENV_VERSION = 'develop'
const ACTION_SYNC_PARENT_BOOKING_TO_A = 'syncParentBookingToA'
const ACTION_SYNC_COACH_RESULT_TO_B = 'syncCoachResultToB'
const SOURCE_FROM_A_DIRECT = '在小程序A由教练直接提交'
const SOURCE_FROM_B_PARENT = '在小程序B由家长提交经过api中转进入小程序A移交教练操作'
const BRIDGE_STATUS_PENDING = 'pending'
const BRIDGE_STATUS_SYNCED = 'synced'
const BRIDGE_STATUS_FAILED = 'failed'
// 新增 A -> B 回抄地址：当前先按和 A 侧同一云环境的 HTTP 路由拼接。
// 如果 B 侧后续切换了独立路由，只需要改这里，不动业务函数。
const B_HTTP_BASE_URL = 'https://cloud1-6gh7jgl8c5b16a83-1398046944.ap-shanghai.app.tcloudbase.com/twowaybinding_1_DLforP'

function getCollectionPrefix() {
  return CURRENT_ENV_VERSION === 'develop' ? 'NDLdev_' : 'NDLreal_'
}

function getCollectionName(baseName) {
  return `${getCollectionPrefix()}${baseName}`
}

// 新增运行环境日志：用于快速判断当前云函数这次到底按什么环境、什么源码文件在执行
function logRuntimeEnvInfo(extra = {}) {
  console.log('[runtime_env]', {
    functionName: 'NEWDL_execution_order',
    runtimeSource: CURRENT_RUNTIME_SOURCE,
    envVersion: CURRENT_ENV_VERSION,
    collectionPrefix: getCollectionPrefix(),
    ...extra
  })
}

function normalizeCollectionName(collectionName) {
  if (!collectionName) return ''
  if (collectionName.startsWith('NDLdev_') || collectionName.startsWith('NDLreal_')) {
    return collectionName
  }
  return getCollectionName(collectionName)
}

// 新增 HTTP 查询字符串兼容：B 侧经 GET 中转时，数组和对象会先变成 JSON 字符串，这里统一回收成对象。
function parseJsonLike(value, fallbackValue) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return fallbackValue
  }

  if (typeof value === 'object') {
    return value
  }

  const text = String(value || '').trim()
  if (!text) {
    return fallbackValue
  }

  try {
    return JSON.parse(text)
  } catch (error) {
    return fallbackValue
  }
}

// 新增手机号标准化：课程联系方式统一收口成 11 位纯数字，避免空格和分隔符污染订单数据
function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').slice(0, 11)
}

// 新增手机号格式校验：发布班课程时只接受中国大陆 11 位手机号
function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(normalizePhone(phone))
}

// 新增机构归属标准化：课程如果属于机构，统一收口成 orgId / orgName / memberRole / inviteCode 四个字段
function normalizeOrderOrganizationInfo(orderOrgInfo = {}) {
  return {
    orgId: String(orderOrgInfo.orgId || orderOrgInfo.organizationId || '').trim(),
    orgName: String(orderOrgInfo.orgName || orderOrgInfo.organizationName || '').trim(),
    memberRole: String(orderOrgInfo.memberRole || orderOrgInfo.orgMemberRole || '').trim(),
    inviteCode: String(orderOrgInfo.inviteCode || orderOrgInfo.invitationCode || '').trim()
  }
}

function normalizeInviteCode(code = '') {
  return String(code || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 16)
}

// 新增协作课程码标准化：家长从小程序 B 带过来的课程码统一去空格并转大写，减少人工输入时的脏值影响。
function normalizeCourseCode(code = '') {
  return String(code || '').replace(/\s+/g, '').trim().toUpperCase()
}

// 新增课程码候选值：兼容直接输入原值、去空格值和大小写差异，按最小成本做一次兜底查询。
function buildCourseCodeVariants(code = '') {
  const rawCode = String(code || '').trim()
  const compactCode = rawCode.replace(/\s+/g, '')
  const upperCode = normalizeCourseCode(code)
  const lowerCode = upperCode.toLowerCase()

  return Array.from(new Set([
    rawCode,
    compactCode,
    upperCode,
    lowerCode
  ].filter(Boolean)))
}

// 新增：M 码统一规则（来自用户的「码兼容问题」规范）：
// - 情况1 B 约课：码前缀 B，格式 BXXXXXXX，共 8 位；表示 fromB
// - 情况2 A 直建：码前缀 A，格式 AXXXXXXX，共 8 位；表示 fromA
// 随机位字符表同样去掉 0/O/1/I/L，降低肉眼识别和手抄误输概率；
// 7 位随机 × 32 字符 = 32^7 ≈ 343 亿，单前缀已覆盖常规业务量。
const M_CODE_CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const M_CODE_RAND_LENGTH = 7
const M_CODE_GENERATE_MAX_RETRY = 10
// 新增：前缀常量，统一 A/B 两端取值口径，避免业务里写死字符串造成不一致
const M_CODE_PREFIX_FROM_A = 'A'
const M_CODE_PREFIX_FROM_B = 'B'
// 新增：教练「接取码」辅助常量。完整接取码 = 8 位 M 码（班级码） + 4 位确认码，共 12 位。
// 教练端输入这 12 位即可认领课程；发布者可重置确认码使旧接取码失效。
const PICKUP_CONFIRM_CODE_LENGTH = 4
const PICKUP_FULL_CODE_LENGTH = 12 // = 8(M 码) + 4(确认码)
// 新增：执行教练确认接取后的固定尾码。
// 这里不改原始 12 位接取码校验规则，只额外生成一组“12 位接取码 + DL”的确认展示码，
// 方便管理层和执行教练在页面上一眼识别“这门课已经被真人确认接取”。
const PICKUP_FINAL_CODE_SUFFIX = 'DL'

// 新增：构造符合 8 位「前缀 + 随机位」格式的候选串（不做唯一性校验）
function buildMCandidate(prefix) {
  const safePrefix = String(prefix || '').trim().toUpperCase().slice(0, 1)
  let randPart = ''
  const ts = Date.now()
  let seed = ts & 0x7fffffff
  for (let i = 0; i < M_CODE_RAND_LENGTH; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const randomByte = (seed ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
    const idx = randomByte % M_CODE_CHARSET.length
    randPart += M_CODE_CHARSET[idx]
  }
  return `${safePrefix}${randPart}`
}

// 新增：判断某个 M 码是否已占用；覆盖所有会展示给用户的课程码字段：
// joinCode / courseCode / parent_course_code 任一命中即视为冲突，保证教练 / 家长两端都不会拿到重复码。
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
// 最多重试 10 次；如果仍冲突，返回一条降级候选并打 warning，保证创建流程不被阻塞。
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

// 新增：构造 4 位「接取确认码」，字符表与 M 码一致（同样规避易混淆字符）。
// 4 位 × 32 字符 ≈ 100 万组合，暴力撞码概率可控；发布者还可手动重置。
function buildPickupConfirmCode() {
  let result = ''
  const ts = Date.now()
  let seed = ts & 0x7fffffff
  for (let i = 0; i < PICKUP_CONFIRM_CODE_LENGTH; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const randomByte = (seed ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
    const idx = randomByte % M_CODE_CHARSET.length
    result += M_CODE_CHARSET[idx]
  }
  return result
}

// 新增：完整「12 位接取码」标准化。用户输入时可能带空格、分隔符、大小写不一致，
// 这里统一去非字母数字、转大写，并严格限制 12 位。不符合时返回空串。
function normalizePickupFullCode(rawCode = '') {
  const cleaned = String(rawCode || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  if (cleaned.length !== PICKUP_FULL_CODE_LENGTH) {
    return ''
  }
  return cleaned
}

// 新增：从 12 位完整接取码中拆出「8 位 M 码(班级码)」 + 「4 位确认码」
function splitPickupFullCode(fullCode = '') {
  const safeCode = normalizePickupFullCode(fullCode)
  if (!safeCode) {
    return { courseCode: '', confirmCode: '' }
  }
  return {
    courseCode: safeCode.slice(0, 8),
    confirmCode: safeCode.slice(8, 12)
  }
}

// 新增：拼接 12 位完整接取码
function buildPickupFullCode(courseCode = '', confirmCode = '') {
  const safeCourse = normalizeCourseCode(courseCode)
  const safeConfirm = String(confirmCode || '').toUpperCase().replace(/[^a-zA-Z0-9]/g, '').slice(0, PICKUP_CONFIRM_CODE_LENGTH)
  if (safeCourse.length !== 8 || safeConfirm.length !== PICKUP_CONFIRM_CODE_LENGTH) {
    return ''
  }
  return `${safeCourse}${safeConfirm}`
}

// 新增：执行教练确认接取后的展示码。
// 规则固定为“12 位完整接取码 + DL”，例如 A1234567ABCDDL。
function buildPickupFinalCode(fullCode = '') {
  const safeFullCode = normalizePickupFullCode(fullCode)
  if (!safeFullCode) {
    return ''
  }
  return `${safeFullCode}${PICKUP_FINAL_CODE_SUFFIX}`
}

function buildQueryString(payload = {}) {
  const query = new URLSearchParams()

  Object.keys(payload || {}).forEach((key) => {
    const value = payload[key]

    if (typeof value === 'undefined') {
      return
    }

    if (value === null) {
      query.append(key, '')
      return
    }

    if (typeof value === 'object') {
      query.append(key, JSON.stringify(value))
      return
    }

    query.append(key, String(value))
  })

  return query.toString()
}

// 新增来源兜底：A 端直提单如果还没写 source，统一按教练直接提交处理。
function getOrderSource(order = {}) {
  return String(order.source || '').trim() || SOURCE_FROM_A_DIRECT
}

// 新增回抄判定：只有 B 转交过来的单，才需要把 A 侧执行结果再同步回 B。
function shouldSyncResultToB(order = {}) {
  return getOrderSource(order) === SOURCE_FROM_B_PARENT && (
    String(order.from_b_form_id || '').trim() ||
    String(order.from_b_course_id || '').trim() ||
    String(order.from_b_openid || '').trim()
  )
}

function getRecordedLessonSummary(order = {}) {
  const courseFlowInfo = getCourseFlowInfo(order)
  const schedule = Array.isArray(courseFlowInfo.schedule)
    ? courseFlowInfo.schedule
    : (Array.isArray(order.schedule) ? order.schedule : [])

  const recordedLessons = schedule
    .filter(item => isLessonRecorded(item) || String((item || {}).summary || '').trim())
    .sort((left, right) => currentSafeNumber(left.lesson) - currentSafeNumber(right.lesson))

  const latestLesson = recordedLessons.length ? recordedLessons[recordedLessons.length - 1] : null
  if (!latestLesson) {
    return null
  }

  return {
    lesson: latestLesson.lesson || 0,
    summary: latestLesson.summary || '',
    summaryDate: latestLesson.summaryDate || '',
    startedAt: latestLesson.startedAt || '',
    completedAt: latestLesson.completedAt || '',
    rating: typeof latestLesson.rating === 'undefined' ? '' : latestLesson.rating,
    ratingTags: Array.isArray(latestLesson.ratingTags) ? latestLesson.ratingTags : [],
    dimensionRatings: latestLesson.dimensionRatings || {},
    summaryUpdatedAt: latestLesson.summaryUpdatedAt || ''
  }
}

function buildCoachResultSyncPayload(order = {}, extra = {}) {
  const courseFlowInfo = getCourseFlowInfo(order)
  const schedule = Array.isArray(courseFlowInfo.schedule)
    ? courseFlowInfo.schedule
    : (Array.isArray(order.schedule) ? order.schedule : [])

  return {
    action: ACTION_SYNC_COACH_RESULT_TO_B,
    source: SOURCE_FROM_B_PARENT,
    a_order_id: String(order._id || '').trim(),
    from_b_form_id: String(order.from_b_form_id || '').trim(),
    from_b_course_id: String(order.from_b_course_id || '').trim(),
    from_b_openid: String(order.from_b_openid || '').trim(),
    sync_reason: String(extra.syncReason || '').trim(),
    a_result_snapshot: {
      source: getOrderSource(order),
      publish_state: courseFlowInfo.publish_state || order.publish_state || '',
      fulfill_state: courseFlowInfo.fulfill_state || order.fulfill_state || '',
      progress_total: currentSafeNumber(courseFlowInfo.progress_total || order.progress_total || 0),
      progress_done: currentSafeNumber(courseFlowInfo.progress_done || order.progress_done || 0),
      close_summary: String(courseFlowInfo.close_summary || '').trim(),
      close_coach_note: String(courseFlowInfo.close_coach_note || '').trim(),
      cancel_reason: String(courseFlowInfo.cancelReason || '').trim(),
      closed_at: courseFlowInfo.closedAt || '',
      cancelled_at: courseFlowInfo.cancelledAt || '',
      completed_at: courseFlowInfo.completedAt || '',
      latest_lesson: getRecordedLessonSummary(order),
      schedule_stats: {
        total_schedule_count: schedule.length,
        recorded_lesson_count: schedule.filter(item => isLessonRecorded(item)).length
      },
      updatedAt: order.updatedAt || courseFlowInfo.updatedAt || new Date()
    }
  }
}

function requestBHttpApi(payload = {}) {
  const queryString = buildQueryString(payload)
  const requestUrl = queryString ? `${B_HTTP_BASE_URL}?${queryString}` : B_HTTP_BASE_URL

  return new Promise((resolve, reject) => {
    https.get(requestUrl, (response) => {
      let rawText = ''

      response.on('data', (chunk) => {
        rawText += chunk
      })

      response.on('end', () => {
        let parsedBody = rawText

        try {
          parsedBody = rawText ? JSON.parse(rawText) : {}
        } catch (error) {
          parsedBody = {
            success: false,
            message: 'B 侧返回的不是 JSON',
            rawText
          }
        }

        resolve({
          success: (response.statusCode || 0) < 400 && (!parsedBody || parsedBody.success !== false),
          requestUrl,
          statusCode: response.statusCode || 0,
          data: parsedBody
        })
      })
    }).on('error', reject)
  })
}

async function syncCoachResultToBIfNeeded(order = {}, syncReason = '') {
  if (!shouldSyncResultToB(order)) {
    return {
      skipped: true,
      reason: 'not_from_b'
    }
  }

  const payload = buildCoachResultSyncPayload(order, {
    syncReason
  })

  try {
    const result = await requestBHttpApi(payload)
    console.log('[execution_order][syncCoachResultToB][success]', {
      orderId: order._id || '',
      requestUrl: result.requestUrl,
      fromBFormId: payload.from_b_form_id,
      fromBCourseId: payload.from_b_course_id,
      syncReason
    })
    return result
  } catch (error) {
    console.error('[execution_order][syncCoachResultToB][fail]', {
      orderId: order._id || '',
      fromBFormId: payload.from_b_form_id,
      fromBCourseId: payload.from_b_course_id,
      syncReason,
      message: error && (error.message || error.errMsg) || String(error)
    })
    return {
      success: false,
      message: error && (error.message || error.errMsg) || String(error)
    }
  }
}

function buildGroupedOrderPayload(submitForm = {}) {
  const courseTarget = submitForm.course_target || {}
  const courseBasic = submitForm.course_basic || {}
  const childProfile = submitForm.child_profile || {}
  const coachPrivate = submitForm.coach_private || {}
  const orderBaseInfo = submitForm.order_base_info || {}
  const teachingRecord = submitForm.teaching_record || {}
  const courseConfig = submitForm.course_config || {}
  const courseBasicInfo = submitForm.course_basic_info || {}
  const courseFlowInfo = submitForm.course_flow_info || {}
  const shareVisibility = submitForm.share_visibility || {}
  const otherInfo = submitForm.other_info || {}
  const orderOrgInfo = normalizeOrderOrganizationInfo(
    submitForm.order_org_info || submitForm.orderOrgInfo || {
      orgId: submitForm.orgId || submitForm.organizationId,
      orgName: submitForm.orgName || submitForm.organizationName,
      memberRole: submitForm.orgMemberRole || submitForm.memberRole,
      inviteCode: submitForm.inviteCode || submitForm.invitationCode
    }
  )

  return {
    // 新增订单基础信息大类：收口创建人与接单人、创建时间等基础主键信息
    order_base_info: {
      acceptorId: orderBaseInfo.acceptorId || submitForm.acceptorId || '',
      acceptorOpenid: orderBaseInfo.acceptorOpenid || submitForm.acceptorOpenid || '',
      publisher_Id: orderBaseInfo.publisher_Id || submitForm.publisher_Id || '',
      publisher_openid: orderBaseInfo.publisher_openid || submitForm.publisher_openid || '',
      create_time: orderBaseInfo.create_time || submitForm.create_time || ''
    },
    // 新增学员信息大类：孩子信息只保留一份，不再额外铺平到顶层
    child_profile: {
      nickname: childProfile.nickname || submitForm.child_nickname || '',
      age: childProfile.age || submitForm.child_age || '',
      gender: childProfile.gender || submitForm.child_gender || '',
      height: childProfile.height || submitForm.child_height || '',
      weight: childProfile.weight || submitForm.child_weight || ''
    },
    // 新增授课备案大类：课程标题、分类、说明统一归档到 teaching_record
    teaching_record: {
      category: teachingRecord.category || courseTarget.category || submitForm.category || '',
      title: teachingRecord.title || courseTarget.title || submitForm.title || '',
      description: teachingRecord.description || courseTarget.description || submitForm.description || '',
      // 新增课程计划字段：允许前端在默认模板基础上继续手动编辑
      course_plan: teachingRecord.course_plan || courseTarget.course_plan || submitForm.course_plan || ''
    },
    // 新增课程配置大类：课时数量、频率、课程人数统一归档
    course_config: {
      class_count: courseConfig.class_count || submitForm.class_count || 1,
      frequency: courseConfig.frequency || courseBasic.frequency || submitForm.frequency || '',
      course_size_mode: courseConfig.course_size_mode || courseBasic.course_size_mode || submitForm.course_size_mode || '1对1'
    },
    // 新增教练可见信息大类：仅保留价格区间和内部备注
    coach_private: {
      price_interval: coachPrivate.price_interval || submitForm.price_interval || '',
      coach_private_note: coachPrivate.coach_private_note || submitForm.coach_private_note || ''
    },
    // 新增课程基本重要信息大类：安全规则、位置、联系方式、坐标统一归档
    course_basic_info: {
      safety_confirmed: courseBasicInfo.safety_confirmed !== undefined ? !!courseBasicInfo.safety_confirmed : !!courseBasic.safety_confirmed || !!submitForm.safety_confirmed,
      location: courseBasicInfo.location || courseBasic.location || submitForm.location || '',
      contact: normalizePhone(courseBasicInfo.contact || courseBasic.contact || submitForm.contact || ''),
      latitude: courseBasicInfo.latitude !== undefined ? courseBasicInfo.latitude : (submitForm.latitude !== undefined ? submitForm.latitude : null),
      longitude: courseBasicInfo.longitude !== undefined ? courseBasicInfo.longitude : (submitForm.longitude !== undefined ? submitForm.longitude : null)
    },
    // 新增课程流转与协作信息大类：发布状态、执行状态、课表、进度、是否允许流转统一归档
    course_flow_info: {
      allow_transfer_to_other_coach: courseFlowInfo.allow_transfer_to_other_coach !== undefined ? !!courseFlowInfo.allow_transfer_to_other_coach : !!coachPrivate.allow_transfer_to_other_coach || !!submitForm.allow_transfer_to_other_coach,
      publish_type: courseFlowInfo.publish_type || submitForm.publish_type || '',
      publish_state: courseFlowInfo.publish_state || submitForm.publish_state || '',
      fulfill_state: courseFlowInfo.fulfill_state || submitForm.fulfill_state || '',
      progress_total: courseFlowInfo.progress_total || submitForm.progress_total || 0,
      progress_done: courseFlowInfo.progress_done || submitForm.progress_done || 0,
      schedule: Array.isArray(courseFlowInfo.schedule) ? courseFlowInfo.schedule : (Array.isArray(submitForm.schedule) ? submitForm.schedule : []),
      history_sync: courseFlowInfo.history_sync || submitForm.history_sync || null
    },
    // 新增分享与他人可见大类：分享记录统一放在 share_visibility 下
    share_visibility: {
      entry_logs: Array.isArray(shareVisibility.entry_logs) ? shareVisibility.entry_logs : (Array.isArray(submitForm.entry_logs) ? submitForm.entry_logs : [])
    },
    // 新增课程机构归属大类：机构课程只在这里挂机构关联，详情仍然留在 execution_orders 里
    order_org_info: orderOrgInfo,
    // 新增其他信息大类：暂存与业务展示无直接关系的杂项
    other_info: {
      userInfo: otherInfo.userInfo || submitForm.userInfo || {},
      publisherInfo: otherInfo.publisherInfo || submitForm.publisherInfo || {},
      usertoken: otherInfo.usertoken || submitForm.usertoken || '',
      group_rules: otherInfo.group_rules || submitForm.group_rules || '',
      // 新增：协作码导入衍生课的溯源元数据。
      // 当 A 教练通过 publish 页"输入 B 家长 8 位 M 码 → 发布新课程"时，
      // 产品要求明确是"发布课程(而不是去数据库里找已有课程做修改)"，
      // 所以 publishOrder 仍然走 db.collection().add() 新建一条 A 侧课程，
      // 但把当时查到的那条 B 桥订单的关键引用（orderId / 家长M码 / 展示码 / 路径入口）
      // 统一挂在 other_info.linked_collaboration_meta 上，后续任意列表、详情、
      // B 回抄链路都能直接回到这一单是从哪条 B 桥单据衍生出来的。
      imported_target_snapshot: otherInfo.imported_target_snapshot || submitForm.imported_target_snapshot || null,
      linked_collaboration_meta: otherInfo.linked_collaboration_meta || submitForm.linked_collaboration_meta || null,
      // 兼容：同时保留 B 约课同步函数里写入的 imported_* 字段，
      // 即使是走协作码导入的衍生课，在家长端展示侧（linkToC / login_index / parent_classshow）
      // 也可通过 imported_parent_name / imported_phone 一致性展示。
      imported_parent_name: otherInfo.imported_parent_name || submitForm.imported_parent_name || '',
      imported_phone: otherInfo.imported_phone || submitForm.imported_phone || ''
    }
  }
}

function getOrderBaseInfo(order = {}) {
  return order.order_base_info || {}
}

function getChildProfile(order = {}) {
  return order.child_profile || {}
}

function getTeachingRecord(order = {}) {
  return order.teaching_record || order.course_target || {}
}

function getCourseConfig(order = {}) {
  return order.course_config || {}
}

function getCourseBasicInfo(order = {}) {
  return order.course_basic_info || order.course_basic || {}
}

function getCoachPrivate(order = {}) {
  return order.coach_private || {}
}

function getOrderOrganizationInfo(order = {}) {
  return normalizeOrderOrganizationInfo(
    order.order_org_info || {
      orgId: order.orgId || order.organizationId,
      orgName: order.orgName || order.organizationName,
      memberRole: order.orgMemberRole || order.memberRole,
      inviteCode: order.inviteCode || order.invitationCode
    }
  )
}

function getCourseFlowInfo(order = {}) {
  return order.course_flow_info || {}
}

// 新增课节完成判断：发布页只把“总结内容 + 上课日期”同时存在的课节视为已记录完成
function isLessonRecorded(lesson = {}) {
  const hasSummary = !!String(lesson.summary || '').trim()
  const hasSummaryDate = !!(lesson.summaryDate || lesson.startedAt || lesson.completedAt)
  return hasSummary && hasSummaryDate
}

// 新增课表锁定判断：允许修改到接入后累计记录满 3 节课为止；历史汇总课次不计入
function hasLessonPlanConfigured(order = {}) {
  const courseFlowInfo = getCourseFlowInfo(order)
  const schedule = Array.isArray(courseFlowInfo.schedule)
    ? courseFlowInfo.schedule
    : (Array.isArray(order.schedule) ? order.schedule : [])

  const recordedLessonCount = schedule.filter(item => isLessonRecorded(item)).length
  return recordedLessonCount >= 3
}

function getShareVisibility(order = {}) {
  return order.share_visibility || {}
}

function getOtherInfo(order = {}) {
  return order.other_info || {}
}

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

// 新增邀请码命中：B 侧转单过来时，优先按 inviteCode 绑定到机构 owner，保证后续能进入 A 的现有操作链。
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

function getPublisherOpenid(order = {}) {
  return getOrderBaseInfo(order).publisher_openid || order.publisher_openid || ''
}

function getPublisherId(order = {}) {
  return getOrderBaseInfo(order).publisher_Id || order.publisher_Id || ''
}

function getAcceptorOpenid(order = {}) {
  return getOrderBaseInfo(order).acceptorOpenid || order.acceptorOpenid || ''
}

function getAcceptorId(order = {}) {
  return getOrderBaseInfo(order).acceptorId || order.acceptorId || ''
}

function normalizeImportedChildProfiles(childProfiles = []) {
  const safeList = Array.isArray(childProfiles) ? childProfiles : []

  return safeList.map(item => ({
    nickname: String((item || {}).nickname || '').trim(),
    age: String((item || {}).age || '').trim(),
    gender: String((item || {}).gender || '').trim(),
    height: String((item || {}).height || '').trim(),
    weight: String((item || {}).weight || '').trim()
  })).filter(item => item.nickname || item.age || item.gender || item.height || item.weight)
}

function buildImportedSubmitForm(event = {}, organizationDoc = null) {
  const importedChildProfiles = normalizeImportedChildProfiles(parseJsonLike(event.childProfiles, []))
  const firstChild = importedChildProfiles[0] || {
    nickname: String(event.childName || '').trim(),
    age: String(event.childAge || '').trim(),
    gender: '',
    height: '',
    weight: ''
  }
  const organizationBasic = (organizationDoc && organizationDoc.organization_basic) || {}
  const orgId = String(organizationBasic.organization_id || '').trim()
  const orgName = String(organizationBasic.organization_name || '').trim()
  const inviteCode = normalizeInviteCode(event.inviteCode)
  const importedTargetSnapshot = parseJsonLike(event.targetSnapshot, {})
  const location = String(event.location || '').trim()
  const contact = normalizePhone(event.contact || event.phone || '')
  const frequency = String(event.frequency || '').trim()
  // 新增：B 约课导入时，title 按用户要求保持「原来路线」——直接复用 B 端带过来的 pageTitle/displayName，不做重写。
  // 课程备注（description）统一前置追加「悦动邻 - 家长约课登记导入」一行，与前端协作回填的规则保持一致。
  const IMPORT_TAG_LINE = '悦动邻 - 家长约课登记导入'
  const rawDescription = String(event.note || '').trim()
  const descriptionNeedsTag = rawDescription && !rawDescription.startsWith(IMPORT_TAG_LINE)
  const importedDescription = descriptionNeedsTag
    ? `${IMPORT_TAG_LINE}\n${rawDescription}`
    : (rawDescription || IMPORT_TAG_LINE)

  return {
    title: String(
      (((importedTargetSnapshot || {}).pageTitle) || ((importedTargetSnapshot || {}).displayName) || '家长转交课程')
    ).trim(),
    category: '家长转交',
    description: importedDescription,
    course_plan: '本单由小程序B家长端提交后中转到小程序A，后续由教练继续跟进。',
    frequency,
    location,
    contact,
    latitude: event.latitude !== undefined ? event.latitude : null,
    longitude: event.longitude !== undefined ? event.longitude : null,
    course_size_mode: '1对1',
    child_profiles: importedChildProfiles,
    child_nickname: firstChild.nickname || '',
    child_age: firstChild.age || '',
    child_gender: firstChild.gender || '',
    child_height: firstChild.height || '',
    child_weight: firstChild.weight || '',
    child_profile: firstChild,
    publish_type: '发布看看',
    class_count: 10,
    order_org_info: orgId ? {
      orgId,
      orgName,
      memberRole: 'admin',
      inviteCode
    } : {},
    source: SOURCE_FROM_B_PARENT,
    from_b_form_id: String(event.from_b_form_id || '').trim(),
    from_b_course_id: String(event.from_b_course_id || '').trim(),
    from_b_openid: String(event.from_b_openid || '').trim(),
    imported_target_snapshot: importedTargetSnapshot,
    create_time: new Date().toISOString()
  }
}

function currentSafeNumber(value) {
  const num = Number(value)
  return Number.isNaN(num) ? 0 : num
}

// 新增课节评分收口：统一限制在 0-5 分之间，支持 1 位小数
function normalizeLessonRating(value) {
  if (value === '' || value === null || value === undefined) {
    return ''
  }

  const rating = Number(value)
  if (Number.isNaN(rating)) {
    return ''
  }

  const safeRating = Math.max(0, Math.min(5, rating))
  return Number(safeRating.toFixed(1))
}

// 新增课节标签收口：只保留非空文本，避免脏数据直接进库
function normalizeLessonRatingTags(tags) {
  if (!Array.isArray(tags)) {
    return []
  }

  return Array.from(new Set(tags
    .map(item => String(item || '').trim())
    .filter(Boolean)))
}

// 新增多维评分收口：只保留 1-5 的整数分，避免前端乱值直接入库
function normalizeLessonDimensionRatings(rawRatings = {}) {
  if (!rawRatings || typeof rawRatings !== 'object') {
    return {}
  }

  return Object.keys(rawRatings).reduce((result, key) => {
    const safeKey = String(key || '').trim()
    const safeValue = Math.max(0, Math.min(5, Math.round(Number(rawRatings[key] || 0))))
    if (safeKey && safeValue > 0) {
      result[safeKey] = safeValue
    }
    return result
  }, {})
}

function normalizeOrderForClient(order = {}) {
  const orderBaseInfo = getOrderBaseInfo(order)
  const childProfile = getChildProfile(order)
  const teachingRecord = getTeachingRecord(order)
  const courseConfig = getCourseConfig(order)
  const courseBasicInfo = getCourseBasicInfo(order)
  const coachPrivate = getCoachPrivate(order)
  const courseFlowInfo = getCourseFlowInfo(order)
  const shareVisibility = getShareVisibility(order)
  const otherInfo = getOtherInfo(order)

  return {
    ...order,
    order_base_info: orderBaseInfo,
    child_profile: childProfile,
    teaching_record: teachingRecord,
    course_config: courseConfig,
    coach_private: coachPrivate,
    course_basic_info: courseBasicInfo,
    course_flow_info: courseFlowInfo,
    share_visibility: shareVisibility,
    other_info: otherInfo,
    // 兼容旧页面读取：前端仍然可以继续按旧字段回显，但数据库不再重复存储
    course_target: teachingRecord,
    course_basic: {
      frequency: courseConfig.frequency || order.frequency || '',
      course_size_mode: courseConfig.course_size_mode || order.course_size_mode || '',
      location: courseBasicInfo.location || order.location || '',
      contact: courseBasicInfo.contact || order.contact || '',
      safety_confirmed: courseBasicInfo.safety_confirmed !== undefined ? !!courseBasicInfo.safety_confirmed : !!order.safety_confirmed
    },
    title: teachingRecord.title || order.title || '',
    category: teachingRecord.category || order.category || '',
    description: teachingRecord.description || order.description || '',
    frequency: courseConfig.frequency || order.frequency || '',
    class_count: courseConfig.class_count || order.class_count || 0,
    course_size_mode: courseConfig.course_size_mode || order.course_size_mode || '',
    location: courseBasicInfo.location || order.location || '',
    contact: courseBasicInfo.contact || order.contact || '',
    safety_confirmed: courseBasicInfo.safety_confirmed !== undefined ? !!courseBasicInfo.safety_confirmed : !!order.safety_confirmed,
    latitude: courseBasicInfo.latitude !== undefined ? courseBasicInfo.latitude : (order.latitude !== undefined ? order.latitude : null),
    longitude: courseBasicInfo.longitude !== undefined ? courseBasicInfo.longitude : (order.longitude !== undefined ? order.longitude : null),
    child_age: childProfile.age || order.child_age || '',
    child_nickname: childProfile.nickname || order.child_nickname || '',
    child_gender: childProfile.gender || order.child_gender || '',
    child_height: childProfile.height || order.child_height || '',
    child_weight: childProfile.weight || order.child_weight || '',
    course_plan: teachingRecord.course_plan || order.course_plan || '',
    price_interval: coachPrivate.price_interval || order.price_interval || '',
    coach_private_note: coachPrivate.coach_private_note || order.coach_private_note || '',
    allow_transfer_to_other_coach: courseFlowInfo.allow_transfer_to_other_coach !== undefined ? !!courseFlowInfo.allow_transfer_to_other_coach : !!order.allow_transfer_to_other_coach,
    publish_type: courseFlowInfo.publish_type || order.publish_type || '',
    publish_state: courseFlowInfo.publish_state || order.publish_state || '',
    fulfill_state: courseFlowInfo.fulfill_state || order.fulfill_state || '',
    progress_total: courseFlowInfo.progress_total || order.progress_total || 0,
    progress_done: courseFlowInfo.progress_done || order.progress_done || 0,
    schedule: Array.isArray(courseFlowInfo.schedule) ? courseFlowInfo.schedule : (Array.isArray(order.schedule) ? order.schedule : []),
    history_sync: courseFlowInfo.history_sync || order.history_sync || null,
    source: getOrderSource(order),
    bridge_status: order.bridge_status || '',
    from_b_form_id: order.from_b_form_id || '',
    from_b_course_id: order.from_b_course_id || '',
    from_b_openid: order.from_b_openid || '',
    // 新增：M 码三字段统一透出给前端展示 / 查询；三字段相同值但兼容不同历史读取路径
    joinCode: order.joinCode || '',
    courseCode: order.courseCode || '',
    parent_course_code: order.parent_course_code || order.joinCode || order.courseCode || '',
    // 新增：教练接取码字段与执行教练信息透出。
    // 管理端用 pickupConfirmCode / pickupFullCode 生成展示卡片给执行教练；
    // 教练端列表用 assignedCoach* 判断归属与显示「待指派 / 已被 XX 接取」。
    pickupConfirmCode: order.pickup_confirm_code || order.pickupConfirmCode || '',
    pickupFullCode: order.pickup_full_code || order.pickupFullCode || '',
    // 新增：执行教练确认接取后的最终确认码；优先读库里已写值，没有时按“12 位接取码 + DL”兜底拼接。
    pickupFinalCode:
      order.pickup_final_code
      || order.pickupFinalCode
      || (
        ((order.assignedCoachToken || order.assigned_coach_token || order.coach_token || '')
        || (order.assignedCoachOpenid || order.assigned_coach_openid || order.coach_openid || ''))
          ? buildPickupFinalCode(order.pickup_full_code || order.pickupFullCode || '')
          : ''
      ),
    assignedCoachToken: order.assignedCoachToken || order.assigned_coach_token || order.coach_token || '',
    assignedCoachOpenid: order.assignedCoachOpenid || order.assigned_coach_openid || order.coach_openid || '',
    assignedCoachName: order.assignedCoachName || order.assigned_coach_name || '',
    assignedCoachAt: order.assignedCoachAt || null,
    entry_logs: Array.isArray(shareVisibility.entry_logs) ? shareVisibility.entry_logs : (Array.isArray(order.entry_logs) ? order.entry_logs : []),
    userInfo: otherInfo.userInfo || order.userInfo || {},
    publisherInfo: otherInfo.publisherInfo || order.publisherInfo || {},
    usertoken: otherInfo.usertoken || order.usertoken || '',
    group_rules: otherInfo.group_rules || order.group_rules || '',
    create_time: orderBaseInfo.create_time || order.create_time || '',
    createdAt: orderBaseInfo.createdAt || order.createdAt || '',
    updatedAt: orderBaseInfo.updatedAt || order.updatedAt || '',
    publisher_openid: getPublisherOpenid(order),
    publisher_Id: getPublisherId(order),
    acceptorOpenid: getAcceptorOpenid(order),
    acceptorId: getAcceptorId(order)
  }
}

/**
 * execution_order: 课程执行核心入口
 * 负责：发布、课表初始化、课节记录、结课、取消
 */
// 新增：健壮的 action/入参解析器。
// NEWDL_execution_order 既会被「wx.cloud.callFunction 直调」（action 挂 event 顶层），
// 也可能走 HTTP 云函数 / SCF 网关 / HTTP 访问服务（action 在 event.queryStringParameters 或 event.body 字符串 / event.body JSON 里）。
// 经验 ID 1883158 已踩过坑：只读取 event.action，会让 HTTP 路径全部落进 default 「未知操作」。
// 这里按优先级从 5 种常见结构取值，同时记录来源，便于排错。
function normalizeRequestEvent(rawEvent) {
  const event = rawEvent && typeof rawEvent === 'object' ? rawEvent : {};

  // 尝试兼容 HTTP body：body 可能是 JSON 字符串，也可能是 Buffer/base64
  let bodyObj = null;
  if (typeof event.body === 'string' && event.body.length > 0) {
    try {
      const firstChar = event.body.trim().charAt(0);
      if (firstChar === '{' || firstChar === '[') {
        bodyObj = JSON.parse(event.body);
      }
    } catch (err) {
      bodyObj = null;
    }
  } else if (event.body && typeof event.body === 'object' && !Array.isArray(event.body)) {
    bodyObj = event.body;
  }

  const query = (event.queryStringParameters && typeof event.queryStringParameters === 'object')
    ? event.queryStringParameters
    : {};

  const candidates = [
    { name: 'event', payload: event },
    { name: 'event.data', payload: event && event.data },
    { name: 'event.queryStringParameters', payload: query },
    { name: 'event.body', payload: bodyObj },
    { name: 'event.body.data', payload: bodyObj && bodyObj.data }
  ];

  function pickFirstString(...keys) {
    for (let i = 0; i < candidates.length; i += 1) {
      const item = candidates[i];
      if (!item.payload || typeof item.payload !== 'object') continue;
      for (let j = 0; j < keys.length; j += 1) {
        const key = keys[j];
        const value = item.payload[key];
        if (typeof value === 'string') {
          return { value: value.trim(), source: `${item.name}.${key}` };
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
          return { value: String(value).trim(), source: `${item.name}.${key}` };
        }
      }
    }
    return { value: '', source: '' };
  }

  function pickPayload(sourceName) {
    for (let i = 0; i < candidates.length; i += 1) {
      const item = candidates[i];
      if (item.name === sourceName && item.payload && typeof item.payload === 'object') {
        return item.payload;
      }
    }
    return null;
  }

  const actionPick = pickFirstString('action', 'ACTION', 'op', 'operation');
  const orderIdPick = pickFirstString('orderId', 'order_id', 'id');

  // 入参对象的合并优先级：找到 action 的那一层作为主 payload，再叠加 event 顶层字段；
  // 这样 HTTP/SCF 调过来时，业务函数里取 courseCode / inviteCode 都能取到。
  const sourcePayload = actionPick.source ? pickPayload(actionPick.source.split('.').slice(0, -1).join('.')) : null;
  const normalizedEvent = {
    ...event,
    ...(sourcePayload && typeof sourcePayload === 'object' ? sourcePayload : {}),
    action: actionPick.value,
    orderId: orderIdPick.value
  };

  return {
    event: normalizedEvent,
    debug: {
      topLevelKeys: Object.keys(event || {}),
      actionSource: actionPick.source,
      actionValue: actionPick.value,
      orderIdSource: orderIdPick.source,
      orderIdValue: orderIdPick.value,
      hasEventBody: Boolean(event.body),
      hasQueryStringParameters: Boolean(event.queryStringParameters),
      httpMethod: typeof event.httpMethod === 'string' ? event.httpMethod : '',
      path: typeof event.path === 'string' ? event.path : ''
    }
  };
}

exports.main = async (event, context) => {
  // 新增：兼容 callFunction / SCF HTTP / 微信 HTTP 访问服务三种入参封装
  const parsed = normalizeRequestEvent(event);
  const action = parsed.event.action;
  const orderId = parsed.event.orderId;
  const parsedDebug = parsed.debug;

  if (!action) {
    return {
      code: 400,
      msg: "缺少动作参数 action",
      debug: { ...parsedDebug }
    }
  }

  // 把 normalize 后的 event 透传给后续 switch：业务里取 courseCode、inviteCode 等不会再在 HTTP 路径落空。
  const $event = parsed.event;
  // 新增环境版本识别：由前端透传 develop/trial/release
  CURRENT_ENV_VERSION = $event.envVersion || 'develop'
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  // userId 应该由前端传递，或者通过 openid 查找用户表获取 (这里沿用前端传 userId 的模式，或者自查)
  const userId = $event.userId

  // 新增错误链路封口：A/B 关联当前明确要求走云端 twowaybinding_1_DLforC，
  // 这里不允许再通过 NEWDL_execution_order 直接承接 B 的中转入库。
  // 注意：此处不拦截 ACTION_SYNC_PARENT_BOOKING_TO_A。该动作表示“B 约课导入 A 的大云函数链路（新流程）”，
  // 也就是当前 NEWDL_execution_order 的合法入口之一；旧的 HTTP 桥 twowaybinding_1_DLforC 仍然存在但走另一套部署。
  if (!openid) {
    return { code: 401, msg: '未登录' }
  }

  logRuntimeEnvInfo({
    action: action || '',
    orderId: orderId || '',
    hasOpenid: !!openid
  })

  // 新增：路由排错信息。生产环境偶发“首进报未知操作，次进正常”，是云包实例版本不一致 / 动作带隐藏字符的典型表现。
  // 这里打一份精确到字符级的 action 诊断日志，后续 SCF 日志里可以直接判断是代码真的没分支，还是 action 被悄悄塞进了 \u200b 之类。
  const ROUTER_BUILD_ID = 'DEV_NDL_20260902_2';
  const actionDiagnostic = {
    raw: action,
    type: typeof action,
    length: typeof action === 'string' ? action.length : null,
    hex: typeof action === 'string'
      ? Array.from(action).map(ch => ch.charCodeAt(0).toString(16).padStart(4, '0')).join(' ')
      : null,
    source: parsedDebug.actionSource || ''
  };
  console.log(`[router] build=${ROUTER_BUILD_ID} actionDiagnostic=`, actionDiagnostic);

  // 新增：显式路由映射表，替代 switch/case。
  // 之前日志里多次出现「action 明明等于 get_order_by_course_code 却走到 default 返回 404 且无 debug」，
  // 极有可能是缩进或早期编辑产生的隐藏字符/语法分支问题导致的异常命中。显式 handler 表 + try/catch 每层都打日志，可以消除这种“看似 switch 没进”的玄学。
  const supportedActionList = [
    'get_oneorder',
    'get_order_by_course_code',
    'start',
    'lesson_handshake',
    'complete',
    'cancel',
    'close',
    'list_myself',
    'publish',
    ACTION_SYNC_PARENT_BOOKING_TO_A,
    'update_order',
    'admin_list_all',
    'admin_logs',
    'admin_get_detail',
    'admin_add_log',
    'update_lesson_content',
    'add_lesson',
    'sync_lesson_progress',
    'add_entry_log',
    // 新增：教练接取码流程相关操作。
    // assign_coach_by_pickup_code：教练输入 12 位完整接取码认领课程；
    // confirm_generate_pickup_code：管理层在 A 端 publish 页手动确认后，才生成 12 位完整接取码；
    // reset_pickup_confirm_code：发布者重置 4 位确认码，旧完整接取码失效。
    // mark_course_info_ready：管理层在 publish 页点「完成课程信息编辑，允许教练接单」，
    //     写 course_info_ready_at，作为 confirm_generate_pickup_code 的前置强校验门槛。
    'assign_coach_by_pickup_code',
    'confirm_generate_pickup_code',
    'reset_pickup_confirm_code',
    'mark_course_info_ready'
  ];

  try {
    let matchedResult = null;
    const handler = routeTable[action];
    if (typeof handler === 'function') {
      console.log(`[router] matched action: ${action}`);
      matchedResult = await handler({ action, orderId, openid, userId, event: $event });
    } else {
      // 新增：兜底——如果路由表里没有命中，仍然走 default 的 404 未知操作结构，
      // 但返回里同时带上 buildId / actionDiagnostic / supportedList，前端就能直接区分「版本不同步」和「码不对」。
      console.warn(`[router] action not in routeTable: ${JSON.stringify(actionDiagnostic)}`);
      matchedResult = {
        code: 404,
        msg: '未知操作',
        debug: {
          buildId: ROUTER_BUILD_ID,
          receivedAction: action,
          actionDiagnostic,
          parsed: parsedDebug,
          supportedActions: supportedActionList
        }
      };
    }

    // 路由里的 handler 允许返回任一结构，但为了与前端保持一致，这里保证 404/400 都附带 buildId + supportedActions
    if (matchedResult && typeof matchedResult === 'object' && matchedResult.code !== 0) {
      if (!matchedResult.debug || typeof matchedResult.debug !== 'object') {
        matchedResult.debug = {};
      }
      if (!matchedResult.debug.buildId) {
        matchedResult.debug.buildId = ROUTER_BUILD_ID;
      }
      if (!matchedResult.debug.actionDiagnostic) {
        matchedResult.debug.actionDiagnostic = actionDiagnostic;
      }
      if (!matchedResult.debug.parsed) {
        matchedResult.debug.parsed = parsedDebug;
      }
      if (!Array.isArray(matchedResult.debug.supportedActions)) {
        matchedResult.debug.supportedActions = supportedActionList;
      }
    }
    return matchedResult;
  } catch (error) {
    return {
      code: 500,
      msg: error.message || '服务异常',
      debug: {
        buildId: ROUTER_BUILD_ID,
        actionDiagnostic,
        parsed: parsedDebug,
        supportedActions: supportedActionList,
        errorName: error.name,
        errorStack: error.stack
      }
    }
  }
};

// 新增：NEWDL_execution_order 的业务动作映射表。每个 handler 的返回结构 { code, msg, data, debug? }
// 与原 switch 完全等价，只是显式挂在对象上，避免 switch/case 的隐藏字符/作用域坑。
// 这个位置放在 exports.main 后而不是之前，是为了在阅读入口时按「parser → dispatch → handler」顺序走，不删除任何原注释。
const routeTable = {
  get_oneorder: async ({ orderId, openid }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await getOneOrder(orderId, openid);
  },
  get_order_by_course_code: async ({ event }) => {
    return await getOrderByCourseCode(event.courseCode);
  },
  start: async ({ orderId }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    // 旧课程开始状态链路保留注释，不删除；当前已不再开放 start 入口
    // return await startOrder(orderId, openid, userId)
    return { code: 403, msg: '旧课程状态链路已下线' };
  },
  lesson_handshake: async ({ orderId }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    // 旧课节握手状态链路保留注释，不删除；当前已不再开放 lesson_handshake 入口
    // return await lessonHandshake(orderId, openid, userId, event.lessonIndex, event.subAction)
    return { code: 403, msg: '旧课节状态链路已下线' };
  },
  complete: async ({ orderId }) => {
    // 手动完成整个订单 (通常由握手自动触发，但也提供手动接口)
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    // 旧整单完成状态链路保留注释，不删除；当前关闭课程请使用 close
    // return await completeOrder(orderId, openid, userId)
    return { code: 403, msg: '旧完成状态链路已下线，请使用结课入口' };
  },
  cancel: async ({ orderId, openid, userId, event }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await cancelOrder(orderId, openid, userId, event.reason);
  },
  close: async ({ orderId, openid, userId, event }) => {
    // 新增结课入口：将课程状态直接切到 closed，并保存结语与教练备注
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await closeOrder(orderId, openid, userId, event.closeSummary, event.closeCoachNote);
  },
  list_myself: async ({ openid, userId, event }) => {
    return await listMyself(openid, userId, event.page || 1, event.limit || 20);
  },
  publish: async ({ openid, userId, event }) => {
    return await publishOrder(event.submitForm, openid, userId);
  },
  [ACTION_SYNC_PARENT_BOOKING_TO_A]: async ({ openid, userId, event }) => {
    // 情况2：B 家长在 B 小程序约课后，桥接入 A 使用 NEWDL_execution_order 直接建 A 订单。
    // 与旧 twowaybinding_1_DLforC 并行存在，码统一用 B 前缀的 8 位 M 码。
    return await syncParentBookingToA(event, openid, userId);
  },
  update_order: async ({ orderId, openid, userId, event }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await updateOrder(orderId, event.submitForm, openid, userId);
  },
  admin_list_all: async ({ event }) => {
    return await listAllAdmin(event.page || 1, event.limit || 20);
  },
  admin_logs: async ({ event }) => {
    return await listLogs(event.page || 1, event.limit || 20);
  },
  admin_get_detail: async ({ event }) => {
    if (!event.id || !event.collection) return { code: 1, msg: '缺少参数' };
    return await adminGetDetail(event.id, event.collection);
  },
  admin_add_log: async ({ event }) => {
    return await addLog(event.level, event.message, event.details);
  },
  update_lesson_content: async ({ orderId, openid, userId, event }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await updateLessonContent(orderId, openid, userId, event.lessonIndex, event.content);
  },
  add_lesson: async ({ orderId }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    // 旧手动补加课节入口保留注释，不删除；当前改为通过“总课时 / 半途接入”统一维护，记录满 3 节后锁定，不再支持这里单独追加
    // return await addLesson(orderId, openid)
    return { code: 403, msg: '旧课节追加入口已下线' };
  },
  sync_lesson_progress: async ({ orderId, openid, userId, event }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await syncLessonProgress(orderId, openid, userId, event.totalLessons, event.startLesson, event.historyCount);
  },
  add_entry_log: async ({ orderId, openid, userId, event }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await addEntryLog(orderId, openid, userId, event);
  },
  // 新增：教练通过「12 位完整接取码」认领课程。不限制是否机构内教练，任何已登录教练都可以输入码接取。
  assign_coach_by_pickup_code: async ({ openid, userId, event }) => {
    return await assignCoachByPickupCode(event.pickupFullCode, openid, userId, event.coachName || '');
  },
  // 新增：12 位完整接取码改为“管理层在 publish 页面手动确认后才生成”。
  // 建课时只先保留 8 位课程码；这里负责补出 4 位确认码和 12 位完整接取码。
  confirm_generate_pickup_code: async ({ orderId, openid, userId }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await confirmGeneratePickupCode(orderId, openid, userId);
  },
  // 新增：发布者 / 机构管理员重置课程的 4 位确认码。
  // 典型场景：之前的接取码泄漏了，想换一组新码；或者想让之前拿到旧码的教练无法再接取。
  reset_pickup_confirm_code: async ({ orderId, openid, userId, event }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await resetPickupConfirmCode(orderId, openid, userId, !!(event && event.keepCoach));
  },
  // 新增：管理层在 publish 页手动点「完成课程信息编辑，允许教练接单」时调用。
  // 写入 course_info_ready_at 时间戳；后续 confirm_generate_pickup_code 会强校验这个字段存在，
  // 从而形成「B端家长提交 → 管理层补资料 → 手动mark_ready → 生成12位接取码 → 待接取」的严格顺序。
  mark_course_info_ready: async ({ orderId, openid, userId }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await markCourseInfoReady(orderId, openid, userId);
  }
};

// ================= 业务逻辑函数 =================

// 新增：教练通过 12 位完整接取码认领课程。
// 流程：
// 1) 标准化输入、拆出 8 位 M 码 + 4 位确认码；
// 2) 用 courseCode/joinCode/parent_course_code 任一字段匹配查到课程；
// 3) 校验确认码完全一致；
// 4) 若已被其他教练接取，返回明确错误；若是当前教练自己，视为幂等成功；
// 5) 写入 assignedCoach* 四个字段；
// 6) 返回成功，附带订单 ID、课程基础信息，前端可直接跳到课程管理详情。
async function assignCoachByPickupCode(rawPickupFullCode, coachOpenid, coachUserId, coachNickname = '') {
  if (!coachOpenid) {
    return { code: 401, msg: '未获取到教练身份，请重新登录后再试' }
  }
  const fullCode = normalizePickupFullCode(rawPickupFullCode)
  if (!fullCode) {
    return {
      code: 1,
      msg: `接取码格式不对，必须是 ${PICKUP_FULL_CODE_LENGTH} 位英数字（8 位班级码 + 4 位确认码），无需带空格或横杠`
    }
  }
  const { courseCode, confirmCode } = splitPickupFullCode(fullCode)
  if (!courseCode || !confirmCode) {
    return { code: 1, msg: '接取码拆分失败，请检查输入' }
  }

  const targetCollection = getCollectionName(ORDER_COLLECTION_BASE)
  let matchedOrder = null
  try {
    const queryRes = await db.collection(targetCollection)
      .where(_.or([
        { courseCode },
        { joinCode: courseCode },
        { parent_course_code: courseCode }
      ]))
      .limit(1)
      .get()
    matchedOrder = Array.isArray(queryRes.data) && queryRes.data.length ? queryRes.data[0] : null
  } catch (err) {
    console.error('[pickup] query order by courseCode failed:', err && err.message)
    return { code: 500, msg: '查询课程失败，请稍后重试' }
  }

  if (!matchedOrder) {
    return { code: 404, msg: '没有找到对应课程，请检查班级码前 8 位是否正确' }
  }

  // 已结课 / 已关闭的课程不允许再接取，避免教练接到无效课
  const fulfillState = String((matchedOrder.course_flow_info || {}).fulfill_state || matchedOrder.fulfill_state || '').trim()
  if (fulfillState === 'closed' || fulfillState === 'cancelled') {
    return { code: 403, msg: '该课程已关闭，无法再接取' }
  }

  const savedConfirmCode = String(matchedOrder.pickup_confirm_code || matchedOrder.pickupConfirmCode || '').trim()
  if (!savedConfirmCode || savedConfirmCode.toUpperCase() !== confirmCode) {
    return {
      code: 1,
      msg: '确认码不匹配，课程可能已经被发布者更换了新确认码，请向管理员索要最新的完整接取码'
    }
  }

  const savedCoachToken = String(matchedOrder.assignedCoachToken || matchedOrder.assigned_coach_token || '').trim()
  const savedCoachOpenid = String(matchedOrder.assignedCoachOpenid || matchedOrder.assigned_coach_openid || '').trim()
  const safeCoachUserId = String(coachUserId || '').trim()
  const safeCoachOpenid = String(coachOpenid || '').trim()
  const alreadyAssigned = !!savedCoachToken || !!savedCoachOpenid
  const assignedToMe =
    (savedCoachToken && safeCoachUserId && savedCoachToken === safeCoachUserId) ||
    (savedCoachOpenid && safeCoachOpenid && savedCoachOpenid === safeCoachOpenid)

  if (alreadyAssigned && assignedToMe) {
    // 幂等：本来就是当前教练，直接返回成功，避免重复 setData 引发时间戳和日志噪音
    return {
      code: 0,
      msg: '该课程已由你接取，无需重复操作',
      alreadyAssigned: true,
      orderId: matchedOrder._id,
      joinCode: matchedOrder.joinCode || courseCode,
      courseCode: matchedOrder.courseCode || courseCode
    }
  }

  if (alreadyAssigned) {
    const takenName = String(matchedOrder.assignedCoachName || matchedOrder.assigned_coach_name || '其他教练').trim() || '其他教练'
    return {
      code: 409,
      msg: `该课程已被「${takenName}」接取，如需更换请联系发布者重置接取码`
    }
  }

  // 补充教练昵称，用于后续列表展示
  let finalCoachName = String(coachNickname || '').trim()
  if (!finalCoachName) {
    try {
      const usersCollectionName = getCollectionName(USER_COLLECTION_BASE)
      const userQuery = await db.collection(usersCollectionName).where({ openid: safeCoachOpenid }).limit(1).get()
      const userDoc = Array.isArray(userQuery.data) && userQuery.data.length ? userQuery.data[0] : null
      if (userDoc) {
        finalCoachName = String(userDoc.nickname || userDoc.name || '执行教练').trim() || '执行教练'
      } else {
        finalCoachName = '执行教练'
      }
    } catch (err) {
      console.warn('[pickup] fallback read coach name failed:', err && err.message)
      finalCoachName = '执行教练'
    }
  }

  const now = new Date()
  const pickupFinalCode = buildPickupFinalCode(fullCode)
  // 新增：教练成功接取后，课程生命周期状态推进到「进行中（in_progress）」。
  // 保证 progress 页面立刻把它从「待接取」挪到「进行中」Tab，和管理层生成接取码 → 教练接取 → 开始带课的业务顺序对齐。
  // 同时写顶层 fulfill_state 和 course_flow_info.fulfill_state，兼容两种读取位置。
  const currentCourseFlow = getCourseFlowInfo(matchedOrder)
  const nextCourseFlow = {
    ...currentCourseFlow,
    fulfill_state: 'in_progress'
  }
  try {
    await db.collection(targetCollection).doc(matchedOrder._id).update({
      data: {
        assignedCoachToken: safeCoachUserId,
        assignedCoachOpenid: safeCoachOpenid,
        assignedCoachName: finalCoachName,
        assignedCoachAt: now,
        // 新增：执行教练接取成功后，把“12 位接取码 + 固定 DL 尾码”一起写回订单。
        pickup_final_code: pickupFinalCode,
        fulfill_state: 'in_progress',
        course_flow_info: _.set(nextCourseFlow),
        updatedAt: now
      }
    })
  } catch (err) {
    console.error('[pickup] write assignedCoach failed:', err && err.message)
    return { code: 500, msg: '接取失败，写入课程信息时出错，请稍后重试' }
  }

  const normalizedTitle =
    (((matchedOrder.course_target || {}).title) || matchedOrder.title || '未命名课程')
  const normalizedLocation =
    (((matchedOrder.course_basic || {}).location) || matchedOrder.location || '')

  console.log('[pickup] coach assigned success:', {
    orderId: matchedOrder._id,
    courseCode,
    confirmCode,
    coachOpenid: safeCoachOpenid,
    coachUserId: safeCoachUserId,
    coachName: finalCoachName
  })

  return {
    code: 0,
    msg: '接取成功',
    orderId: matchedOrder._id,
    joinCode: matchedOrder.joinCode || courseCode,
    courseCode: matchedOrder.courseCode || courseCode,
    pickupFullCode: fullCode,
    pickupFinalCode,
    coachName: finalCoachName,
    assignedAt: now,
    title: normalizedTitle,
    location: normalizedLocation
  }
}

// 新增：管理层在 publish 页面手动确认后，才正式生成 12 位完整接取码。
// 规则：
// 1) 课程创建时只保留 8 位课程码，不自动发给执行教练；
// 2) 管理层在 A 端页面确认后，再生成 4 位确认码 + 12 位完整接取码；
// 3) 如果已经生成过，就直接返回当前这组码，避免重复点击生成出不同结果。
async function confirmGeneratePickupCode(orderId, operatorOpenid, operatorUserId) {
  if (!operatorOpenid) {
    return { code: 401, msg: '未获取到身份，请重新登录后再试' }
  }
  const targetCollection = getCollectionName(ORDER_COLLECTION_BASE)
  let matchedOrder = null
  try {
    const orderRes = await db.collection(targetCollection).doc(orderId).get()
    matchedOrder = orderRes && orderRes.data ? orderRes.data : null
  } catch (err) {
    console.error('[pickup_generate] query order failed:', err && err.message)
    return { code: 500, msg: '查询课程失败，请稍后重试' }
  }
  if (!matchedOrder) {
    return { code: 404, msg: '课程不存在' }
  }

  const publisherOpenid = String(getPublisherOpenid(matchedOrder) || '').trim()
  const publisherUserId = String(getPublisherId(matchedOrder) || '').trim()
  const safeOpenid = String(operatorOpenid || '').trim()
  const safeUserId = String(operatorUserId || '').trim()
  const isPublisher =
    (publisherOpenid && safeOpenid && publisherOpenid === safeOpenid) ||
    (publisherUserId && safeUserId && publisherUserId === safeUserId)

  if (!isPublisher) {
    return { code: 403, msg: '只有课程的创建者可以确认生成接取码' }
  }

  const currentFullCode = String(matchedOrder.pickup_full_code || matchedOrder.pickupFullCode || '').trim()
  const currentConfirmCode = String(matchedOrder.pickup_confirm_code || matchedOrder.pickupConfirmCode || '').trim()
  const baseCourseCode = String(matchedOrder.joinCode || matchedOrder.courseCode || '').trim()

  if (!baseCourseCode) {
    return { code: 500, msg: '课程缺少 8 位课程码，暂时无法生成接取码' }
  }

  if (currentFullCode && currentConfirmCode) {
    return {
      code: 0,
      msg: '已存在可用接取码',
      orderId,
      pickupConfirmCode: currentConfirmCode,
      pickupFullCode: currentFullCode,
      joinCode: baseCourseCode,
      courseCode: baseCourseCode
    }
  }

  // 新增：生成 12 位接取码前的强制前置门槛。
  // 必须先调用 mark_course_info_ready（publish 页点「完成课程信息编辑，允许教练接单」），
  // 否则直接拒绝，从而保证「B家长提交 → 管理层补资料 → mark_ready → 生成接取码 → 待接取」顺序严格推进。
  // 历史兼容：如果 matchedOrder 完全没有 course_info_ready_at 字段（老数据），但 fulfill_state 已经是
  // awaiting/in_progress 或已经生成过 pickup_full_code，则视为已经过了确认流程；否则一律要求重新 mark。
  const infoReadyAt = matchedOrder.course_info_ready_at
    || (((matchedOrder.course_flow_info || {}).course_info_ready_at) || null)
  const explicitPassed =
    (matchedOrder.fulfill_state === 'awaiting')
    || (matchedOrder.fulfill_state === 'in_progress')
    || ((matchedOrder.course_flow_info || {}).fulfill_state === 'awaiting')
    || ((matchedOrder.course_flow_info || {}).fulfill_state === 'in_progress')
  if (!infoReadyAt && !explicitPassed) {
    return {
      code: 1,
      msg: '请先点击【完成课程信息编辑，允许教练接单】确认课程资料完整后，再生成 12 位接取码'
    }
  }

  const newConfirmCode = buildPickupConfirmCode()
  const newFullCode = buildPickupFullCode(baseCourseCode, newConfirmCode)
  if (!newFullCode) {
    return { code: 500, msg: '拼接完整接取码失败，请稍后重试' }
  }

  const now = new Date()
  // 新增：管理层确认生成 12 位接取码的同时，把课程生命周期状态推进到「待接取（awaiting）」，
  // 这样 progress 页面四档 Tab 就能明确把该课程分到「待接取」栏，而不是停留在「待编辑」。
  // 同时顶层 fulfill_state 和 course_flow_info.fulfill_state 一起更新，兼容新旧两套读取位置。
  // 再额外写一个 pickup_code_generated_at 时间戳，方便后续审计和列表排序。
  const currentCourseFlow = getCourseFlowInfo(matchedOrder)
  const nextCourseFlow = {
    ...currentCourseFlow,
    fulfill_state: 'awaiting'
  }
  try {
    await db.collection(targetCollection).doc(orderId).update({
      data: {
        pickup_confirm_code: newConfirmCode,
        pickup_full_code: newFullCode,
        pickup_final_code: '',
        pickup_code_generated_at: now,
        fulfill_state: 'awaiting',
        course_flow_info: _.set(nextCourseFlow),
        updatedAt: now
      }
    })
  } catch (err) {
    console.error('[pickup_generate] update order failed:', err && err.message)
    return { code: 500, msg: '生成接取码失败，请稍后重试' }
  }

  console.log('[pickup_generate] manual confirm success:', {
    orderId,
    courseCode: baseCourseCode,
    pickupFullCode: newFullCode,
    fulfillState: 'awaiting',
    operatorOpenid: safeOpenid
  })

  return {
    code: 0,
    msg: '12 位接取码已生成，课程已进入待接取队列',
    orderId,
    pickupConfirmCode: newConfirmCode,
    pickupFullCode: newFullCode,
    joinCode: baseCourseCode,
    courseCode: baseCourseCode,
    // 新增：前端可以用这个字段判断是否需要立刻把当前课程视为「待接取」，避免等下次拉列表才刷新。
    fulfill_state: 'awaiting'
  }
}

// 新增：发布者重置课程的 4 位确认码。
// 只有课程的创建者（publisher_Id / publisher_openid）能执行，避免任意教练都能把别人的接取码换掉。
// 重置后：旧完整接取码（前 8 位 + 旧 4 位）自动失效；发布者需要把新的 12 位码发给要接取的教练。
// 若课程已经有执行教练，默认会清空 assignedCoach*，让新教练能重新接取；如果想保留当前教练，
// 可在前端额外传 keepCoach=true，这里就不清空。
async function resetPickupConfirmCode(orderId, operatorOpenid, operatorUserId, keepCoach = false) {
  if (!operatorOpenid) {
    return { code: 401, msg: '未获取到身份，请重新登录后再试' }
  }
  const targetCollection = getCollectionName(ORDER_COLLECTION_BASE)
  let matchedOrder = null
  try {
    const orderRes = await db.collection(targetCollection).doc(orderId).get()
    matchedOrder = orderRes && orderRes.data ? orderRes.data : null
  } catch (err) {
    console.error('[pickup_reset] query order failed:', err && err.message)
    return { code: 500, msg: '查询课程失败，请稍后重试' }
  }
  if (!matchedOrder) {
    return { code: 404, msg: '课程不存在' }
  }

  const publisherOpenid = String(getPublisherOpenid(matchedOrder) || '').trim()
  const publisherUserId = String(getPublisherId(matchedOrder) || '').trim()
  const safeOpenid = String(operatorOpenid || '').trim()
  const safeUserId = String(operatorUserId || '').trim()
  const isPublisher =
    (publisherOpenid && safeOpenid && publisherOpenid === safeOpenid) ||
    (publisherUserId && safeUserId && publisherUserId === safeUserId)

  if (!isPublisher) {
    return { code: 403, msg: '只有课程的创建者可以重置接取确认码' }
  }

  const newConfirmCode = buildPickupConfirmCode()
  const baseCourseCode = String(matchedOrder.joinCode || matchedOrder.courseCode || '').trim()
  const newFullCode = buildPickupFullCode(baseCourseCode, newConfirmCode)
  const newFinalCode = keepCoach ? buildPickupFinalCode(newFullCode) : ''
  if (!newFullCode) {
    return { code: 500, msg: '拼接新的完整接取码失败，请确认课程已存在班级码' }
  }

  const now = new Date()
  // 新增：重置接取确认码时，根据 keepCoach 同步修正课程生命周期状态：
  // - keepCoach=false（清空执行教练）→ 回到 awaiting（待接取），等待新教练重新接取；
  // - keepCoach=true（保留原教练，只换确认码）→ 保持 in_progress，不影响正在进行的课程。
  const currentCourseFlow = getCourseFlowInfo(matchedOrder)
  const resetFulfillState = keepCoach ? 'in_progress' : 'awaiting'
  const nextCourseFlow = {
    ...currentCourseFlow,
    fulfill_state: resetFulfillState
  }
  const updatePayload = {
    pickup_confirm_code: newConfirmCode,
    pickup_full_code: newFullCode,
    pickup_final_code: newFinalCode,
    fulfill_state: resetFulfillState,
    course_flow_info: _.set(nextCourseFlow),
    updatedAt: now
  }
  if (!keepCoach) {
    // 不保留当前执行教练时，清空 assignedCoach*，让新码可以被其他教练认领。
    updatePayload.assignedCoachToken = ''
    updatePayload.assignedCoachOpenid = ''
    updatePayload.assignedCoachName = ''
    updatePayload.assignedCoachAt = null
  }

  try {
    await db.collection(targetCollection).doc(orderId).update({ data: updatePayload })
  } catch (err) {
    console.error('[pickup_reset] update confirm code failed:', err && err.message)
    return { code: 500, msg: '重置失败，写入课程信息时出错，请稍后重试' }
  }

  console.log('[pickup_reset] confirm code reset success:', {
    orderId,
    oldFullCode: matchedOrder.pickup_full_code || '',
    newFullCode,
    keepCoach: !!keepCoach,
    operatorOpenid: safeOpenid
  })

  return {
    code: 0,
    msg: keepCoach ? '重置成功，已保留当前执行教练' : '重置成功，旧接取码已失效，请把新的完整接取码发给执行教练',
    orderId,
    pickupConfirmCode: newConfirmCode,
    pickupFullCode: newFullCode,
    pickupFinalCode: newFinalCode,
    joinCode: baseCourseCode,
    courseCode: baseCourseCode,
    keepCoach: !!keepCoach
  }
}

// 新增：管理层在 publish 页点「完成课程信息编辑，允许教练接单」时写入 course_info_ready_at。
// 这是生成 12 位接取码 confirm_generate_pickup_code 的前置强制门槛：
// - 未调用 mark_course_info_ready → confirm_generate_pickup_code 直接拒绝，
//   保证「B家长刚提交 → 管理层补资料 → 手动mark_ready → 生成接取码 → 待接取」顺序严格推进。
// 同时：如果课程仍在 editing（待编辑）或 pending 初始态，调用成功后仍保持 editing
// （因为生成接取码才是推进到 awaiting 的节点），但 course_info_ready_at 会解锁后续生成接取码。
// 已结课/已关闭的课程不允许再 mark，避免误操作。
async function markCourseInfoReady(orderId, operatorOpenid, operatorUserId) {
  if (!operatorOpenid) {
    return { code: 401, msg: '未获取到身份，请重新登录后再试' }
  }
  const targetCollection = getCollectionName(ORDER_COLLECTION_BASE)
  let matchedOrder = null
  try {
    const orderRes = await db.collection(targetCollection).doc(orderId).get()
    matchedOrder = orderRes && orderRes.data ? orderRes.data : null
  } catch (err) {
    console.error('[mark_ready] query order failed:', err && err.message)
    return { code: 500, msg: '查询课程失败，请稍后重试' }
  }
  if (!matchedOrder) {
    return { code: 404, msg: '课程不存在' }
  }

  const publisherOpenid = String(getPublisherOpenid(matchedOrder) || '').trim()
  const publisherUserId = String(getPublisherId(matchedOrder) || '').trim()
  const safeOpenid = String(operatorOpenid || '').trim()
  const safeUserId = String(operatorUserId || '').trim()
  const isPublisher =
    (publisherOpenid && safeOpenid && publisherOpenid === safeOpenid) ||
    (publisherUserId && safeUserId && publisherUserId === safeUserId)
  if (!isPublisher) {
    return { code: 403, msg: '只有课程的创建者可以确认课程资料并允许教练接单' }
  }

  const courseFlow = getCourseFlowInfo(matchedOrder)
  const fulfillState = String(
    courseFlow.fulfill_state || matchedOrder.fulfill_state || 'editing'
  ).trim()
  if (fulfillState === 'closed' || fulfillState === 'cancelled' || fulfillState === 'completed') {
    return { code: 403, msg: '该课程已关闭或已完成，无需再确认课程资料' }
  }

  // 幂等：如果已经确认过（有 ready 时间戳），直接返回成功，不再重复写时间戳。
  const existingReadyAt = matchedOrder.course_info_ready_at || null
  if (existingReadyAt) {
    return {
      code: 0,
      msg: '课程资料已确认，可以继续生成 12 位接取码',
      orderId,
      courseInfoReady: true,
      alreadyReady: true,
      courseInfoReadyAt: existingReadyAt,
      fulfill_state: fulfillState
    }
  }

  // 新增：对课程资料最基本的完整性检查（和前端 publish 页表单校验保持一致的最小集合）：
  // 至少要有课程标题、联系电话、上课地点、排好的课时数 > 0。
  // 避免管理层点了「完成编辑」但资料还是空壳，发出去让教练接了又返工。
  const courseTarget = matchedOrder.course_target || {}
  const courseBasic = matchedOrder.course_basic || {}
  const normalizedTitle = String(courseTarget.title || matchedOrder.title || '').trim()
  const normalizedContact = normalizePhone(
    courseBasic.contact
    || matchedOrder.contact
    || ((matchedOrder.order_base_info || {}).contact || '')
  )
  const normalizedLocation = String(
    courseBasic.location
    || matchedOrder.location
    || ((matchedOrder.course_basic_info || {}).location || '')
  ).trim()
  const scheduleCount = Array.isArray(courseFlow.schedule) ? courseFlow.schedule.length : 0
  const historyCount = Number((((courseFlow || {}).history_sync || {}).syncedCount) || 0)
  const totalLessons = Number(courseFlow.progress_total || matchedOrder.progress_total || (scheduleCount + historyCount)) || 0

  if (!normalizedTitle) {
    return { code: 1, msg: '请先补充课程标题后再确认' }
  }
  if (!isValidPhone(normalizedContact)) {
    return { code: 1, msg: '请先填写正确的 11 位联系手机号后再确认' }
  }
  if (!normalizedLocation) {
    return { code: 1, msg: '请先填写上课地点后再确认' }
  }
  if (totalLessons <= 0) {
    return { code: 1, msg: '请先排好至少 1 节课时后再确认' }
  }

  const now = new Date()
  // 调用成功后不改变 fulfill_state（仍保持 editing 或当前非终态），
  // 只写 course_info_ready_at 解锁后续 confirm_generate_pickup_code → 生成接取码时再推进到 awaiting。
  // 顶层 course_flow_info 也同步写 course_info_ready_at，保证详情读取任一位置都能判断。
  const nextCourseFlow = {
    ...courseFlow,
    course_info_ready_at: now
  }
  try {
    await db.collection(targetCollection).doc(orderId).update({
      data: {
        course_info_ready_at: now,
        course_flow_info: _.set(nextCourseFlow),
        updatedAt: now
      }
    })
  } catch (err) {
    console.error('[mark_ready] update order failed:', err && err.message)
    return { code: 500, msg: '确认失败，写入课程信息时出错，请稍后重试' }
  }

  console.log('[mark_ready] course info confirmed:', {
    orderId,
    operatorOpenid: safeOpenid,
    readyAt: now
  })

  return {
    code: 0,
    msg: '已确认课程资料完整，现在可以点击生成 12 位接取码并对外发布',
    orderId,
    courseInfoReady: true,
    alreadyReady: false,
    courseInfoReadyAt: now,
    fulfill_state: fulfillState
  }
}

/**
 * 获取所有订单（管理员）
 */
async function listAllAdmin(page, limit) {
  const COLLECTIONS = [getCollectionName(ORDER_COLLECTION_BASE)]
  const skip = (page - 1) * limit

  try {
    const fetchPromises = COLLECTIONS.map(colName => {
        return db.collection(colName)
            .orderBy('createdAt', 'desc')
            .skip(0) 
            .limit(page * limit) 
            .field({
                _id: true,
                publish_type: true,
                publish_state: true,
                createdAt: true,
                start_date: true,
                start_time: true,
                address: true,
                userInfo: true,
                contact: true
            })
            .get()
            .then(res => res.data.map(item => ({ ...item, _collection: colName })))
            .catch(err => {
                console.error(`Error fetching ${colName}:`, err)
                return [] 
            })
    })

    const results = await Promise.all(fetchPromises)
    let allOrders = results.flat()
    
    allOrders.sort((a, b) => {
        const timeA = new Date(a.createdAt).getTime()
        const timeB = new Date(b.createdAt).getTime()
        return timeB - timeA
    })
    
    const pagedOrders = allOrders.slice(skip, skip + limit)
    
    return {
        code: 0,
        data: pagedOrders,
        msg: 'ok'
    }

  } catch (err) {
    console.error('listAllAdmin error:', err)
    return {
      code: -1,
      msg: err.message
    }
  }
}

/**
 * 获取系统日志
 */
async function listLogs(page, limit) {
  const skip = (page - 1) * limit
  const logCollection = getCollectionName('sys_logs')

  try {
    const countResult = await db.collection(logCollection).count()
    const total = countResult.total

    const res = await db.collection(logCollection)
      .orderBy('timestamp', 'desc')
      .skip(skip)
      .limit(limit)
      .get()

    return {
      code: 0,
      data: {
        list: res.data,
        total: total,
        page: page,
        limit: limit
      },
      msg: 'ok'
    }
  } catch (err) {
    console.error('listLogs error:', err)
    if (err.errMsg && err.errMsg.includes('Collection not found')) {
        return {
            code: 0,
            data: { list: [], total: 0 },
            msg: 'ok (no logs collection)'
        }
    }
    return {
      code: -1,
      msg: err.message
    }
  }
}

/**
 * 添加系统日志
 */
async function addLog(level, message, details) {
    const logCollection = getCollectionName('sys_logs')
    try {
        await db.collection(logCollection).add({
            data: {
                level: level || 'info',
                message: message || '',
                details: details || {},
                timestamp: db.serverDate(),
                env: cloud.DYNAMIC_CURRENT_ENV
            }
        })
        return { code: 0, msg: 'log added' }
    } catch (err) {
        return { code: -1, msg: err.message }
    }
}

/**
 * 获取单个订单详情
 */
async function getOneOrder(orderId, openid) {
  const { data, collection } = await findOrder(orderId)
  if (!data) return { code: 404, msg: '订单不存在' }

  const normalizedOrder = normalizeOrderForClient(data)
  const isJoined = getPublisherOpenid(data) === openid || getAcceptorOpenid(data) === openid

  return {
    code: 0,
    data: {
      ...normalizedOrder,
      _collection: collection,
      isJoined: isJoined
    },
    // 返回调用者身份信息，供前端权限校验
    caller: {
        openid: openid,
        isJoined: isJoined
    }
  }
}

// 新增协作课程码查询：教练在创建课程页输入家长课程码后，直接把 B 侧已同步到 A 的订单信息拉出来。
async function getOrderByCourseCode(courseCode) {
  const safeCourseCode = normalizeCourseCode(courseCode)
  if (!safeCourseCode) {
    return { code: 1, msg: '请输入课程码' }
  }

  // 新增：8 位 M 码格式预校验。M 码规则是「A 或 B + 7 位可读字符」，合计 8 位；
  // 如果输入看起来像人类短码但不符合这个格式，就提前提示，避免继续打 DB 查不到。
  // 注意：仍然保留对 B 早期 form_xxx / course_xxx / 其他历史长 ID 的兼容入口（直接跳过该校验）。
  const looksLikeShortHumanCode = /^[A-Z0-9]+$/.test(safeCourseCode) && !/^(FORM_|COURSE_)/.test(safeCourseCode)
  if (looksLikeShortHumanCode) {
    const invalidLength = safeCourseCode.length < 6 || safeCourseCode.length > 12
    const invalidMPrefix = safeCourseCode.length === 8 && safeCourseCode[0] !== M_CODE_PREFIX_FROM_A && safeCourseCode[0] !== M_CODE_PREFIX_FROM_B
    if (invalidLength || invalidMPrefix) {
      return {
        code: 1,
        msg: '8 位课程码必须以 A 或 B 开头，后 7 位为大写字母或数字'
      }
    }
  }

  const targetCollection = getCollectionName(ORDER_COLLECTION_BASE)
  // 修复：统一先按 safeCourseCode 做变体，不再沿用原始入参里带大小写 / 空格的脏值。
  // 旧实现 buildCourseCodeVariants(courseCode) 传的是用户原输入，当家长把 B 端 8 位码
  // 复制时混入了软空格 / 中文空格 / 大小写，这里漏一份标准化会造成数据库里匹配失败。
  const codeVariants = buildCourseCodeVariants(safeCourseCode)
  // 新增：M 码三字段 (joinCode / courseCode / parent_course_code) + 历史 B 侧字段 from_b_course_id 都查一遍。
  // from_b_course_id 存在是因为最早的协作码是 B 自己的 courseId 长串，不能漏支持。
  const candidateFields = ['from_b_course_id', 'courseCode', 'joinCode', 'parent_course_code']
  let matchedOrder = null
  // 新增：单字段兜底 try/catch。
  // B(API 桥接) 场景下 from_b_course_id 可能是 B 侧生成的 UUID / 带连字符 / 早期 32 位长 ID，
  // 偶尔数据库里该字段历史值类型不统一（字符串 / 对象 / 数组混存），_.in 比较会抛异常；
  // 过去实现是「一字段报错，整查询失败」，前端就一直转圈。这里改成每个字段独立 try/catch，
  // 某一字段出错只记日志，继续尝试其它字段，保证 joinCode/courseCode/parent_course_code 能匹配到。
  const fieldErrors = []
  for (const fieldName of candidateFields) {
    try {
      const res = await db.collection(targetCollection)
        .where({
          [fieldName]: _.in(codeVariants)
        })
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get()

      if (Array.isArray(res.data) && res.data.length) {
        matchedOrder = res.data[0]
        break
      }
    } catch (err) {
      // 不中断循环，只收集错误用于日志；后续如 4 个字段都失败，就把错误摘要放到 debug 里，
      // 前端可以直接看到到底是查不到还是 DB 内部兼容性异常，避免误以为"一直转圈没反应"。
      fieldErrors.push({
        field: fieldName,
        message: err && (err.message || err.errMsg) || String(err)
      })
      console.warn('[getOrderByCourseCode] 单字段查询失败，继续下一字段:', {
        field: fieldName,
        msg: err && (err.message || err.errMsg) || String(err)
      })
    }
  }

  if (!matchedOrder) {
    return {
      code: 404,
      msg: '未找到对应课程码',
      debug: {
        safeCourseCode,
        codeVariants,
        candidateFields,
        // 新增：把每个字段的命中情况（这里是失败详情）透出给前端，
        // 防止查不到被误判为"前端卡住"或"云端没部署"，真正的问题能立刻在弹窗中看见。
        fieldErrors: fieldErrors.length ? fieldErrors : undefined
      }
    }
  }

  return {
    code: 0,
    msg: 'ok',
    data: normalizeOrderForClient(matchedOrder)
  }
}

/**
 * 开始课程: fulfill_state -> in_progress
 * 旧状态链函数保留，不删除；当前入口已在 switch 中关闭
 */
async function startOrder(orderId, openid, userId) {
  const { data, ref } = await findOrder(orderId)
  if (!data) return { code: 404, msg: '订单不存在' }

  if (!isParticipant(data, openid, userId)) {
    return { code: 403, msg: '无权操作' }
  }

  const orderBaseInfo = {
    ...getOrderBaseInfo(data),
    updatedAt: new Date()
  }
  const courseFlowInfo = {
    ...getCourseFlowInfo(data),
    fulfill_state: 'in_progress',
    startedAt: new Date()
  }

  await ref.update({
    data: {
      order_base_info: orderBaseInfo,
      course_flow_info: courseFlowInfo,
      updatedAt: new Date()
    }
  })

  return { code: 0, msg: '课程已开始' }
}

/**
 * 课节握手
 * 旧课节状态推进函数保留，不删除；当前入口已在 switch 中关闭
 */
async function lessonHandshake(orderId, openid, userId, lessonIndex, subAction) {
  const { data, ref } = await findOrder(orderId)
  if (!data) return { code: 404, msg: '订单不存在' }
  const courseFlowInfo = getCourseFlowInfo(data)
  if (!Array.isArray(courseFlowInfo.schedule) && !Array.isArray(data.schedule)) return { code: 400, msg: '课表不存在' }

  const schedule = Array.isArray(courseFlowInfo.schedule) ? courseFlowInfo.schedule : data.schedule
  const lessonIdx = schedule.findIndex(l => l.lesson == lessonIndex)
  if (lessonIdx === -1) {
      console.warn(`[execution_order] [lessonHandshake] Lesson not found. OrderId: ${orderId}, Target: ${lessonIndex} (${typeof lessonIndex}), Schedule:`, schedule.map(l => l.lesson));
      return { code: 404, msg: '课节不存在' }
  }

  // 新增历史数据兼容：旧课节可能没有 logs 字段，这里统一补齐
  const lesson = {
    ...schedule[lessonIdx],
    logs: Array.isArray(schedule[lessonIdx].logs) ? schedule[lessonIdx].logs : []
  }
  const now = new Date()
  let updates = {}

  switch (subAction) {
    case 'coach_ready':
      // 教练必须是接单人 (校验 ID 或 OpenID)
      if (!isAcceptor(data, openid, userId)) {
          return { code: 403, msg: '非当前教练' }
      }
      lesson.coach_status = 'ready'
      // 2024-05-23: 教练直接开始上课，跳过家长确认
      lesson.status = 'PARENT_CONFIRMED' 
      lesson.parent_status = 'confirmed' // 自动确认
      if (!lesson.startedAt) lesson.startedAt = now
      
      lesson.logs.push({ action: 'coach_start', time: now, userId })
      break

    case 'parent_confirm':
      // MVP: P 侧开课确认入口已下线，保留兜底提示避免旧版本前端误调用
      return { code: 403, msg: 'P侧操作已下线，请使用教练端开始课程' }

    case 'coach_complete':
      if (!isAcceptor(data, openid, userId)) {
          return { code: 403, msg: '非当前教练' }
      }
      lesson.coach_status = 'completed'
      if (!lesson.completedAt) lesson.completedAt = now // Record completion time
      // MVP: 当前课程流程仅提供给 C 方，教练下课后直接视为本节课完成
      lesson.parent_status = 'completed'
      lesson.status = 'DONE'
      updates.progress_done = _.inc(1)
      lesson.logs.push({ action: 'coach_complete', time: now, userId })
      break

    case 'parent_complete':
      // MVP: P 侧结课入口已下线，保留兜底提示避免旧版本前端误调用
      return { code: 403, msg: 'P侧操作已下线，请使用教练端完成课程' }

    default:
      return { code: 400, msg: '未知握手动作' }
  }

  schedule[lessonIdx] = lesson
  const nextCourseFlowInfo = {
    ...courseFlowInfo,
    schedule
  }

  // 自动判断是否完结
  if (lesson.status === 'DONE') {
    // 检查是否需要生成下一节课
    const currentDoneCount = (courseFlowInfo.progress_done || data.progress_done || 0) + 1
    const totalCount = courseFlowInfo.progress_total || data.progress_total || 10

    if (currentDoneCount < totalCount) {
        const nextLessonNum = currentDoneCount + 1
        const exists = schedule.some(l => l.lesson === nextLessonNum)
        if (!exists) {
            schedule.push({
                lesson: nextLessonNum,
                status: 'PENDING',
                coach_status: 'none',
                parent_status: 'none',
                logs: []
            })
            nextCourseFlowInfo.schedule = schedule
        }
    }

    const allDone = schedule.every(l => l.status === 'DONE')
    if (allDone) {
      nextCourseFlowInfo.fulfill_state = 'completed'
      nextCourseFlowInfo.completedAt = new Date()
    } else {
      // 只要有一节课开始，且未全部完成，就是 in_progress
      if ((courseFlowInfo.fulfill_state || data.fulfill_state) !== 'in_progress') {
        nextCourseFlowInfo.fulfill_state = 'in_progress'
      }
    }
  }

  if (updates.progress_done) {
    nextCourseFlowInfo.progress_done = currentSafeNumber(courseFlowInfo.progress_done || data.progress_done) + 1
  }

  await ref.update({
    data: {
      order_base_info: {
        ...getOrderBaseInfo(data),
        updatedAt: new Date()
      },
      course_flow_info: nextCourseFlowInfo,
      updatedAt: new Date()
    }
  })
  return { code: 0, msg: '操作成功', status: lesson.status }
}

/**
 * 更新课程内容 (总结、图片/视频)
 */
async function updateLessonContent(orderId, openid, userId, lessonIndex, content) {
  const { data, ref } = await findOrder(orderId)
  if (!data) return { code: 404, msg: '订单不存在' }
  const courseFlowInfo = getCourseFlowInfo(data)
  if (!Array.isArray(courseFlowInfo.schedule) && !Array.isArray(data.schedule)) return { code: 400, msg: '课表不存在' }

  // 必须是教练或发布者
  // 但通常只有教练填写总结
  if (!isParticipant(data, openid, userId)) {
      return { code: 403, msg: '无权操作' }
  }

  const schedule = Array.isArray(courseFlowInfo.schedule) ? courseFlowInfo.schedule : data.schedule
  const lessonIdx = schedule.findIndex(l => l.lesson == lessonIndex)
  if (lessonIdx === -1) {
      console.warn(`[execution_order] [updateLessonContent] Lesson not found. OrderId: ${orderId}, Target: ${lessonIndex}, Schedule:`, schedule.map(l => l.lesson));
      return { code: 404, msg: '课节不存在' }
  }

  // 新增历史数据兼容：旧课节可能没有 logs 字段，这里统一补齐
  const lesson = {
    ...schedule[lessonIdx],
    logs: Array.isArray(schedule[lessonIdx].logs) ? schedule[lessonIdx].logs : []
  }
  const now = new Date()
  
  // 更新内容
  if (content.summary !== undefined) {
    lesson.summary = content.summary
    // 新增教练总结记录时间，便于页面展示最近一次填写时间
    lesson.summaryUpdatedAt = now
    lesson.logs.push({ action: 'summary_update', time: now, userId })
  }
  // 新增总结日期保存：发布页要求“总结内容 + 上课日期”同时具备才算已完成
  if (content.summaryDate !== undefined) {
    lesson.summaryDate = content.summaryDate || ''
    lesson.logs.push({ action: 'summary_date_update', time: now, userId })
  }
  // 新增上下课时间保存：publish 每日总结页填写时间后，和总结一起回写到当前课节
  if (content.startedAt !== undefined) {
    lesson.startedAt = content.startedAt || ''
    lesson.logs.push({ action: 'started_at_update', time: now, userId })
  }
  if (content.completedAt !== undefined) {
    lesson.completedAt = content.completedAt || ''
    lesson.logs.push({ action: 'completed_at_update', time: now, userId })
  }
  // 新增训练评分保存：每日总结保存时同步记录本节课评分
  if (content.rating !== undefined) {
    lesson.rating = normalizeLessonRating(content.rating)
    lesson.logs.push({ action: 'rating_update', time: now, userId })
  }
  // 新增训练评价标签保存：用于详情页展示本节课的核心反馈标签
  if (content.ratingTags !== undefined) {
    lesson.ratingTags = normalizeLessonRatingTags(content.ratingTags)
    lesson.logs.push({ action: 'rating_tags_update', time: now, userId })
  }
  // 新增多维评分保存：把各个维度的具体分数一起落库，详情页可直接展示
  if (content.dimensionRatings !== undefined) {
    lesson.dimensionRatings = normalizeLessonDimensionRatings(content.dimensionRatings)
    lesson.logs.push({ action: 'dimension_ratings_update', time: now, userId })
  }
  if (content.media !== undefined) lesson.media = content.media // Array of fileIDs

  schedule[lessonIdx] = lesson
  const nextOrder = {
    ...data,
    order_base_info: {
      ...getOrderBaseInfo(data),
      updatedAt: now
    },
    course_flow_info: {
      ...courseFlowInfo,
      schedule
    },
    updatedAt: now
  }
  
  await ref.update({
      data: {
          order_base_info: nextOrder.order_base_info,
          course_flow_info: nextOrder.course_flow_info,
          updatedAt: now
      }
  })

  await syncCoachResultToBIfNeeded(nextOrder, 'lesson_content_updated')

  return { code: 0, msg: '保存成功' }
}

/**
 * 手动完成订单
 * 旧整单完成函数保留，不删除；当前入口已在 switch 中关闭，改由 close 负责课程关闭
 */
async function completeOrder(orderId, openid, userId) {
  const { data, ref } = await findOrder(orderId)
  if (!data) return { code: 404, msg: '订单不存在' }

  if (!isPublisher(data, openid, userId)) {
    return { code: 403, msg: '无权操作' }
  }

  const now = new Date()
  const nextOrder = {
    ...data,
    order_base_info: {
      ...getOrderBaseInfo(data),
      updatedAt: now
    },
    course_flow_info: {
      ...getCourseFlowInfo(data),
      fulfill_state: 'completed',
      completedAt: now
    },
    updatedAt: now
  }

  await ref.update({
    data: {
      order_base_info: nextOrder.order_base_info,
      course_flow_info: nextOrder.course_flow_info,
      updatedAt: now
    }
  })

  await syncCoachResultToBIfNeeded(nextOrder, 'order_completed')
  return { code: 0, msg: '订单已完成' }
}

/**
 * 取消订单
 */
async function cancelOrder(orderId, openid, userId, reason) {
   const { data, ref } = await findOrder(orderId)
   if (!data) return { code: 404, msg: '订单不存在' }

   // 仅发布者或系统管理员可取消
   if (!isPublisher(data, openid, userId)) {
     return { code: 403, msg: '无权操作' }
   }

   const now = new Date()
   const nextOrder = {
     ...data,
     order_base_info: {
       ...getOrderBaseInfo(data),
       updatedAt: now
     },
     course_flow_info: {
       ...getCourseFlowInfo(data),
       fulfill_state: 'cancelled',
       publish_state: 'closed',
       cancelledAt: now,
       cancelReason: reason || '无'
     },
     updatedAt: now
   }

   await ref.update({
     data: {
       order_base_info: nextOrder.order_base_info,
       course_flow_info: nextOrder.course_flow_info,
       updatedAt: now
     }
   })

   await syncCoachResultToBIfNeeded(nextOrder, 'order_cancelled')
   return { code: 0, msg: '订单已取消' }
}

/**
 * 结课
 */
async function closeOrder(orderId, openid, userId, closeSummary, closeCoachNote) {
  const { data, ref } = await findOrder(orderId)
  if (!data) return { code: 404, msg: '订单不存在' }

  if (!isPublisher(data, openid, userId)) {
    return { code: 403, msg: '无权操作' }
  }

  const now = new Date()
  const nextOrder = {
    ...data,
    order_base_info: {
      ...getOrderBaseInfo(data),
      updatedAt: now
    },
    course_flow_info: {
      ...getCourseFlowInfo(data),
      fulfill_state: 'closed',
      publish_state: 'closed',
      closedAt: now,
      // 新增结课页字段：结语和教练备注随结课动作一起落库
      close_summary: closeSummary || '',
      close_coach_note: closeCoachNote || ''
    },
    updatedAt: now
  }

  await ref.update({
    data: {
      order_base_info: nextOrder.order_base_info,
      course_flow_info: nextOrder.course_flow_info,
      updatedAt: now
    }
  })

  await syncCoachResultToBIfNeeded(nextOrder, 'order_closed')

  return { code: 0, msg: '课程已结课' }
}

/**
 * 获取我的列表
 */
async function listMyself(openid, userId, page, limit) {
  const collections = [getCollectionName(ORDER_COLLECTION_BASE)]
  const query = _.or([
    { 'order_base_info.publisher_openid': openid },
    { publisher_openid: openid },
    { 'order_base_info.acceptorId': userId },
    { acceptorId: userId },
    { 'order_base_info.acceptorOpenid': openid },
    { acceptorOpenid: openid }
  ])

  // 并发查询
  const tasks = collections.map(c => 
    db.collection(c).where(query).orderBy('createdAt', 'desc').limit(50).get().catch(()=>({data:[]}))
  )
  
  const results = await Promise.all(tasks)
  let allOrders = []
  results.forEach(r => { allOrders = allOrders.concat(r.data) })
  
  // Deduplicate by _id
  const uniqueOrders = new Map();
  for (const order of allOrders) {
      if (!uniqueOrders.has(order._id)) {
          uniqueOrders.set(order._id, order);
      }
  }
  allOrders = Array.from(uniqueOrders.values());

  // 内存排序
  allOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  
  // 分页
  const start = (page - 1) * limit
  const pagedData = allOrders.slice(start, start + limit)
  
  return { code: 0, data: pagedData.map(item => normalizeOrderForClient(item)) }
}


/**
 * 手动添加课节 (教练)
 */
async function addLesson(orderId, openid) {
  const { data, collection, ref } = await findOrder(orderId)
  if (!data) return { code: 404, msg: '订单不存在' }

  // 权限校验 (必须是接单人)
  if (getAcceptorOpenid(data) !== openid) {
      return { code: 403, msg: '无权操作' }
  }

  const courseFlowInfo = getCourseFlowInfo(data)
  const currentSchedule = courseFlowInfo.schedule || data.schedule || [];
  const lastLesson = currentSchedule.length > 0 ? (currentSchedule[currentSchedule.length - 1].lesson || currentSchedule.length) : 0;
  const nextLessonIndex = lastLesson + 1;
  const currentTotal = courseFlowInfo.progress_total || data.progress_total || 0;

  const newLesson = {
    lesson: nextLessonIndex,
    status: 'PENDING',
    coach_status: 'none',
    parent_status: 'none',
    logs: [{ action: 'manual_add', time: new Date() }]
  };

  const nextSchedule = currentSchedule.concat(newLesson)
  const nextCourseFlowInfo = {
    ...courseFlowInfo,
    schedule: nextSchedule
  }

  // Only increment progress_total if we are exceeding the current total
  // (Assuming manual addition is used to fill up the quota first)
  if (currentSchedule.length >= currentTotal) {
      nextCourseFlowInfo.progress_total = currentTotal + 1
  }

  await ref.update({
    data: {
      order_base_info: {
        ...getOrderBaseInfo(data),
        updatedAt: new Date()
      },
      course_flow_info: nextCourseFlowInfo,
      updatedAt: new Date()
    }
  });

  return { code: 0, msg: '添加成功', data: newLesson };
}

/**
 * 半途接入课程
 */
async function syncLessonProgress(orderId, openid, userId, totalLessons, startLesson, historyCount) {
  const { data, ref } = await findOrder(orderId)
  if (!data) return { code: 404, msg: '订单不存在' }

  // 新增半途接入权限：发布者和当前教练都可以补录
  if (!isParticipant(data, openid, userId)) {
    return { code: 403, msg: '无权操作' }
  }

  // 新增三节锁定限制：接入后累计记录满 3 节课后不再允许修改课表
  if (hasLessonPlanConfigured(data)) {
    return { code: 409, msg: '接入后已记录满3节课，当前课程不再允许修改总课时或重新半途接入' }
  }

  const safeTotalLessons = parseInt(totalLessons, 10)
  const parsedHistoryCount = parseInt(historyCount, 10)
  const safeHistoryCount = Number.isNaN(parsedHistoryCount) ? null : parsedHistoryCount
  const safeStartLesson = safeHistoryCount !== null ? (safeHistoryCount + 1) : parseInt(startLesson, 10)

  if (!safeTotalLessons || safeTotalLessons < 1) {
    return { code: 400, msg: '总课时至少为1' }
  }

  if (!safeStartLesson || safeStartLesson < 1 || safeStartLesson > safeTotalLessons) {
    return { code: 400, msg: '开始课次不合法' }
  }

  const newSchedule = []
  for (let lessonNum = safeStartLesson; lessonNum <= safeTotalLessons; lessonNum += 1) {
    newSchedule.push({
      lesson: lessonNum,
      logs: []
    })
  }

  // 新增历史补录摘要：把前面的历史课节收口到一个字段里，避免逐节补建
  const historyDoneCount = safeStartLesson - 1
  const currentCourseFlowInfo = getCourseFlowInfo(data)
  const { history_sync: ignoredLegacyHistorySync, ...courseFlowInfoWithoutHistorySync } = currentCourseFlowInfo
  const nextHistorySync = {
    synced: historyDoneCount > 0,
    syncedCount: historyDoneCount,
    startLesson: safeStartLesson,
    updatedAt: new Date()
  }
  const nextCourseFlowInfo = {
    ...courseFlowInfoWithoutHistorySync,
    progress_total: safeTotalLessons,
    progress_done: historyDoneCount,
    schedule: newSchedule,
    history_sync: nextHistorySync,
    // 新增状态收敛：当前课程流程只区分“未关闭 / 已关闭”，不再在这里推进旧进行中状态
    fulfill_state: 'pending'
  }
  const now = new Date()
  const nextOrder = {
    ...data,
    order_base_info: {
      ...getOrderBaseInfo(data),
      updatedAt: now
    },
    course_flow_info: {
      ...nextCourseFlowInfo
    },
    updatedAt: now
  }

  await ref.update({
    data: {
      order_base_info: nextOrder.order_base_info,
      // 兼容旧订单里 history_sync 为 null 的情况：这里必须用 _.set 整块替换 course_flow_info，避免 update 深层写入 history_sync.startLesson 时报错
      course_flow_info: _.set(nextCourseFlowInfo),
      updatedAt: now
    }
  })

  await syncCoachResultToBIfNeeded(nextOrder, 'lesson_progress_synced')

  return {
    code: 0,
    msg: '补录成功',
    data: {
      progress_total: safeTotalLessons,
      progress_done: historyDoneCount,
      startLesson: safeStartLesson
    }
  }
}

/**
 * 新增页面进入记录
 */
async function addEntryLog(orderId, openid, userId, event = {}) {
  const { data, ref } = await findOrder(orderId)
  if (!data) return { code: 404, msg: '订单不存在' }

  const shareVisibility = getShareVisibility(data)
  const currentLogs = Array.isArray(shareVisibility.entry_logs)
    ? shareVisibility.entry_logs
    : (Array.isArray(data.entry_logs) ? data.entry_logs : [])
  const entryLog = {
    page: event.page || '',
    from: event.from || 'normal',
    pageMode: event.pageMode || 'normal',
    viewerOpenid: openid,
    viewerUserId: userId || '',
    sharerOpenid: event.sharerOpenid || '',
    extra: event.extra || {},
    createdAt: new Date()
  }

  await ref.update({
    data: {
      order_base_info: {
        ...getOrderBaseInfo(data),
        updatedAt: new Date()
      },
      share_visibility: {
        ...shareVisibility,
        entry_logs: currentLogs.concat(entryLog)
      },
      updatedAt: new Date()
    }
  })

  return { code: 0, msg: '记录成功' }
}

// 新增 B -> A 导入入口：B 侧先落本地，再把家长已填信息中转到 A，A 这里按最小可操作结构直接建单。
async function syncParentBookingToA(event = {}) {
  const inviteCode = normalizeInviteCode(event.inviteCode)
  const phone = normalizePhone(event.contact || event.phone || '')
  const location = String(event.location || '').trim()

  if (!inviteCode) {
    return { code: 1, msg: '缺少 inviteCode' }
  }

  if (!isValidPhone(phone)) {
    return { code: 1, msg: '请填写正确的11位手机号' }
  }

  if (!location) {
    return { code: 1, msg: '缺少上课地点' }
  }

  const targetCollection = getCollectionName(ORDER_COLLECTION_BASE)
  const importedOrganizationDoc = await getOrganizationDocByInviteCode(inviteCode)
  const importedSubmitForm = buildImportedSubmitForm(event, importedOrganizationDoc)
  const groupedPayload = buildGroupedOrderPayload(importedSubmitForm)
  // 新增：情况 2 的 B 约课场景（家长在 B 端提交约课后，A 侧大云函数直接建 A 订单）。
  // 按约定必须生成「前缀 B」的 8 位 M 码，保证后续家长拿到的 M 和教练在 A 端查到的 M 完全一致。
  const uniqueMCode = await generateUniqueMCode(targetCollection, M_CODE_PREFIX_FROM_B)
  const now = new Date()
  const classCount = Number(importedSubmitForm.class_count || 10) || 10
  const schedule = []

  for (let lessonNum = 1; lessonNum <= classCount; lessonNum += 1) {
    schedule.push({
      lesson: lessonNum,
      logs: []
    })
  }

  const organizationBasic = (importedOrganizationDoc && importedOrganizationDoc.organization_basic) || {}
  const ownerOpenid = String(organizationBasic.owner_openid || '').trim()
  const ownerUserId = String(organizationBasic.owner_user_id || '').trim()
  const orderOrgInfo = normalizeOrderOrganizationInfo(
    importedSubmitForm.order_org_info || {
      orgId: organizationBasic.organization_id || '',
      orgName: organizationBasic.organization_name || '',
      memberRole: importedOrganizationDoc ? 'admin' : '',
      inviteCode
    }
  )
  const orderBaseInfo = {
    ...groupedPayload.order_base_info,
    // 新增导入归属：命中机构邀请码时，先挂到机构 owner，保证课程能进入 A 侧现有管理链路。
    acceptorId: ownerUserId,
    acceptorOpenid: ownerOpenid,
    publisher_Id: ownerUserId,
    publisher_openid: ownerOpenid,
    create_time: groupedPayload.order_base_info.create_time || now.toISOString(),
    createdAt: now,
    updatedAt: now
  }
  const courseConfig = {
    ...groupedPayload.course_config,
    class_count: classCount
  }
  const courseFlowInfo = {
    ...groupedPayload.course_flow_info,
    publish_type: '发布看看',
    // 新增导入态标识：和 A 端教练直接创建的 direct 区分开，方便后续回查。
    publish_state: 'bridged_from_b',
    // 新增：B 家长刚提交表单时，课程资料还不完整（机构/管理层还要在 publish 页面补学员、时间、地点等），
    // 因此初始 fulfill_state 固定为 editing（待编辑），后续只有管理层手动点「完成课程信息编辑，允许教练接单」
    // mark_course_info_ready → 再点「确认生成 12 位接取码」confirm_generate_pickup_code → 才会进到 awaiting。
    fulfill_state: 'editing',
    progress_total: classCount,
    progress_done: 0,
    schedule
  }
  const shareVisibility = {
    ...groupedPayload.share_visibility,
    entry_logs: []
  }
  const importedTargetSnapshot = parseJsonLike(event.targetSnapshot, {})
  const otherInfo = {
    ...groupedPayload.other_info,
    userInfo: {
      nickName: String(event.parentName || '家长提交').trim() || '家长提交',
      avatarUrl: ''
    },
    publisherInfo: {
      nickName: String(event.parentName || '家长提交').trim() || '家长提交',
      avatarUrl: ''
    },
    imported_target_snapshot: importedTargetSnapshot,
    imported_parent_name: String(event.parentName || '').trim(),
    imported_phone: phone
  }

  const data = {
    ...groupedPayload,
    order_org_info: orderOrgInfo,
    order_base_info: orderBaseInfo,
    course_config: courseConfig,
    course_flow_info: courseFlowInfo,
    share_visibility: shareVisibility,
    other_info: otherInfo,
    orgId: orderOrgInfo.orgId || '',
    orgName: orderOrgInfo.orgName || '',
    orgMemberRole: orderOrgInfo.memberRole || '',
    bridge_status: BRIDGE_STATUS_SYNCED,
    source: SOURCE_FROM_B_PARENT,
    from_b_form_id: String(event.from_b_form_id || '').trim(),
    from_b_course_id: String(event.from_b_course_id || '').trim(),
    from_b_openid: String(event.from_b_openid || '').trim(),
    imported_target_snapshot: importedTargetSnapshot,
    // 新增：情况2 B 约课生成的 8 位 M 码(Bxxxxxxx)统一写三份；
    // joinCode 给教练管理列表展示，courseCode 给协作查询老链路复用，
    // parent_course_code 给 B 侧 extractParentCourseCode 抽走写回家长文档。
    joinCode: uniqueMCode,
    courseCode: uniqueMCode,
    parent_course_code: uniqueMCode,
    // 新增：B 约课桥接进 A 后，同样改成由 A 端管理层在 publish 页面手动确认后才生成 12 位接取码。
    pickup_confirm_code: '',
    pickup_full_code: '',
    pickup_final_code: '',
    assignedCoachToken: '',
    assignedCoachOpenid: '',
    assignedCoachName: '',
    assignedCoachAt: null,
    // 新增：B 端桥接课程默认是「待编辑」。后续必须先 mark_course_info_ready（手动确认课程资料补完），
    // 才能继续点 confirm_generate_pickup_code 生成接取码并进入「待接取」。
    // 顶层 fulfill_state 同步写 editing，保证 progress 前端两处读取位置都能识别。
    fulfill_state: 'editing',
    // 新增：课程资料「管理层已确认允许教练接单」的显式标志。null / 不存在 = 还没确认；
    // 有时间戳 = 已确认，可以走 confirm_generate_pickup_code 生成 12 位接取码。
    course_info_ready_at: null,
    createdAt: now,
    updatedAt: now
  }

  const res = await db.collection(targetCollection).add({ data })
  const newOrderId = res._id

  await appendOrderIdToOrganizationClass(
    orderOrgInfo,
    newOrderId,
    importedOrganizationDoc
  )

  return {
    code: 0,
    msg: 'B 侧家长订单已导入 A',
    orderId: newOrderId,
    a_order_id: newOrderId,
    // 新增：B 侧抽取函数对位置兼容性非常强（parentCourseCode/joinCode/courseCode 三个字段都抽），
    // 这里同时传三份 + data 嵌套，保证无论走哪个分支都能把家长端 M 码正确落库。
    parent_course_code: uniqueMCode,
    joinCode: uniqueMCode,
    courseCode: uniqueMCode,
    data: {
      parent_course_code: uniqueMCode,
      joinCode: uniqueMCode,
      courseCode: uniqueMCode
    },
    bindStatus: ownerOpenid ? 'bound_to_org_owner' : 'unbound',
    boundOwnerOpenid: ownerOpenid,
    source: SOURCE_FROM_B_PARENT
  }
}


/**
 * 发布订单
 */
async function publishOrder(submitForm, openid, userId) {
  if (!submitForm) return { code: 1, msg: '提交数据为空' }
  
  const publishType = (submitForm.publish_type || '').trim()
  if (publishType !== '发布看看') {
    return { code: 1, msg: '当前仅支持发布看看' }
  }
  // 新增联系方式校验：云端和前端统一按 11 位大陆手机号收口，避免旧页面绕过前端校验
  if (!isValidPhone(submitForm.contact || ((submitForm.course_basic || {}).contact) || ((submitForm.course_basic_info || {}).contact))) {
    return { code: 1, msg: '请填写正确的11位手机号' }
  }
  const groupedPayload = buildGroupedOrderPayload(submitForm)
  const organizationPermission = await ensureOrganizationPublishPermission(groupedPayload.order_org_info, openid)
  if (organizationPermission && organizationPermission.code) {
    return organizationPermission
  }
  const targetCollection = getCollectionName(ORDER_COLLECTION_BASE)
  const publishState = 'direct'
  
  const userInfo = submitForm.userInfo || { nickName: '发布者', avatarUrl: '' };
  // 新增：情况 2 的教练 A 直建场景。生成「前缀 A」的 8 位 M 码，保证和 B 约课的前缀 B 明显区分。
  const uniqueMCode = await generateUniqueMCode(targetCollection, M_CODE_PREFIX_FROM_A)
  const now = new Date();
  const classCount = submitForm.class_count || 1;
  const schedule = [];
  for (let lessonNum = 1; lessonNum <= classCount; lessonNum += 1) {
    schedule.push({
      lesson: lessonNum,
      logs: []
    })
  }
  const orderOrgInfo = normalizeOrderOrganizationInfo(
    (organizationPermission && organizationPermission.orderOrgInfo) || groupedPayload.order_org_info
  )
  const orderBaseInfo = {
    ...groupedPayload.order_base_info,
    acceptorId: userId,
    acceptorOpenid: openid,
    publisher_Id: userId,
    publisher_openid: openid,
    create_time: groupedPayload.order_base_info.create_time || now.toISOString(),
    createdAt: now,
    updatedAt: now
  }
  const courseConfig = {
    ...groupedPayload.course_config,
    class_count: classCount
  }
  const courseFlowInfo = {
    ...groupedPayload.course_flow_info,
    publish_type: publishType,
    publish_state: publishState,
    // 新增：A 端直建课程，初始仍然是「待编辑 editing」，表示发布者还可以继续改标题、课节、学员等资料。
    // 只有发布者在 publish 页手动 mark_course_info_ready → confirm_generate_pickup_code
    // 才会依次推进到「允许教练接单 → 待接取（awaiting）」。
    fulfill_state: 'editing',
    progress_total: classCount,
    progress_done: 0,
    schedule
  }
  const shareVisibility = {
    ...groupedPayload.share_visibility,
    entry_logs: []
  }
  const otherInfo = {
    ...groupedPayload.other_info,
    userInfo,
    publisherInfo: userInfo
  }

  const data = {
    ...groupedPayload,
    order_org_info: orderOrgInfo,
    order_base_info: orderBaseInfo,
    course_config: courseConfig,
    course_flow_info: courseFlowInfo,
    share_visibility: shareVisibility,
    other_info: otherInfo,
    // 新增顶层机构归属索引：前端列表直接按这些字段识别机构课程，不再额外猜测
    orgId: orderOrgInfo.orgId || '',
    orgName: orderOrgInfo.orgName || '',
    orgMemberRole: orderOrgInfo.memberRole || '',
    // 新增来源字段：A 端教练直接提交的订单也统一补 source，后面列表和回查不再靠猜。
    // 特殊情况：如果 submitForm 带了协作码导入来源（source / bridge_status / from_b_*），
    // 说明这一单是"输入 B M 码 → 查已有桥信息 → 新建 A 管理课程"的衍生课，
    // 这时保持来源信息原样透传，不会硬覆盖成 SOURCE_FROM_A_DIRECT，保证后续列表仍能
    // 区分"纯 A 直建"和"B 家长约课带过来的 A 衍生课"。
    source: String(submitForm.source || '').trim() || SOURCE_FROM_A_DIRECT,
    bridge_status: String(submitForm.bridge_status || '').trim() || '',
    from_b_form_id: String(submitForm.from_b_form_id || '').trim(),
    from_b_course_id: String(submitForm.from_b_course_id || '').trim(),
    from_b_openid: String(submitForm.from_b_openid || '').trim(),
    // 新增：情况2 教练 A 直建课程的 8 位 M 码 (Axxxxxxx)。
    // 三份同写 joinCode/courseCode/parent_course_code，保证管理列表 / 协作查询 / 未来 B 侧读取都能直接复用。
    joinCode: uniqueMCode,
    courseCode: uniqueMCode,
    parent_course_code: uniqueMCode,
    // 新增：教练接取码相关字段。
    // 现在改成“管理层在 A 端 publish 页面手动确认后才生成”：
    // 建课时先不自动给出 12 位接取码，只保留 8 位课程码；执行教练接取仍然吃后续手动生成出的完整码。
    // assignedCoach*：执行教练认领后写入，未认领时为空字符串。
    pickup_confirm_code: '',
    pickup_full_code: '',
    pickup_final_code: '',
    assignedCoachToken: '',
    assignedCoachOpenid: '',
    assignedCoachName: '',
    assignedCoachAt: null,
    // 新增：A 端直建课程初始仍然在「待编辑」阶段，同步写入顶层 fulfill_state，
    // 保证 progress 四档 Tab 直接落入「待编辑」而不是提前到待接取。
    fulfill_state: 'editing',
    // 新增：课程资料确认标志。发布者在 publish 页确认信息完整后，mark_course_info_ready
    // 会写入时间戳；confirm_generate_pickup_code 会校验这个时间戳，避免还没补完资料就开始对外发接取码。
    course_info_ready_at: null,
    createdAt: now,
    updatedAt: now
  }
  
  const res = await db.collection(targetCollection).add({ data })
  const newOrderId = res._id;
  console.log('订单创建成功:', newOrderId, ' M 码(fromA):', uniqueMCode, ' 接取码待管理层手动确认生成');

  await appendOrderIdToOrganizationClass(
    orderOrgInfo,
    newOrderId,
    organizationPermission && organizationPermission.organizationDoc
  )

  return {
    code: 0,
    msg: '发布成功',
    orderId: newOrderId,
    // 新增：发布成功后直接把 M 码回传给前端，教练管理页 / 详情页不用再拉一次详情。
    joinCode: uniqueMCode,
    courseCode: uniqueMCode,
    parent_course_code: uniqueMCode
  }
}

/**
 * 新增修改订单
 */
async function updateOrder(orderId, submitForm, openid, userId) {
  if (!submitForm) return { code: 1, msg: '提交数据为空' }

  const { data, ref } = await findOrder(orderId)
  if (!data || !ref) return { code: 404, msg: '订单不存在' }

  if (!isPublisher(data, openid, userId)) {
    return { code: 403, msg: '无权修改' }
  }
  // 新增修改兜底校验：编辑课程时联系方式也必须保持 11 位大陆手机号
  if (!isValidPhone(submitForm.contact || ((submitForm.course_basic || {}).contact) || ((submitForm.course_basic_info || {}).contact))) {
    return { code: 1, msg: '请填写正确的11位手机号' }
  }

  const groupedPayload = buildGroupedOrderPayload(submitForm)
  const nextOrderOrgInfoDraft = normalizeOrderOrganizationInfo({
    ...getOrderOrganizationInfo(data),
    ...groupedPayload.order_org_info
  })
  const organizationPermission = await ensureOrganizationPublishPermission(nextOrderOrgInfoDraft, openid)
  if (organizationPermission && organizationPermission.code) {
    return organizationPermission
  }
  const nextOrderOrgInfo = normalizeOrderOrganizationInfo(
    (organizationPermission && organizationPermission.orderOrgInfo) || nextOrderOrgInfoDraft
  )
  const orderBaseInfo = {
    ...getOrderBaseInfo(data),
    create_time: getOrderBaseInfo(data).create_time || data.create_time || groupedPayload.order_base_info.create_time || '',
    updatedAt: new Date()
  }
  const courseFlowInfo = {
    ...getCourseFlowInfo(data),
    allow_transfer_to_other_coach: groupedPayload.course_flow_info.allow_transfer_to_other_coach,
    publish_type: submitForm.publish_type || getCourseFlowInfo(data).publish_type || data.publish_type || '发布看看'
  }

  // 新增编辑更新：仅覆盖填写页会修改的字段，保留订单主状态和参与关系
  const updateData = {
    order_base_info: orderBaseInfo,
    child_profile: groupedPayload.child_profile,
    teaching_record: groupedPayload.teaching_record,
    order_org_info: nextOrderOrgInfo.orgId ? nextOrderOrgInfo : _.remove(),
    course_config: {
      ...getCourseConfig(data),
      ...groupedPayload.course_config
    },
    coach_private: groupedPayload.coach_private,
    course_basic_info: groupedPayload.course_basic_info,
    course_flow_info: courseFlowInfo,
    share_visibility: getShareVisibility(data),
    other_info: {
      ...getOtherInfo(data),
      ...groupedPayload.other_info
    },
    orgId: nextOrderOrgInfo.orgId || _.remove(),
    orgName: nextOrderOrgInfo.orgName || _.remove(),
    orgMemberRole: nextOrderOrgInfo.memberRole || _.remove(),
    // 新增旧顶层字段清理：数据库里不再保留重复的铺平字段
    title: _.remove(),
    category: _.remove(),
    description: _.remove(),
    create_time: _.remove(),
    class_count: _.remove(),
    frequency: _.remove(),
    location: _.remove(),
    contact: _.remove(),
    latitude: _.remove(),
    longitude: _.remove(),
    course_size_mode: _.remove(),
    safety_confirmed: _.remove(),
    child_age: _.remove(),
    child_gender: _.remove(),
    child_height: _.remove(),
    child_weight: _.remove(),
    price_interval: _.remove(),
    coach_private_note: _.remove(),
    allow_transfer_to_other_coach: _.remove(),
    course_target: _.remove(),
    course_basic: _.remove(),
    entry_logs: _.remove(),
    publisher_openid: _.remove(),
    publisher_Id: _.remove(),
    acceptorOpenid: _.remove(),
    acceptorId: _.remove(),
    publish_state: _.remove(),
    fulfill_state: _.remove(),
    progress_total: _.remove(),
    progress_done: _.remove(),
    schedule: _.remove(),
    history_sync: _.remove(),
    userInfo: _.remove(),
    publisherInfo: _.remove(),
    usertoken: _.remove(),
    group_rules: _.remove(),
    updatedAt: new Date()
  }

  await ref.update({
    data: updateData
  })

  await appendOrderIdToOrganizationClass(
    nextOrderOrgInfo,
    orderId,
    organizationPermission && organizationPermission.organizationDoc
  )

  return { code: 0, msg: '修改成功', orderId }
}

/**
 * 获取详细信息 (管理员)
 */
async function adminGetDetail(id, collectionName) {
    const normalizedCollectionName = normalizeCollectionName(collectionName);
    const ALLOWED_COLLECTIONS = [
      getCollectionName(ORDER_COLLECTION_BASE),
      getCollectionName('sys_logs'),
      getCollectionName('sys_user')
    ];
    if (!ALLOWED_COLLECTIONS.includes(normalizedCollectionName)) {
        return { code: 403, msg: '非法集合访问' };
    }

    try {
        const res = await db.collection(normalizedCollectionName).doc(id).get();
        return {
            code: 0,
            data: res.data
        };
    } catch (err) {
        console.error('adminGetDetail error:', err);
        return { code: 404, msg: '未找到记录或查询失败', error: err };
    }
}

// ================= 辅助函数 =================

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

function isParticipant(order, openid, userId) {
  if (isPublisher(order, openid, userId)) return true
  if (isAcceptor(order, openid, userId)) return true
  return false
}

function isPublisher(order, openid, userId) {
  if (getPublisherOpenid(order) === openid || getPublisherId(order) === userId) return true
  return false
}

function isAcceptor(order, openid, userId) {
  if (getAcceptorOpenid(order) === openid || getAcceptorId(order) === userId) return true
  return false
}
