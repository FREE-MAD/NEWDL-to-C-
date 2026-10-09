// 云函数业务入口（开发版 D_ 目录）。
// ai不可以操作 T_ 目录（正式版），只可以操作 D_ 目录（开发版）
// 唯一操作途径是通过 sync-dev-to-true.js 把 D_ 目录镜像复制到 T_ 目录
// ai不允许执行迁移
// 这个注释绝对不允许删除
//
// 说明（2026-10-09 拆模块 + 拆双函数）：
//   1. 原 3883 行单文件按依赖域拆成 _constants/_common/_db/_sync/_state/_lesson 六个模块，
//      本文件只保留 exports.main（入口）+ routeTable（路由表）+ 订单 CRUD（getOneOrder/getOrderByCourseCode/listMyself/
//      publishOrder/updateOrder）。所有状态推进走 _state（内部经 _shared/courseState 的 applyCourseStateTransition）。
//   2. 拆双函数后本目录为 D_ 版（开发环境），T_ 版由 sync-dev-to-true.js 复制生成、只读。
const { initRuntime, runInContext } = require('./_shared/runtime')
const { normalizeRequestEvent } = require('./_shared/request')
const { make: makeLogger } = require('./_shared/logger')
const courseState = require('./_shared/courseState')
const { COURSE_STATE, INITIAL_COURSE_STATE } = courseState
const {
  ACTION_SYNC_PARENT_BOOKING_TO_A,
  ORDER_COLLECTION_BASE,
  COACH_BINDING_REQUESTS_FIELD,
  COACH_BINDING_STATUS_PENDING,
  M_CODE_PREFIX_FROM_A,
  SOURCE_FROM_A_DIRECT
} = require('./_constants')
const {
  isValidPhone,
  buildGroupedOrderPayload,
  normalizeOrderOrganizationInfo,
  getOrderOrganizationInfo,
  getOrderBaseInfo,
  getCourseFlowInfo,
  getCourseConfig,
  getShareVisibility,
  getOtherInfo,
  normalizeCourseCode,
  buildCourseCodeVariants,
  normalizeOrderForClient,
  getPublisherOpenid,
  getAcceptorOpenid,
  findMyPendingBindingRequest,
  isPublisher
} = require('./_common')
const {
  db,
  _,
  getCollectionName,
  generateUniqueMCode,
  ensureOrganizationPublishPermission,
  appendOrderIdToOrganizationClass,
  findOrder
} = require('./_db')
const { syncParentBookingToA } = require('./_sync')
const state = require('./_state')
const lesson = require('./_lesson')

/**
 * execution_order: 课程执行核心入口
 */
exports.main = async (event, context) => {
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

  const $event = parsed.event;
  const ctx = initRuntime($event)

  return await runInContext(ctx, async () => {
  const openid = ctx.openid
  const userId = $event.userId

  if (!openid) {
    return { code: 401, msg: '未登录' }
  }

  makeLogger(ctx).runtimeEnv({
    action: action || '',
    orderId: orderId || '',
    hasOpenid: !!openid
  })

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
    'update_lesson_content',
    'add_lesson',
    'sync_lesson_progress',
    'add_entry_log',
    'assign_coach_by_pickup_code',
    'confirm_generate_pickup_code',
    'reset_pickup_confirm_code',
    'mark_course_info_ready',
    'request_coach_binding',
    'confirm_coach_binding',
    'reject_coach_binding'
  ];

  try {
    let matchedResult = null;
    const handler = routeTable[action];
    if (typeof handler === 'function') {
      console.log(`[router] matched action: ${action}`);
      matchedResult = await handler({ action, orderId, openid, userId, event: $event });
    } else {
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
  }) // ← runInContext 包裹结束
};

// 业务动作映射表：handler 返回结构 { code, msg, data, debug? }。
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
    return { code: 403, msg: '旧课程状态链路已下线' };
  },
  lesson_handshake: async ({ orderId }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return { code: 403, msg: '旧课节状态链路已下线' };
  },
  complete: async ({ orderId }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return { code: 403, msg: '旧完成状态链路已下线，请使用结课入口' };
  },
  cancel: async ({ orderId, openid, userId, event }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await state.cancelOrder(orderId, openid, userId, event.reason);
  },
  close: async ({ orderId, openid, userId, event }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await state.closeOrder(orderId, openid, userId, event.closeSummary, event.closeCoachNote);
  },
  list_myself: async ({ openid, userId, event }) => {
    return await listMyself(openid, userId, event.page || 1, event.limit || 20);
  },
  publish: async ({ openid, userId, event }) => {
    return await publishOrder(event.submitForm, openid, userId);
  },
  [ACTION_SYNC_PARENT_BOOKING_TO_A]: async ({ openid, userId, event }) => {
    return await syncParentBookingToA(event, openid, userId);
  },
  update_order: async ({ orderId, openid, userId, event }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await updateOrder(orderId, event.submitForm, openid, userId);
  },
  update_lesson_content: async ({ orderId, openid, userId, event }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await lesson.updateLessonContent(orderId, openid, userId, event.lessonIndex, event.content);
  },
  add_lesson: async ({ orderId }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return { code: 403, msg: '旧课节追加入口已下线' };
  },
  sync_lesson_progress: async ({ orderId, openid, userId, event }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await lesson.syncLessonProgress(orderId, openid, userId, event.totalLessons, event.startLesson, event.historyCount);
  },
  add_entry_log: async ({ orderId, openid, userId, event }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await lesson.addEntryLog(orderId, openid, userId, event);
  },
  assign_coach_by_pickup_code: async ({ openid, userId, event }) => {
    return await state.assignCoachByPickupCode(event.pickupFullCode, openid, userId, event.coachName || '');
  },
  confirm_generate_pickup_code: async ({ orderId, openid, userId }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await state.confirmGeneratePickupCode(orderId, openid, userId);
  },
  reset_pickup_confirm_code: async ({ orderId, openid, userId, event }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await state.resetPickupConfirmCode(orderId, openid, userId, !!(event && event.keepCoach));
  },
  mark_course_info_ready: async ({ orderId, openid, userId }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await state.markCourseInfoReady(orderId, openid, userId);
  },
  request_coach_binding: async ({ openid, userId, event }) => {
    return await state.requestCoachBinding(event.pickupFullCode, openid, userId, event.coachName || '');
  },
  confirm_coach_binding: async ({ orderId, openid, userId, event }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await state.confirmCoachBinding(orderId, event.requestId, openid, userId);
  },
  reject_coach_binding: async ({ orderId, openid, userId, event }) => {
    if (!orderId) return { code: 1, msg: '缺少订单ID' };
    return await state.rejectCoachBinding(orderId, event.requestId, openid, userId, event.reason || '');
  }
};

// 获取单个订单详情
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
    caller: {
      openid: openid,
      isJoined: isJoined
    }
  }
}

// 新增协作课程码查询
async function getOrderByCourseCode(courseCode) {
  const safeCourseCode = normalizeCourseCode(courseCode)
  if (!safeCourseCode) {
    return { code: 1, msg: '请输入课程码' }
  }

  const targetCollection = getCollectionName(ORDER_COLLECTION_BASE)
  const codeVariants = buildCourseCodeVariants(safeCourseCode)
  const candidateFields = ['from_b_course_id', 'courseCode', 'joinCode', 'parent_course_code']
  let matchedOrder = null
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

// 我的课程列表
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

  const tasks = collections.map(c =>
    db.collection(c).where(query).orderBy('createdAt', 'desc').limit(50).get().catch(() => ({ data: [] }))
  )

  const results = await Promise.all(tasks)
  let allOrders = []
  results.forEach(r => { allOrders = allOrders.concat(r.data) })

  const safeOpenid = String(openid || '').trim()
  const safeUserId = String(userId || '').trim()
  try {
    const pendingClauses = []
    if (safeOpenid) {
      pendingClauses.push({ [COACH_BINDING_REQUESTS_FIELD]: _.elemMatch({ coachOpenid: safeOpenid, status: COACH_BINDING_STATUS_PENDING }) })
    }
    if (safeUserId) {
      pendingClauses.push({ [COACH_BINDING_REQUESTS_FIELD]: _.elemMatch({ coachUserId: safeUserId, status: COACH_BINDING_STATUS_PENDING }) })
    }
    if (pendingClauses.length) {
      const pendingWhere = pendingClauses.length > 1 ? _.or(pendingClauses) : pendingClauses[0]
      const pendingResults = await Promise.all(collections.map(c =>
        db.collection(c).where(pendingWhere).orderBy('createdAt', 'desc').limit(50).get().catch(() => ({ data: [] }))
      ))
      pendingResults.forEach(r => { if (Array.isArray(r.data)) allOrders = allOrders.concat(r.data) })
    }
  } catch (err) {
    console.warn('[list_myself] 待确认申请查询跳过（不影响主列表）:', err && err.message)
  }

  const uniqueOrders = new Map();
  for (const order of allOrders) {
    if (!uniqueOrders.has(order._id)) {
      uniqueOrders.set(order._id, order);
    }
  }
  allOrders = Array.from(uniqueOrders.values());

  allOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  const start = (page - 1) * limit
  const pagedData = allOrders.slice(start, start + limit)

  return {
    code: 0,
    data: pagedData.map(item => {
      const normalized = normalizeOrderForClient(item)
      const myPending = findMyPendingBindingRequest(item, safeOpenid, safeUserId)
      if (!myPending) return normalized
      return { ...normalized, hasMyPendingRequest: true, myPendingRequest: myPending }
    })
  }
}

// 发布订单
async function publishOrder(submitForm, openid, userId) {
  if (!submitForm) return { code: 1, msg: '提交数据为空' }

  const publishType = (submitForm.publish_type || '').trim()
  if (publishType !== '发布看看') {
    return { code: 1, msg: '当前仅支持发布看看' }
  }
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
    fulfill_state: INITIAL_COURSE_STATE,
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
    orgId: orderOrgInfo.orgId || '',
    orgName: orderOrgInfo.orgName || '',
    orgMemberRole: orderOrgInfo.memberRole || '',
    source: String(submitForm.source || '').trim() || SOURCE_FROM_A_DIRECT,
    bridge_status: String(submitForm.bridge_status || '').trim() || '',
    from_b_form_id: String(submitForm.from_b_form_id || '').trim(),
    from_b_course_id: String(submitForm.from_b_course_id || '').trim(),
    from_b_openid: String(submitForm.from_b_openid || '').trim(),
    joinCode: uniqueMCode,
    courseCode: uniqueMCode,
    parent_course_code: uniqueMCode,
    pickup_confirm_code: '',
    pickup_full_code: '',
    pickup_final_code: '',
    assignedCoachToken: '',
    assignedCoachOpenid: '',
    assignedCoachName: '',
    assignedCoachAt: null,
    fulfill_state: INITIAL_COURSE_STATE,
    createdAt: now,
    updatedAt: now
  }

  const res = await db.collection(targetCollection).add({ data })
  const newOrderId = res._id;
  console.log('订单创建成功:', newOrderId, ' M 码(fromA):', uniqueMCode, ' 接取码(新流程下 publish 不生成):', '');

  await appendOrderIdToOrganizationClass(
    orderOrgInfo,
    newOrderId,
    organizationPermission && organizationPermission.organizationDoc
  )

  return {
    code: 0,
    msg: '发布成功',
    orderId: newOrderId,
    joinCode: uniqueMCode,
    courseCode: uniqueMCode,
    parent_course_code: uniqueMCode,
    pickupFullCode: '',
    pickupConfirmCode: '',
    pickupFinalCode: '',
    state_history: [],
    fulfill_state: COURSE_STATE.EDITING,
    courseInfoReady: false
  }
}

// 新增修改订单
async function updateOrder(orderId, submitForm, openid, userId) {
  if (!submitForm) return { code: 1, msg: '提交数据为空' }

  const { data, ref } = await findOrder(orderId)
  if (!data || !ref) return { code: 404, msg: '订单不存在' }

  if (!isPublisher(data, openid, userId)) {
    return { code: 403, msg: '无权修改' }
  }
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
