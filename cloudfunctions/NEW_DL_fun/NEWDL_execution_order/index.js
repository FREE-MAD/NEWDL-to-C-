
const cloud = require('wx-server-sdk')
cloud.init({ env: 'cloud1-6gh7jgl8c5b16a83' });

const db = cloud.database()
const _ = db.command
// 新增集合前缀规则：develop 使用 NDLdev_，trial/release 使用 NDLreal_
const ORDER_COLLECTION_BASE = 'execution_orders'
let CURRENT_ENV_VERSION = 'develop'

function getCollectionPrefix() {
  return CURRENT_ENV_VERSION === 'develop' ? 'NDLdev_' : 'NDLreal_'
}

function getCollectionName(baseName) {
  return `${getCollectionPrefix()}${baseName}`
}

function normalizeCollectionName(collectionName) {
  if (!collectionName) return ''
  if (collectionName.startsWith('NDLdev_') || collectionName.startsWith('NDLreal_')) {
    return collectionName
  }
  return getCollectionName(collectionName)
}

// 新增手机号标准化：课程联系方式统一收口成 11 位纯数字，避免空格和分隔符污染订单数据
function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').slice(0, 11)
}

// 新增手机号格式校验：发布班课程时只接受中国大陆 11 位手机号
function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(normalizePhone(phone))
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
    // 新增其他信息大类：暂存与业务展示无直接关系的杂项
    other_info: {
      userInfo: otherInfo.userInfo || submitForm.userInfo || {},
      publisherInfo: otherInfo.publisherInfo || submitForm.publisherInfo || {},
      usertoken: otherInfo.usertoken || submitForm.usertoken || '',
      group_rules: otherInfo.group_rules || submitForm.group_rules || ''
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
exports.main = async (event, context) => {
  const { action, orderId } = event
  // 新增环境版本识别：由前端透传 develop/trial/release
  CURRENT_ENV_VERSION = event.envVersion || 'develop'
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  // userId 应该由前端传递，或者通过 openid 查找用户表获取 (这里沿用前端传 userId 的模式，或者自查)
  const userId = event.userId 

  if (!openid) {
    return { code: 401, msg: '未登录' }
  }

  console.log(`[execution_order] Action: ${action}, OrderId: ${orderId}, Openid: ${openid}`)

  try {
    switch (action) {
      case 'get_oneorder':
        if (!orderId) return { code: 1, msg: '缺少订单ID' }
        return await getOneOrder(orderId, openid)

      case 'start':
        if (!orderId) return { code: 1, msg: '缺少订单ID' }
        // 旧课程开始状态链路保留注释，不删除；当前已不再开放 start 入口
        // return await startOrder(orderId, openid, userId)
        return { code: 403, msg: '旧课程状态链路已下线' }

      case 'lesson_handshake':
        if (!orderId) return { code: 1, msg: '缺少订单ID' }
        // 旧课节握手状态链路保留注释，不删除；当前已不再开放 lesson_handshake 入口
        // return await lessonHandshake(orderId, openid, userId, event.lessonIndex, event.subAction)
        return { code: 403, msg: '旧课节状态链路已下线' }

      case 'complete':
         // 手动完成整个订单 (通常由握手自动触发，但也提供手动接口)
         if (!orderId) return { code: 1, msg: '缺少订单ID' }
         // 旧整单完成状态链路保留注释，不删除；当前关闭课程请使用 close
         // return await completeOrder(orderId, openid, userId)
         return { code: 403, msg: '旧完成状态链路已下线，请使用结课入口' }

      case 'cancel':
         if (!orderId) return { code: 1, msg: '缺少订单ID' }
         return await cancelOrder(orderId, openid, userId, event.reason)

      case 'close':
         // 新增结课入口：将课程状态直接切到 closed，并保存结语与教练备注
         if (!orderId) return { code: 1, msg: '缺少订单ID' }
         return await closeOrder(orderId, openid, userId, event.closeSummary, event.closeCoachNote)

      case 'list_myself':
         return await listMyself(openid, userId, event.page || 1, event.limit || 20)

      case 'publish':
         return await publishOrder(event.submitForm, openid, userId)

      case 'update_order':
         if (!orderId) return { code: 1, msg: '缺少订单ID' }
         return await updateOrder(orderId, event.submitForm, openid, userId)

      case 'admin_list_all':
         return await listAllAdmin(event.page || 1, event.limit || 20)

      case 'admin_logs':
         return await listLogs(event.page || 1, event.limit || 20)

      case 'admin_get_detail':
         if (!event.id || !event.collection) return { code: 1, msg: '缺少参数' }
         return await adminGetDetail(event.id, event.collection)

      case 'admin_add_log':
         return await addLog(event.level, event.message, event.details)

      case 'update_lesson_content':
         if (!orderId) return { code: 1, msg: '缺少订单ID' }
         return await updateLessonContent(orderId, openid, userId, event.lessonIndex, event.content)

      case 'add_lesson':
         if (!orderId) return { code: 1, msg: '缺少订单ID' }
         // 旧手动补加课节入口保留注释，不删除；当前改为通过“总课时 / 半途接入”统一维护，记录满 3 节后锁定，不再支持这里单独追加
         // return await addLesson(orderId, openid)
         return { code: 403, msg: '旧课节追加入口已下线' }

      case 'sync_lesson_progress':
         if (!orderId) return { code: 1, msg: '缺少订单ID' }
         return await syncLessonProgress(orderId, openid, userId, event.totalLessons, event.startLesson, event.historyCount)

      case 'add_entry_log':
         if (!orderId) return { code: 1, msg: '缺少订单ID' }
         return await addEntryLog(orderId, openid, userId, event)

      default:
        return { code: 404, msg: '未知操作' }
    }
  } catch (err) {
    console.error('[execution_order] Error:', err)
    return { code: 500, msg: '服务器错误', error: err }
  }
}

// ================= 业务逻辑函数 =================

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
  
  await ref.update({
      data: {
          order_base_info: {
            ...getOrderBaseInfo(data),
            updatedAt: new Date()
          },
          course_flow_info: {
            ...courseFlowInfo,
            schedule
          },
          updatedAt: new Date()
      }
  })

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

  await ref.update({
    data: {
      order_base_info: {
        ...getOrderBaseInfo(data),
        updatedAt: new Date()
      },
      course_flow_info: {
        ...getCourseFlowInfo(data),
        fulfill_state: 'completed',
        completedAt: new Date()
      },
      updatedAt: new Date()
    }
  })
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

   await ref.update({
     data: {
       order_base_info: {
         ...getOrderBaseInfo(data),
         updatedAt: new Date()
       },
       course_flow_info: {
         ...getCourseFlowInfo(data),
         fulfill_state: 'cancelled',
         publish_state: 'closed',
         cancelledAt: new Date(),
         cancelReason: reason || '无'
       },
       updatedAt: new Date()
     }
   })
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

  await ref.update({
    data: {
      order_base_info: {
        ...getOrderBaseInfo(data),
        updatedAt: new Date()
      },
      course_flow_info: {
        ...getCourseFlowInfo(data),
        fulfill_state: 'closed',
        publish_state: 'closed',
        closedAt: new Date(),
        // 新增结课页字段：结语和教练备注随结课动作一起落库
        close_summary: closeSummary || '',
        close_coach_note: closeCoachNote || ''
      },
      updatedAt: new Date()
    }
  })

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
  await ref.update({
    data: {
      order_base_info: {
        ...getOrderBaseInfo(data),
        updatedAt: new Date()
      },
      // 兼容旧订单里 history_sync 为 null 的情况：这里必须用 _.set 整块替换 course_flow_info，避免 update 深层写入 history_sync.startLesson 时报错
      course_flow_info: _.set(nextCourseFlowInfo),
      updatedAt: new Date()
    }
  })

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
  const targetCollection = getCollectionName(ORDER_COLLECTION_BASE)
  const publishState = 'direct'
  
  const userInfo = submitForm.userInfo || { nickName: '发布者', avatarUrl: '' };
  const now = new Date();
  const classCount = submitForm.class_count || 1;
  const schedule = [];
  for (let lessonNum = 1; lessonNum <= classCount; lessonNum += 1) {
    schedule.push({
      lesson: lessonNum,
      logs: []
    })
  }
  const groupedPayload = buildGroupedOrderPayload(submitForm)
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
    fulfill_state: 'pending',
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
    order_base_info: orderBaseInfo,
    course_config: courseConfig,
    course_flow_info: courseFlowInfo,
    share_visibility: shareVisibility,
    other_info: otherInfo,
    createdAt: now,
    updatedAt: now
  }
  
  const res = await db.collection(targetCollection).add({ data })
  const newOrderId = res._id;
  console.log('订单创建成功:', newOrderId);

  return { code: 0, msg: '发布成功', orderId: newOrderId }
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
