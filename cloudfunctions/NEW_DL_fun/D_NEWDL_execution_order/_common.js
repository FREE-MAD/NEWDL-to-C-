/**
 * _common.js —— 订单域纯函数层（禁 db、禁 dev_index）
 *
 * 从 dev_index.js 抽出的纯函数：手机号/邀请码/课程码归一化、课程码工具、订单投影 helper、
 * 权限判断（isPublisher/isAcceptor/isParticipant）、评分归一化、normalizeOrderForClient。
 *
 * 依赖方向：_common → {_constants, courseState, _shared/request}，是依赖图的叶子层之一。
 * 不含任何 db / getCollectionName 调用（数据访问在 _db.js）。
 */

const courseState = require('./_shared/courseState')
const { parseJsonLike } = require('./_shared/request')
const {
  M_CODE_CHARSET,
  ORG_M_CODE_SOURCE_SUFFIX_FROM_B,
  SOURCE_FROM_A_DIRECT,
  SOURCE_FROM_B_PARENT,
  ACTION_SYNC_COACH_RESULT_TO_B,
  COACH_BINDING_REQUESTS_FIELD,
  COACH_BINDING_STATUS_PENDING
} = require('./_constants')

const { pickState, readCourseState, resolveStateSuffix } = courseState

// ---------------------------------------------------------------------------
// 归一化：手机号 / 邀请码 / 课程码
// ---------------------------------------------------------------------------

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

// 新增（2026-09-21）：机构课程码「混合大小写」形态还原。
// 背景：机构课程码由 generateOrgSequenceMCode 生成，形如
// 「机构代码(≤4 位大写) + 数字序号 + 小写来源后缀 b」，例如 SZDX001b —— 只有末位 b 是小写，主体全大写。
// 而输入侧普遍做了统一转大写（normalizeCourseCode / 前端 index.js 的 toUpperCase），得到 SZDX001B，
// 与库里真实值 SZDX001b 不一致；原有变体集合只有「全大写 / 全小写」两种，
// 唯独缺「主体大写 + 末位小写 b」这一种，导致机构课按码查询 100% 落空。
// 规则与 twowaybinding_1_DLforC 的 normalizeParentCourseCode 保持一致，避免两份副本再次分叉：
// - 末位已是小写 b：主体转大写、保留小写 b；
// - 末位是大写 B：先判断是否旧 M 码（B + 7 位 M_CODE_CHARSET 字符，全大写），是则保持大写不动；
//   否则判定为「被误转大写的新码制后缀」，转回小写 b；
// - 其他形态：统一转大写。
function normalizeParentCourseCode(code = '') {
  const trimmed = String(code || '').replace(/\s+/g, '').trim()
  if (!trimmed) {
    return ''
  }
  const last = trimmed.slice(-1)
  if (last === ORG_M_CODE_SOURCE_SUFFIX_FROM_B) {
    return trimmed.slice(0, -1).toUpperCase() + ORG_M_CODE_SOURCE_SUFFIX_FROM_B
  }
  if (last === 'B') {
    const upperTrimmed = trimmed.toUpperCase()
    const isLegacyMCode = upperTrimmed.length === 8
      && new RegExp(`^B[${M_CODE_CHARSET}]{7}$`).test(upperTrimmed)
    if (isLegacyMCode) {
      return upperTrimmed
    }
    return trimmed.slice(0, -1).toUpperCase() + ORG_M_CODE_SOURCE_SUFFIX_FROM_B
  }
  return trimmed.toUpperCase()
}

// 新增课程码候选值：兼容直接输入原值、去空格值和大小写差异，按最小成本做一次兜底查询。
function buildCourseCodeVariants(code = '') {
  const rawCode = String(code || '').trim()
  const compactCode = rawCode.replace(/\s+/g, '')
  const upperCode = normalizeCourseCode(code)
  const lowerCode = upperCode.toLowerCase()
  // 新增（2026-09-21）：机构码「主体大写 + 末位小写 b」混合形态（如 SZDX001b）。
  const mixedCode = normalizeParentCourseCode(upperCode)

  return Array.from(new Set([
    rawCode,
    compactCode,
    upperCode,
    lowerCode,
    mixedCode
  ].filter(Boolean)))
}

// ---------------------------------------------------------------------------
// 课程状态后缀码（新码制：课程码 + 2 位状态后缀）
// ---------------------------------------------------------------------------

const { STATE_SUFFIX_LENGTH, STATE_PICKUP_CODE_LENGTH, VALID_STATE_SUFFIXES } = require('./_constants')

// 新增：构造「课程码 + 状态后缀」形式的接取码。
function buildStatePickupCode(courseCode = '', stateSuffix = '') {
  const safeCourse = String(courseCode || '').replace(/[^a-zA-Z0-9]/g, '')
  const safeSuffix = String(stateSuffix || '').toLowerCase().replace(/[^a-z]/g, '')
  if (safeCourse.length !== 8 || safeSuffix.length !== STATE_SUFFIX_LENGTH) {
    return ''
  }
  if (!VALID_STATE_SUFFIXES.includes(safeSuffix)) {
    return ''
  }
  return `${safeCourse}${safeSuffix}`
}

// 新增：从「课程码 + 状态后缀」接取码中拆出课程码与状态后缀。
function splitStatePickupCode(rawCode = '') {
  const cleaned = String(rawCode || '').replace(/[^a-zA-Z0-9]/g, '')
  if (cleaned.length !== STATE_PICKUP_CODE_LENGTH) {
    return { courseCode: '', stateSuffix: '' }
  }
  const courseCode = cleaned.slice(0, 8)
  const stateSuffix = cleaned.slice(8).toLowerCase()
  if (!VALID_STATE_SUFFIXES.includes(stateSuffix)) {
    return { courseCode: '', stateSuffix: '' }
  }
  return { courseCode, stateSuffix }
}

// 新增：读取订单的 state_history 数组（兜底返回空数组）。
// 兼容两种存储位置：顶层 state_history / course_flow_info.state_history。
function getStateHistory(order = {}) {
  return courseState.getStateHistory(order)
}

// 新增：取 state_history 的最新状态后缀（数组末尾元素），为空则按 fulfill_state 兜底映射。
function resolveCurrentStateSuffix(order = {}) {
  return resolveStateSuffix(order)
}

// ---------------------------------------------------------------------------
// M 码工具
// ---------------------------------------------------------------------------

// 新增：构造符合 8 位「前缀 + 随机位」格式的候选串（不做唯一性校验）
function buildMCandidate(prefix) {
  const safePrefix = String(prefix || '').trim().toUpperCase().slice(0, 1)
  let randPart = ''
  const ts = Date.now()
  let seed = ts & 0x7fffffff
  for (let i = 0; i < 7; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const randomByte = (seed ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
    const idx = randomByte % M_CODE_CHARSET.length
    randPart += M_CODE_CHARSET[idx]
  }
  return `${safePrefix}${randPart}`
}

// 新增（2026-09-16）：机构代码前缀归一化 —— 取机构邀请码前 4 位作为课程码前缀。
function buildOrgCodePrefix(invitationCode = '') {
  const rawCode = String(invitationCode || '').trim().toUpperCase()
  if (!rawCode) {
    return ''
  }
  return rawCode.slice(0, 4)
}

// 新增（2026-09-16）：机构序号格式化 —— 从 0001 开始左补 0，总长恒 8 位。
function formatOrgMCodeSeq(seq = 1, orgPrefix = '') {
  const seqWidth = Math.max(1, 8 - String(orgPrefix || '').length - 1)
  const safeSeq = Number(seq)
  const base = Number.isFinite(safeSeq) && safeSeq >= 1 ? Math.floor(safeSeq) : 1
  const maxSeq = Math.pow(10, seqWidth) - 1
  return String(((base - 1) % maxSeq) + 1).padStart(seqWidth, '0')
}

// ---------------------------------------------------------------------------
// 接取码工具（旧 12 位随机码制）
// ---------------------------------------------------------------------------

const { PICKUP_CONFIRM_CODE_LENGTH, PICKUP_FULL_CODE_LENGTH, PICKUP_FULL_CODE_LENGTH_ORG, PICKUP_FINAL_CODE_SUFFIX } = require('./_constants')

// 新增：构造 4 位「接取确认码」。
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

// 新增：完整「接取码」标准化（去非字母数字、转大写、限制长度 12/13）。
function normalizePickupFullCode(rawCode = '') {
  const cleaned = String(rawCode || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  if (cleaned.length !== PICKUP_FULL_CODE_LENGTH && cleaned.length !== PICKUP_FULL_CODE_LENGTH_ORG) {
    return ''
  }
  return cleaned
}

// 新增：从完整接取码中拆出「课程码」 + 「4 位确认码」。
function splitPickupFullCode(fullCode = '') {
  const safeCode = normalizePickupFullCode(fullCode)
  if (!safeCode) {
    return { courseCode: '', confirmCode: '' }
  }
  const courseLength = safeCode.length === PICKUP_FULL_CODE_LENGTH_ORG ? 9 : 8
  return {
    courseCode: safeCode.slice(0, courseLength),
    confirmCode: safeCode.slice(courseLength)
  }
}

// 新增：拼接完整接取码（课程码 + 4 位确认码）。
function buildPickupFullCode(courseCode = '', confirmCode = '') {
  const safeCourse = String(courseCode || '').replace(/[^a-zA-Z0-9]/g, '')
  const safeConfirm = String(confirmCode || '').toUpperCase().replace(/[^a-zA-Z0-9]/g, '').slice(0, PICKUP_CONFIRM_CODE_LENGTH)
  if ((safeCourse.length !== 8 && safeCourse.length !== 9) || safeConfirm.length !== PICKUP_CONFIRM_CODE_LENGTH) {
    return ''
  }
  return `${safeCourse}${safeConfirm}`
}

// 新增：执行教练确认接取后的展示码（完整接取码 + DL）。
function buildPickupFinalCode(fullCode = '') {
  const safeFullCode = String(fullCode || '').replace(/[^a-zA-Z0-9]/g, '')
  if (safeFullCode.length !== PICKUP_FULL_CODE_LENGTH && safeFullCode.length !== PICKUP_FULL_CODE_LENGTH_ORG) {
    return ''
  }
  return `${safeFullCode}${PICKUP_FINAL_CODE_SUFFIX}`
}

// ---------------------------------------------------------------------------
// 来源 / 回抄判定 / 摘要
// ---------------------------------------------------------------------------

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
      fulfill_state: readCourseState(order, ''),
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

// ---------------------------------------------------------------------------
// 表单分组（buildGroupedOrderPayload）
// ---------------------------------------------------------------------------

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
    order_base_info: {
      acceptorId: orderBaseInfo.acceptorId || submitForm.acceptorId || '',
      acceptorOpenid: orderBaseInfo.acceptorOpenid || submitForm.acceptorOpenid || '',
      publisher_Id: orderBaseInfo.publisher_Id || submitForm.publisher_Id || '',
      publisher_openid: orderBaseInfo.publisher_openid || submitForm.publisher_openid || '',
      create_time: orderBaseInfo.create_time || submitForm.create_time || ''
    },
    child_profile: {
      nickname: childProfile.nickname || submitForm.child_nickname || '',
      age: childProfile.age || submitForm.child_age || '',
      gender: childProfile.gender || submitForm.child_gender || '',
      height: childProfile.height || submitForm.child_height || '',
      weight: childProfile.weight || submitForm.child_weight || ''
    },
    teaching_record: {
      category: teachingRecord.category || courseTarget.category || submitForm.category || '',
      title: teachingRecord.title || courseTarget.title || submitForm.title || '',
      description: teachingRecord.description || courseTarget.description || submitForm.description || '',
      course_plan: teachingRecord.course_plan || courseTarget.course_plan || submitForm.course_plan || ''
    },
    course_config: {
      class_count: courseConfig.class_count || submitForm.class_count || 1,
      frequency: courseConfig.frequency || courseBasic.frequency || submitForm.frequency || '',
      course_size_mode: courseConfig.course_size_mode || courseBasic.course_size_mode || submitForm.course_size_mode || '1对1'
    },
    coach_private: {
      price_interval: coachPrivate.price_interval || submitForm.price_interval || '',
      coach_private_note: coachPrivate.coach_private_note || submitForm.coach_private_note || ''
    },
    course_basic_info: {
      safety_confirmed: courseBasicInfo.safety_confirmed !== undefined ? !!courseBasicInfo.safety_confirmed : !!courseBasic.safety_confirmed || !!submitForm.safety_confirmed,
      location: courseBasicInfo.location || courseBasic.location || submitForm.location || '',
      contact: normalizePhone(courseBasicInfo.contact || courseBasic.contact || submitForm.contact || ''),
      latitude: courseBasicInfo.latitude !== undefined ? courseBasicInfo.latitude : (submitForm.latitude !== undefined ? submitForm.latitude : null),
      longitude: courseBasicInfo.longitude !== undefined ? courseBasicInfo.longitude : (submitForm.longitude !== undefined ? submitForm.longitude : null)
    },
    course_flow_info: {
      allow_transfer_to_other_coach: courseFlowInfo.allow_transfer_to_other_coach !== undefined ? !!courseFlowInfo.allow_transfer_to_other_coach : !!coachPrivate.allow_transfer_to_other_coach || !!submitForm.allow_transfer_to_other_coach,
      publish_type: courseFlowInfo.publish_type || submitForm.publish_type || '',
      publish_state: courseFlowInfo.publish_state || submitForm.publish_state || '',
      fulfill_state: pickState(courseFlowInfo.fulfill_state, submitForm.fulfill_state, ''),
      progress_total: courseFlowInfo.progress_total || submitForm.progress_total || 0,
      progress_done: courseFlowInfo.progress_done || submitForm.progress_done || 0,
      schedule: Array.isArray(courseFlowInfo.schedule) ? courseFlowInfo.schedule : (Array.isArray(submitForm.schedule) ? submitForm.schedule : []),
      history_sync: courseFlowInfo.history_sync || submitForm.history_sync || null
    },
    share_visibility: {
      entry_logs: Array.isArray(shareVisibility.entry_logs) ? shareVisibility.entry_logs : (Array.isArray(submitForm.entry_logs) ? submitForm.entry_logs : [])
    },
    order_org_info: orderOrgInfo,
    other_info: {
      userInfo: otherInfo.userInfo || submitForm.userInfo || {},
      publisherInfo: otherInfo.publisherInfo || submitForm.publisherInfo || {},
      usertoken: otherInfo.usertoken || submitForm.usertoken || '',
      group_rules: otherInfo.group_rules || submitForm.group_rules || '',
      imported_target_snapshot: otherInfo.imported_target_snapshot || submitForm.imported_target_snapshot || null,
      linked_collaboration_meta: otherInfo.linked_collaboration_meta || submitForm.linked_collaboration_meta || null,
      imported_parent_name: otherInfo.imported_parent_name || submitForm.imported_parent_name || '',
      imported_phone: otherInfo.imported_phone || submitForm.imported_phone || ''
    }
  }
}

// ---------------------------------------------------------------------------
// 订单投影 helper（纯读）
// ---------------------------------------------------------------------------

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

// 新增课节完成判断：发布页只把「总结内容 + 上课日期」同时存在的课节视为已记录完成
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

// ---------------------------------------------------------------------------
// B 侧导入表单 / 评分归一化
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 订单归一化（normalizeOrderForClient）
// ---------------------------------------------------------------------------

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
    fulfill_state: readCourseState(order, ''),
    progress_total: courseFlowInfo.progress_total || order.progress_total || 0,
    progress_done: courseFlowInfo.progress_done || order.progress_done || 0,
    schedule: Array.isArray(courseFlowInfo.schedule) ? courseFlowInfo.schedule : (Array.isArray(order.schedule) ? order.schedule : []),
    history_sync: courseFlowInfo.history_sync || order.history_sync || null,
    source: getOrderSource(order),
    bridge_status: order.bridge_status || '',
    from_b_form_id: order.from_b_form_id || '',
    from_b_course_id: order.from_b_course_id || '',
    from_b_openid: order.from_b_openid || '',
    joinCode: order.joinCode || '',
    courseCode: order.courseCode || '',
    parent_course_code: order.parent_course_code || order.joinCode || order.courseCode || '',
    state_history: getStateHistory(order),
    currentStateSuffix: resolveCurrentStateSuffix(order),
    coach_binding_requests: getCoachBindingRequests(order),
    pickupConfirmCode: order.pickup_confirm_code || order.pickupConfirmCode || '',
    pickupFullCode: (() => {
      const history = getStateHistory(order)
      if (history.length) {
        const suffix = resolveCurrentStateSuffix(order)
        if (suffix) {
          const baseCourse = String(order.courseCode || order.joinCode || order.parent_course_code || '').trim()
          const built = buildStatePickupCode(baseCourse, suffix)
          if (built) return built
        }
      }
      return order.pickup_full_code || order.pickupFullCode || ''
    })(),
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

// ---------------------------------------------------------------------------
// coach_binding_requests 读 helper
// ---------------------------------------------------------------------------

// 新增：取订单的 coach_binding_requests[]（顶层优先，回退到 course_flow_info 内层）
function getCoachBindingRequests(order = {}) {
  const top = Array.isArray(order[COACH_BINDING_REQUESTS_FIELD]) ? order[COACH_BINDING_REQUESTS_FIELD] : null
  if (top && top.length) return top
  const flow = order.course_flow_info || {}
  const inner = Array.isArray(flow[COACH_BINDING_REQUESTS_FIELD]) ? flow[COACH_BINDING_REQUESTS_FIELD] : null
  return inner && inner.length ? inner : []
}

// 新增：在 coach_binding_requests[] 里找「当前这个人」那条 pending 申请。
function findMyPendingBindingRequest(order = {}, coachOpenid, coachUserId) {
  const safeOpenid = String(coachOpenid || '').trim()
  const safeUserId = String(coachUserId || '').trim()
  if (!safeOpenid && !safeUserId) return null
  return getCoachBindingRequests(order).find((r) => {
    const rOpenid = String((r && r.coachOpenid) || '').trim()
    const rUserId = String((r && r.coachUserId) || '').trim()
    const rStatus = String((r && r.status) || '').trim()
    if (rStatus !== COACH_BINDING_STATUS_PENDING) return false
    if (rOpenid && safeOpenid && rOpenid === safeOpenid) return true
    if (rUserId && safeUserId && rUserId === safeUserId) return true
    return false
  }) || null
}

// ---------------------------------------------------------------------------
// 权限判断（纯函数）
// ---------------------------------------------------------------------------

function isParticipant(order, openid, userId) {
  if (isPublisher(order, openid, userId)) return true
  if (isAcceptor(order, openid, userId)) return true
  return false
}

function isPublisher(order, openid, userId) {
  // 【2026-09-21 修复·空串绕过】两侧值都必须非空才允许判定为相等。
  const pubOpenid = String(getPublisherOpenid(order) || '').trim()
  const pubUserId = String(getPublisherId(order) || '').trim()
  const safeOpenid = String(openid || '').trim()
  const safeUserId = String(userId || '').trim()
  if (pubOpenid && safeOpenid && pubOpenid === safeOpenid) return true
  if (pubUserId && safeUserId && pubUserId === safeUserId) return true
  return false
}

function isAcceptor(order, openid, userId) {
  // 【2026-09-21 修复·空串绕过】同 isPublisher 同根问题。
  const accOpenid = String(getAcceptorOpenid(order) || '').trim()
  const accUserId = String(getAcceptorId(order) || '').trim()
  const safeOpenid = String(openid || '').trim()
  const safeUserId = String(userId || '').trim()
  if (accOpenid && safeOpenid && accOpenid === safeOpenid) return true
  if (accUserId && safeUserId && accUserId === safeUserId) return true
  return false
}

module.exports = {
  normalizePhone,
  isValidPhone,
  normalizeOrderOrganizationInfo,
  normalizeInviteCode,
  normalizeCourseCode,
  normalizeParentCourseCode,
  buildCourseCodeVariants,
  buildStatePickupCode,
  splitStatePickupCode,
  getStateHistory,
  resolveCurrentStateSuffix,
  buildMCandidate,
  buildOrgCodePrefix,
  formatOrgMCodeSeq,
  buildPickupConfirmCode,
  normalizePickupFullCode,
  splitPickupFullCode,
  buildPickupFullCode,
  buildPickupFinalCode,
  getOrderSource,
  shouldSyncResultToB,
  getRecordedLessonSummary,
  buildCoachResultSyncPayload,
  buildGroupedOrderPayload,
  getOrderBaseInfo,
  getChildProfile,
  getTeachingRecord,
  getCourseConfig,
  getCourseBasicInfo,
  getCoachPrivate,
  getOrderOrganizationInfo,
  getCourseFlowInfo,
  isLessonRecorded,
  hasLessonPlanConfigured,
  getShareVisibility,
  getOtherInfo,
  getPublisherOpenid,
  getPublisherId,
  getAcceptorOpenid,
  getAcceptorId,
  normalizeImportedChildProfiles,
  buildImportedSubmitForm,
  currentSafeNumber,
  normalizeLessonRating,
  normalizeLessonRatingTags,
  normalizeLessonDimensionRatings,
  normalizeOrderForClient,
  getCoachBindingRequests,
  findMyPendingBindingRequest,
  isParticipant,
  isPublisher,
  isAcceptor
}
