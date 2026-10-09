/**
 * _state.js —— 订单域课程生命周期状态推进
 *
 * 从 dev_index.js 抽出的「会推 fulfill_state / 写 assignedCoach* / coach_binding_requests」的函数。
 * 所有状态推进都经 _shared/courseState 的 applyCourseStateTransition（唯一写入口）。
 * 依赖 _constants / _common / _db / _sync / courseState。
 */

const courseState = require('./_shared/courseState')
const {
  COURSE_STATE,
  isTerminalState,
  readCourseState,
  terminalBlockedMessage,
  appendStateSuffix,
  ACTOR_ROLE,
  applyCourseStateTransition
} = courseState
const {
  STATE_SUFFIX_PENDING_LESSON,
  STATE_SUFFIX_IN_PROGRESS,
  STATE_SUFFIX_DONE_LESSON,
  STATE_HISTORY_FIELD,
  COACH_BINDING_REQUESTS_FIELD,
  COACH_BINDING_STATUS_PENDING,
  COACH_BINDING_STATUS_CONFIRMED,
  COACH_BINDING_STATUS_REJECTED,
  ORDER_COLLECTION_BASE,
  USER_COLLECTION_BASE
} = require('./_constants')
const {
  buildStatePickupCode,
  splitStatePickupCode,
  splitPickupFullCode,
  normalizePickupFullCode,
  buildPickupFullCode,
  buildPickupFinalCode,
  buildPickupConfirmCode,
  buildCourseCodeVariants,
  getCoachBindingRequests,
  getCourseFlowInfo,
  getPublisherOpenid,
  getPublisherId,
  getOrderBaseInfo,
  normalizePhone,
  isValidPhone,
  isPublisher,
  isParticipant,
  isAcceptor,
  getStateHistory
} = require('./_common')
const {
  db,
  _,
  getCollectionName,
  findOrder
} = require('./_db')
const { syncCoachResultToBIfNeeded } = require('./_sync')

// 新增：教练通过 12 位完整接取码认领课程。
async function assignCoachByPickupCode(rawPickupFullCode, coachOpenid, coachUserId, coachNickname = '') {
  if (!coachOpenid) {
    return { code: 401, msg: '未获取到教练身份，请重新登录后再试' }
  }

  let newStatePickup = splitStatePickupCode(rawPickupFullCode)
  let courseCode = ''
  let stateSuffix = ''
  let fullCode = ''
  let legacyConfirmCode = ''
  let isNewCodeSystem = false

  if (newStatePickup.courseCode && newStatePickup.stateSuffix) {
    courseCode = newStatePickup.courseCode
    stateSuffix = newStatePickup.stateSuffix
    fullCode = buildStatePickupCode(courseCode, stateSuffix)
    isNewCodeSystem = true
  } else {
    fullCode = normalizePickupFullCode(rawPickupFullCode)
    if (!fullCode) {
      return {
        code: 1,
        msg: '接取码格式不对，新码为 10 位英数字（8 位课程码 + 2 位状态后缀 pl/ip/dl，如 ABCD1234pl）；旧随机码为 12 位英数字（8 位班级码 + 4 位确认码），无需带空格或横杠'
      }
    }
    const legacySplit = splitPickupFullCode(fullCode)
    if (!legacySplit.courseCode || !legacySplit.confirmCode) {
      return { code: 1, msg: '接取码拆分失败，请检查输入' }
    }
    courseCode = legacySplit.courseCode
    legacyConfirmCode = legacySplit.confirmCode
  }

  const targetCollection = getCollectionName(ORDER_COLLECTION_BASE)
  let matchedOrder = null
  try {
    const courseCodeVariants = buildCourseCodeVariants(courseCode)
    const queryRes = await db.collection(targetCollection)
      .where(_.or(
        courseCodeVariants.flatMap((codeVariant) => ([
          { courseCode: codeVariant },
          { joinCode: codeVariant },
          { parent_course_code: codeVariant }
        ]))
      ))
      .limit(1)
      .get()
    matchedOrder = Array.isArray(queryRes.data) && queryRes.data.length ? queryRes.data[0] : null
  } catch (err) {
    console.error('[pickup] query order by courseCode failed:', err && err.message)
    return { code: 500, msg: '查询课程失败，请稍后重试' }
  }

  if (!matchedOrder) {
    return { code: 404, msg: '没有找到对应课程，请检查课程码部分是否正确' }
  }

  const fulfillState = readCourseState(matchedOrder, '')
  // 调整（2026-10-09 · 课程流转 T6-a，Q3 已定）：本入口原用 isClosedState（只挡 closed/cancelled），
  // 与其它入口的 isTerminalState（closed/cancelled/completed）口径不一致 —— 「已完成但未结课」的课程
  // 仍可被接取码直接认领并把状态打回 in_progress。现统一挡三个终态。
  if (isTerminalState(fulfillState)) {
    return { code: 403, msg: terminalBlockedMessage('无法再接取') }
  }

  if (isNewCodeSystem) {
    if (stateSuffix === STATE_SUFFIX_DONE_LESSON) {
      return { code: 403, msg: '该课程已结束，无法再接取' }
    }
    if (stateSuffix === STATE_SUFFIX_IN_PROGRESS) {
      // 交给下方 alreadyAssigned 判断给出更具体提示
    } else if (stateSuffix !== STATE_SUFFIX_PENDING_LESSON) {
      return { code: 1, msg: '接取码后缀不正确，新制接取码应为课程码 + pl（待接取态）' }
    }
  } else {
    const savedConfirmCode = String(matchedOrder.pickup_confirm_code || matchedOrder.pickupConfirmCode || '').trim()
    if (!savedConfirmCode || savedConfirmCode.toUpperCase() !== legacyConfirmCode) {
      return {
        code: 1,
        msg: '确认码不匹配，课程可能已经被发布者更换了新确认码，请向管理员索要最新的完整接取码'
      }
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
  const finalCourseCode = String(matchedOrder.courseCode || matchedOrder.joinCode || courseCode || '').trim()
  const newInProgressFullCode = isNewCodeSystem
    ? buildStatePickupCode(finalCourseCode, STATE_SUFFIX_IN_PROGRESS)
    : ''
  const pickupFinalCode = isNewCodeSystem
    ? newInProgressFullCode
    : buildPickupFinalCode(fullCode)
  const currentHistory = getStateHistory(matchedOrder)
  const nextHistory = appendStateSuffix(currentHistory, STATE_SUFFIX_IN_PROGRESS)
  try {
    await applyCourseStateTransition(null, matchedOrder._id, {
      to: COURSE_STATE.IN_PROGRESS,
      actor: { role: ACTOR_ROLE.COACH, userId: safeCoachUserId, openid: safeCoachOpenid },
      reason: 'assign_coach_by_pickup_code',
      extra: {
        assignedCoachToken: safeCoachUserId,
        assignedCoachOpenid: safeCoachOpenid,
        assignedCoachName: finalCoachName,
        assignedCoachAt: now,
        pickup_final_code: pickupFinalCode,
        ...(isNewCodeSystem ? { pickup_full_code: newInProgressFullCode } : {})
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
    confirmCode: legacyConfirmCode || '(new code system)',
    stateSuffix: isNewCodeSystem ? stateSuffix : '',
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
    pickupFullCode: isNewCodeSystem ? newInProgressFullCode : fullCode,
    pickupFinalCode,
    state_history: nextHistory,
    fulfill_state: COURSE_STATE.IN_PROGRESS,
    currentStateSuffix: isNewCodeSystem ? STATE_SUFFIX_IN_PROGRESS : '',
    coachName: finalCoachName,
    assignedAt: now,
    title: normalizedTitle,
    location: normalizedLocation
  }
}

// 新增：教练通过「课程码+pl」提交绑定申请（写 coach_binding_requests[]，不推状态）。
async function requestCoachBinding(rawPickupFullCode, coachOpenid, coachUserId, coachNickname = '') {
  if (!coachOpenid) {
    return { code: 401, msg: '未获取到教练身份，请重新登录后再试' }
  }

  const newStatePickup = splitStatePickupCode(rawPickupFullCode)
  let courseCode = ''
  let stateSuffix = ''
  let fullCode = ''
  let legacyConfirmCode = ''
  let isNewCodeSystem = false

  if (newStatePickup.courseCode && newStatePickup.stateSuffix) {
    courseCode = newStatePickup.courseCode
    stateSuffix = newStatePickup.stateSuffix
    fullCode = buildStatePickupCode(courseCode, stateSuffix)
    isNewCodeSystem = true
  } else {
    fullCode = normalizePickupFullCode(rawPickupFullCode)
    if (!fullCode) {
      return {
        code: 1,
        msg: '接取码格式不对，新码为 10 位英数字（8 位课程码 + 2 位状态后缀 pl/ip/dl，如 ABCD1234pl）；旧随机码为 12 位英数字（8 位班级码 + 4 位确认码），无需带空格或横杠'
      }
    }
    const legacySplit = splitPickupFullCode(fullCode)
    if (!legacySplit.courseCode || !legacySplit.confirmCode) {
      return { code: 1, msg: '接取码拆分失败，请检查输入' }
    }
    courseCode = legacySplit.courseCode
    legacyConfirmCode = legacySplit.confirmCode
  }

  const targetCollection = getCollectionName(ORDER_COLLECTION_BASE)
  let matchedOrder = null
  try {
    const courseCodeVariants = buildCourseCodeVariants(courseCode)
    const queryRes = await db.collection(targetCollection)
      .where(_.or(
        courseCodeVariants.flatMap((codeVariant) => ([
          { courseCode: codeVariant },
          { joinCode: codeVariant },
          { parent_course_code: codeVariant }
        ]))
      ))
      .limit(1)
      .get()
    matchedOrder = Array.isArray(queryRes.data) && queryRes.data.length ? queryRes.data[0] : null
  } catch (err) {
    console.error('[coach_binding_request] query order by courseCode failed:', err && err.message)
    return { code: 500, msg: '查询课程失败，请稍后重试' }
  }

  if (!matchedOrder) {
    return { code: 404, msg: '没有找到对应课程，请检查课程码部分是否正确' }
  }

  const fulfillState = readCourseState(matchedOrder, '')
  if (isTerminalState(fulfillState)) {
    return { code: 403, msg: '该课程已关闭，无法再接取' }
  }

  if (isNewCodeSystem) {
    if (stateSuffix === STATE_SUFFIX_DONE_LESSON) {
      return { code: 403, msg: '该课程已结束，无法再接取' }
    }
    if (stateSuffix === STATE_SUFFIX_IN_PROGRESS) {
      // 落到下方 alreadyAssigned 段统一返回更具体提示
    } else if (stateSuffix !== STATE_SUFFIX_PENDING_LESSON) {
      return { code: 1, msg: '接取码后缀不正确，新制接取码应为课程码 + pl（待接取态）' }
    }
  } else {
    const savedConfirmCode = String(matchedOrder.pickup_confirm_code || matchedOrder.pickupConfirmCode || '').trim()
    if (!savedConfirmCode || savedConfirmCode.toUpperCase() !== legacyConfirmCode) {
      return {
        code: 1,
        msg: '确认码不匹配，课程可能已经被发布者更换了新确认码，请向管理员索要最新的完整接取码'
      }
    }
  }

  const safeCoachUserId = String(coachUserId || '').trim()
  const safeCoachOpenid = String(coachOpenid || '').trim()

  const publisherOpenid = String(getPublisherOpenid(matchedOrder) || '').trim()
  const publisherUserId = String(getPublisherId(matchedOrder) || '').trim()
  const isSelfBind =
    (publisherOpenid && safeCoachOpenid && publisherOpenid === safeCoachOpenid) ||
    (publisherUserId && safeCoachUserId && publisherUserId === safeCoachUserId)
  if (isSelfBind) {
    return { code: 403, msg: '发布者不能接自己创建的课程，请让其他教练来接取' }
  }

  const savedCoachToken = String(matchedOrder.assignedCoachToken || matchedOrder.assigned_coach_token || '').trim()
  const savedCoachOpenid = String(matchedOrder.assignedCoachOpenid || matchedOrder.assigned_coach_openid || '').trim()
  const alreadyAssigned = !!savedCoachToken || !!savedCoachOpenid
  const assignedToMe =
    (savedCoachToken && safeCoachUserId && savedCoachToken === safeCoachUserId) ||
    (savedCoachOpenid && safeCoachOpenid && savedCoachOpenid === safeCoachOpenid)

  if (alreadyAssigned && assignedToMe) {
    return {
      code: 0,
      msg: '该课程已由你接取，无需重复申请',
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

  const existingRequests = getCoachBindingRequests(matchedOrder)
  const myPendingRequest = existingRequests.find((r) => {
    const rOpenid = String((r && r.coachOpenid) || '').trim()
    const rUserId = String((r && r.coachUserId) || '').trim()
    const rStatus = String((r && r.status) || '').trim()
    if (rStatus !== COACH_BINDING_STATUS_PENDING) return false
    if (rOpenid && safeCoachOpenid && rOpenid === safeCoachOpenid) return true
    if (rUserId && safeCoachUserId && rUserId === safeCoachUserId) return true
    return false
  })
  if (myPendingRequest) {
    return {
      code: 0,
      msg: '已提交过申请，等待管理者确认',
      pending: true,
      requestId: myPendingRequest.requestId,
      orderId: matchedOrder._id,
      joinCode: matchedOrder.joinCode || courseCode,
      courseCode: matchedOrder.courseCode || courseCode
    }
  }

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
      console.warn('[coach_binding_request] fallback read coach name failed:', err && err.message)
      finalCoachName = '执行教练'
    }
  }

  const now = new Date()
  const newRequest = {
    requestId: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    coachOpenid: safeCoachOpenid,
    coachUserId: safeCoachUserId,
    coachName: finalCoachName,
    requestedAt: now,
    status: COACH_BINDING_STATUS_PENDING,
    decidedAt: null,
    decidedByOpenid: '',
    decidedByUserId: ''
  }
  const nextTopRequests = [...existingRequests, newRequest]
  const currentCourseFlow = getCourseFlowInfo(matchedOrder)
  const nextCourseFlow = {
    ...currentCourseFlow,
    [COACH_BINDING_REQUESTS_FIELD]: nextTopRequests
  }
  try {
    await db.collection(targetCollection).doc(matchedOrder._id).update({
      data: {
        [COACH_BINDING_REQUESTS_FIELD]: nextTopRequests,
        course_flow_info: _.set(nextCourseFlow),
        updatedAt: now
      }
    })
  } catch (err) {
    console.error('[coach_binding_request] write request failed:', err && err.message)
    return { code: 500, msg: '提交申请失败，写入课程信息时出错，请稍后重试' }
  }

  console.log('[coach_binding_request] request submitted:', {
    orderId: matchedOrder._id,
    courseCode,
    requestId: newRequest.requestId,
    coachOpenid: safeCoachOpenid,
    coachName: finalCoachName
  })

  const normalizedTitle = (((matchedOrder.course_target || {}).title) || matchedOrder.title || '未命名课程')
  const normalizedLocation = (((matchedOrder.course_basic || {}).location) || matchedOrder.location || '')

  return {
    code: 0,
    msg: '已提交，等待管理者确认',
    pending: true,
    requestId: newRequest.requestId,
    orderId: matchedOrder._id,
    joinCode: matchedOrder.joinCode || courseCode,
    courseCode: matchedOrder.courseCode || courseCode,
    coachName: finalCoachName,
    title: normalizedTitle,
    location: normalizedLocation
  }
}

// 新增：管理层确认绑定某教练的申请。
async function confirmCoachBinding(orderId, requestId, operatorOpenid, operatorUserId) {
  if (!operatorOpenid) {
    return { code: 401, msg: '未获取到身份，请重新登录后再试' }
  }
  if (!orderId) return { code: 1, msg: '缺少订单ID' }
  if (!requestId) return { code: 1, msg: '缺少申请ID' }

  const targetCollection = getCollectionName(ORDER_COLLECTION_BASE)
  let matchedOrder = null
  try {
    const orderRes = await db.collection(targetCollection).doc(orderId).get()
    matchedOrder = orderRes && orderRes.data ? orderRes.data : null
  } catch (err) {
    console.error('[coach_binding_confirm] query order failed:', err && err.message)
    return { code: 500, msg: '查询课程失败，请稍后重试' }
  }
  if (!matchedOrder) return { code: 404, msg: '课程不存在' }

  if (!isPublisher(matchedOrder, operatorOpenid, operatorUserId)) {
    console.warn('[coach_binding_confirm] 权限拒绝：操作者非课程创建者', {
      orderId,
      operatorOpenid: String(operatorOpenid || '').trim()
    })
    return { code: 403, msg: '只有课程的创建者可以确认教练绑定' }
  }

  const courseFlow = getCourseFlowInfo(matchedOrder)
  const fulfillState = readCourseState(matchedOrder)
  if (isTerminalState(fulfillState)) {
    return { code: 403, msg: terminalBlockedMessage('无法确认绑定') }
  }
  const savedCoachToken = String(matchedOrder.assignedCoachToken || matchedOrder.assigned_coach_token || '').trim()
  const savedCoachOpenid = String(matchedOrder.assignedCoachOpenid || matchedOrder.assigned_coach_openid || '').trim()
  if (savedCoachToken || savedCoachOpenid) {
    return {
      code: 0,
      msg: '该课程已绑定执行教练，无需重复确认',
      alreadyAssigned: true,
      orderId,
      assignedCoachName: String(matchedOrder.assignedCoachName || matchedOrder.assigned_coach_name || '').trim()
    }
  }
  if (fulfillState !== COURSE_STATE.AWAITING) {
    console.warn('[coach_binding_confirm] 状态拒绝：课程不在 awaiting', { orderId, fulfillState })
    return { code: 403, msg: '课程不在待接取状态，无法确认绑定' }
  }

  const existingRequests = getCoachBindingRequests(matchedOrder)
  const targetRequest = existingRequests.find((r) => String((r && r.requestId) || '') === String(requestId))
  if (!targetRequest) {
    return { code: 404, msg: '找不到这条绑定申请，可能已被处理或重置' }
  }
  if (String(targetRequest.status || '') !== COACH_BINDING_STATUS_PENDING) {
    const statusText = String(targetRequest.status || '') === COACH_BINDING_STATUS_CONFIRMED ? '确认' : '拒绝'
    return { code: 409, msg: `该申请已${statusText}过，不能重复操作` }
  }

  const safeCoachOpenid = String(targetRequest.coachOpenid || '').trim()
  const safeCoachUserId = String(targetRequest.coachUserId || '').trim()
  const finalCoachName = String(targetRequest.coachName || '执行教练').trim() || '执行教练'

  const finalCourseCode = String(matchedOrder.courseCode || matchedOrder.joinCode || '').trim()
  const newInProgressFullCode = finalCourseCode
    ? buildStatePickupCode(finalCourseCode, STATE_SUFFIX_IN_PROGRESS)
    : ''
  const currentHistory = getStateHistory(matchedOrder)
  const nextHistory = appendStateSuffix(currentHistory, STATE_SUFFIX_IN_PROGRESS)
  const now = new Date()
  const safeOperatorOpenid = String(operatorOpenid || '').trim()
  const safeOperatorUserId = String(operatorUserId || '').trim()
  const nextRequests = existingRequests.map((r) => {
    if (String((r && r.requestId) || '') === String(requestId)) {
      return {
        ...r,
        status: COACH_BINDING_STATUS_CONFIRMED,
        decidedAt: now,
        decidedByOpenid: safeOperatorOpenid,
        decidedByUserId: safeOperatorUserId
      }
    }
    if (r && String(r.status || '') === COACH_BINDING_STATUS_PENDING) {
      return {
        ...r,
        status: COACH_BINDING_STATUS_REJECTED,
        decidedAt: now,
        decidedByOpenid: safeOperatorOpenid,
        decidedByUserId: safeOperatorUserId,
        rejectReason: '其他教练已被确认，本申请自动失效'
      }
    }
    return r
  })
  try {
    await applyCourseStateTransition(null, orderId, {
      to: COURSE_STATE.IN_PROGRESS,
      actor: { role: ACTOR_ROLE.PUBLISHER, userId: safeOperatorUserId, openid: safeOperatorOpenid },
      reason: 'confirm_coach_binding',
      extra: {
        assignedCoachToken: safeCoachUserId,
        assignedCoachOpenid: safeCoachOpenid,
        assignedCoachName: finalCoachName,
        assignedCoachAt: now,
        pickup_final_code: newInProgressFullCode,
        [COACH_BINDING_REQUESTS_FIELD]: nextRequests,
        [`course_flow_info.${COACH_BINDING_REQUESTS_FIELD}`]: nextRequests,
        ...(newInProgressFullCode ? { pickup_full_code: newInProgressFullCode } : {})
      }
    })
  } catch (err) {
    console.error('[coach_binding_confirm] update order failed:', err && err.message)
    return { code: 500, msg: '确认失败，写入课程信息时出错，请稍后重试' }
  }

  console.log('[coach_binding_confirm] confirm success:', {
    orderId,
    requestId,
    courseCode: finalCourseCode,
    coachOpenid: safeCoachOpenid,
    coachName: finalCoachName,
    operatorOpenid: safeOperatorOpenid
  })

  return {
    code: 0,
    msg: '已确认教练绑定，课程进入进行中',
    orderId,
    requestId,
    assignedCoachName: finalCoachName,
    state_history: nextHistory,
    fulfill_state: COURSE_STATE.IN_PROGRESS,
    currentStateSuffix: newInProgressFullCode ? STATE_SUFFIX_IN_PROGRESS : '',
    pickupFullCode: newInProgressFullCode
  }
}

// 新增：管理层拒绝某个教练的绑定申请。
async function rejectCoachBinding(orderId, requestId, operatorOpenid, operatorUserId, reason = '') {
  if (!operatorOpenid) {
    return { code: 401, msg: '未获取到身份，请重新登录后再试' }
  }
  if (!orderId) return { code: 1, msg: '缺少订单ID' }
  if (!requestId) return { code: 1, msg: '缺少申请ID' }

  const targetCollection = getCollectionName(ORDER_COLLECTION_BASE)
  let matchedOrder = null
  try {
    const orderRes = await db.collection(targetCollection).doc(orderId).get()
    matchedOrder = orderRes && orderRes.data ? orderRes.data : null
  } catch (err) {
    console.error('[coach_binding_reject] query order failed:', err && err.message)
    return { code: 500, msg: '查询课程失败，请稍后重试' }
  }
  if (!matchedOrder) return { code: 404, msg: '课程不存在' }

  if (!isPublisher(matchedOrder, operatorOpenid, operatorUserId)) {
    return { code: 403, msg: '只有课程的创建者可以拒绝教练绑定' }
  }

  const existingRequests = getCoachBindingRequests(matchedOrder)
  const targetRequest = existingRequests.find((r) => String((r && r.requestId) || '') === String(requestId))
  if (!targetRequest) {
    return { code: 404, msg: '找不到这条绑定申请，可能已被处理或重置' }
  }
  if (String(targetRequest.status || '') !== COACH_BINDING_STATUS_PENDING) {
    const statusText = String(targetRequest.status || '') === COACH_BINDING_STATUS_CONFIRMED ? '确认' : '拒绝'
    return { code: 409, msg: `该申请已${statusText}过，不能重复操作` }
  }

  const now = new Date()
  const safeOperatorOpenid = String(operatorOpenid || '').trim()
  const safeOperatorUserId = String(operatorUserId || '').trim()
  const safeReason = String(reason || '').trim().slice(0, 200)
  const nextRequests = existingRequests.map((r) => {
    if (String((r && r.requestId) || '') === String(requestId)) {
      return {
        ...r,
        status: COACH_BINDING_STATUS_REJECTED,
        decidedAt: now,
        decidedByOpenid: safeOperatorOpenid,
        decidedByUserId: safeOperatorUserId,
        rejectReason: safeReason || '管理者拒绝'
      }
    }
    return r
  })
  const currentCourseFlow = getCourseFlowInfo(matchedOrder)
  const nextCourseFlow = {
    ...currentCourseFlow,
    [COACH_BINDING_REQUESTS_FIELD]: nextRequests
  }

  try {
    await db.collection(targetCollection).doc(orderId).update({
      data: {
        [COACH_BINDING_REQUESTS_FIELD]: nextRequests,
        course_flow_info: _.set(nextCourseFlow),
        updatedAt: now
      }
    })
  } catch (err) {
    console.error('[coach_binding_reject] update order failed:', err && err.message)
    return { code: 500, msg: '拒绝失败，写入课程信息时出错，请稍后重试' }
  }

  console.log('[coach_binding_reject] reject success:', {
    orderId,
    requestId,
    operatorOpenid: safeOperatorOpenid,
    reason: safeReason
  })

  return {
    code: 0,
    msg: '已拒绝该教练的绑定申请',
    orderId,
    requestId
  }
}

// 新增：管理层在 publish 页面手动确认后，才正式生成接取码。
async function confirmGeneratePickupCode(orderId, operatorOpenid, operatorUserId) {
  console.log('[pickup_generate] >>> confirm_generate_pickup_code 入口', {
    orderId,
    hasOpenid: !!operatorOpenid,
    hasUserId: !!operatorUserId
  })
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
  const isPub =
    (publisherOpenid && safeOpenid && publisherOpenid === safeOpenid) ||
    (publisherUserId && safeUserId && publisherUserId === safeUserId)

  if (!isPub) {
    return { code: 403, msg: '只有课程的创建者可以确认生成接取码' }
  }

  const currentFullCode = String(matchedOrder.pickup_full_code || matchedOrder.pickupFullCode || '').trim()
  const baseCourseCode = String(matchedOrder.joinCode || matchedOrder.courseCode || '').trim()

  if (!baseCourseCode) {
    return { code: 500, msg: '课程缺少 8 位课程码，暂时无法生成接取码' }
  }

  const existingHistory = getStateHistory(matchedOrder)
  const alreadyGenerated = existingHistory.includes(STATE_SUFFIX_PENDING_LESSON)
    || (currentFullCode && splitStatePickupCode(currentFullCode).stateSuffix === STATE_SUFFIX_PENDING_LESSON)
  if (alreadyGenerated) {
    console.log('[pickup_generate] 幂等命中：pl 码已生成，直接返回当前码', {
      orderId,
      courseCode: baseCourseCode,
      existingHistory
    })
    return {
      code: 0,
      msg: '接取码已生成，无需重复操作',
      orderId,
      pickupFullCode: currentFullCode || buildStatePickupCode(baseCourseCode, STATE_SUFFIX_PENDING_LESSON),
      joinCode: baseCourseCode,
      courseCode: baseCourseCode,
      state_history: existingHistory.length ? existingHistory : [STATE_SUFFIX_PENDING_LESSON],
      fulfill_state: COURSE_STATE.AWAITING,
      courseInfoReady: true
    }
  }

  const courseFlow = getCourseFlowInfo(matchedOrder)
  const fulfillState = readCourseState(matchedOrder)
  if (isTerminalState(fulfillState)) {
    console.warn('[pickup_generate] 课程已终态，拒绝生成接取码', { orderId, fulfillState })
    return { code: 403, msg: terminalBlockedMessage('无需再生成接取码') }
  }

  const courseTarget = matchedOrder.course_target || {}
  const courseBasic = matchedOrder.course_basic || {}
  const teachingRecord = matchedOrder.teaching_record || {}
  const courseBasicInfo = matchedOrder.course_basic_info || {}
  const normalizedTitle = String(
    courseTarget.title || matchedOrder.title || teachingRecord.title || ''
  ).trim()
  const normalizedContact = normalizePhone(
    courseBasic.contact || matchedOrder.contact || courseBasicInfo.contact
    || ((matchedOrder.order_base_info || {}).contact || '')
  )
  const normalizedLocation = String(
    courseBasic.location || matchedOrder.location || courseBasicInfo.location || ''
  ).trim()
  const scheduleCount = Array.isArray(courseFlow.schedule) ? courseFlow.schedule.length : 0
  const totalLessons = Number(courseFlow.progress_total || matchedOrder.progress_total || scheduleCount) || 0

  if (!normalizedTitle) return { code: 1, msg: '请先补充课程标题后再确认' }
  if (!isValidPhone(normalizedContact)) return { code: 1, msg: '请先填写正确的 11 位联系手机号后再确认' }
  if (!normalizedLocation) return { code: 1, msg: '请先填写上课地点后再确认' }
  if (totalLessons <= 0) return { code: 1, msg: '请先设置总课时数后再确认' }

  const newFullCode = buildStatePickupCode(baseCourseCode, STATE_SUFFIX_PENDING_LESSON)
  if (!newFullCode) {
    return { code: 500, msg: '生成接取码失败，请稍后重试' }
  }

  const now = new Date()
  try {
    await applyCourseStateTransition(null, orderId, {
      to: COURSE_STATE.AWAITING,
      actor: { role: ACTOR_ROLE.PUBLISHER, userId: safeUserId, openid: safeOpenid },
      reason: 'confirm_generate_pickup_code',
      extra: {
        pickup_confirm_code: '',
        pickup_full_code: newFullCode,
        pickup_final_code: '',
        pickup_code_generated_at: now,
        course_info_ready_at: now,
        'course_flow_info.course_info_ready_at': now,
        [STATE_HISTORY_FIELD]: [STATE_SUFFIX_PENDING_LESSON],
        [`course_flow_info.${STATE_HISTORY_FIELD}`]: [STATE_SUFFIX_PENDING_LESSON]
      }
    })
  } catch (err) {
    console.error('[pickup_generate] update order failed:', err && err.message)
    return { code: 500, msg: '生成接取码失败，请稍后重试' }
  }

  return {
    code: 0,
    msg: '接取码已生成，课程已进入待接取队列',
    orderId,
    pickupFullCode: newFullCode,
    joinCode: baseCourseCode,
    courseCode: baseCourseCode,
    state_history: [STATE_SUFFIX_PENDING_LESSON],
    fulfill_state: COURSE_STATE.AWAITING,
    courseInfoReady: true
  }
}

// 新增：发布者重置课程的确认码。
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
  const isPub =
    (publisherOpenid && safeOpenid && publisherOpenid === safeOpenid) ||
    (publisherUserId && safeUserId && publisherUserId === safeUserId)

  if (!isPub) {
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
  const resetFulfillState = keepCoach ? COURSE_STATE.IN_PROGRESS : COURSE_STATE.AWAITING
  const resetExtra = {
    pickup_confirm_code: newConfirmCode,
    pickup_full_code: newFullCode,
    pickup_final_code: newFinalCode,
    [COACH_BINDING_REQUESTS_FIELD]: [],
    [`course_flow_info.${COACH_BINDING_REQUESTS_FIELD}`]: []
  }
  if (!keepCoach) {
    resetExtra.assignedCoachToken = ''
    resetExtra.assignedCoachOpenid = ''
    resetExtra.assignedCoachName = ''
    resetExtra.assignedCoachAt = null
  }

  try {
    await applyCourseStateTransition(null, orderId, {
      to: resetFulfillState,
      actor: { role: ACTOR_ROLE.PUBLISHER, userId: safeUserId, openid: safeOpenid },
      reason: 'reset_pickup_confirm_code',
      allowReset: !keepCoach,
      extra: resetExtra
    })
  } catch (err) {
    console.error('[pickup_reset] update confirm code failed:', err && err.message)
    return { code: 500, msg: '重置失败，写入课程信息时出错，请稍后重试' }
  }

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

// 新增：管理层点「完成课程信息编辑，允许教练接单」时写 course_info_ready_at。
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
  const isPub =
    (publisherOpenid && safeOpenid && publisherOpenid === safeOpenid) ||
    (publisherUserId && safeUserId && publisherUserId === safeUserId)
  if (!isPub) {
    return { code: 403, msg: '只有课程的创建者可以确认课程资料并允许教练接单' }
  }

  const courseFlow = getCourseFlowInfo(matchedOrder)
  const fulfillState = readCourseState(matchedOrder)
  if (isTerminalState(fulfillState)) {
    return { code: 403, msg: terminalBlockedMessage('无需再确认课程资料') }
  }

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

  const courseTarget = matchedOrder.course_target || {}
  const courseBasic = matchedOrder.course_basic || {}
  const teachingRecord = matchedOrder.teaching_record || {}
  const courseBasicInfo = matchedOrder.course_basic_info || {}
  const normalizedTitle = String(
    courseTarget.title
    || matchedOrder.title
    || teachingRecord.title
    || ''
  ).trim()
  const normalizedContact = normalizePhone(
    courseBasic.contact
    || matchedOrder.contact
    || courseBasicInfo.contact
    || ((matchedOrder.order_base_info || {}).contact || '')
  )
  const normalizedLocation = String(
    courseBasic.location
    || matchedOrder.location
    || courseBasicInfo.location
    || ''
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

// 开始课程（旧状态链，入口已下线，保留函数体）。
async function startOrder(orderId, openid, userId) {
  const { data, ref } = await findOrder(orderId)
  if (!data) return { code: 404, msg: '订单不存在' }

  if (!isParticipant(data, openid, userId)) {
    return { code: 403, msg: '无权操作' }
  }

  const now = new Date()
  await applyCourseStateTransition(null, orderId, {
    to: COURSE_STATE.IN_PROGRESS,
    actor: { role: ACTOR_ROLE.PUBLISHER, userId, openid },
    reason: 'start',
    extra: {
      order_base_info: {
        ...getOrderBaseInfo(data),
        updatedAt: now
      },
      'course_flow_info.startedAt': now
    }
  })

  return { code: 0, msg: '课程已开始' }
}

// 手动完成订单（旧整单完成，入口已下线，改由 close 负责）。
async function completeOrder(orderId, openid, userId) {
  const { data, ref } = await findOrder(orderId)
  if (!data) return { code: 404, msg: '订单不存在' }

  if (!isPublisher(data, openid, userId)) {
    return { code: 403, msg: '无权操作' }
  }

  const now = new Date()
  const nextOrder = {
    ...data,
    course_flow_info: {
      ...getCourseFlowInfo(data),
      fulfill_state: COURSE_STATE.COMPLETED,
      completedAt: now
    }
  }

  await applyCourseStateTransition(null, orderId, {
    to: COURSE_STATE.COMPLETED,
    actor: { role: ACTOR_ROLE.PUBLISHER, userId, openid },
    reason: 'complete',
    extra: {
      order_base_info: {
        ...getOrderBaseInfo(data),
        updatedAt: now
      },
      'course_flow_info.completedAt': now
    }
  })

  await syncCoachResultToBIfNeeded(nextOrder, 'order_completed')
  return { code: 0, msg: '订单已完成' }
}

// 取消订单。
async function cancelOrder(orderId, openid, userId, reason) {
  const { data, ref } = await findOrder(orderId)
  if (!data) return { code: 404, msg: '订单不存在' }

  if (!isPublisher(data, openid, userId)) {
    return { code: 403, msg: '无权操作' }
  }

  const now = new Date()
  const nextOrder = {
    ...data,
    course_flow_info: {
      ...getCourseFlowInfo(data),
      fulfill_state: COURSE_STATE.CANCELLED,
      publish_state: 'closed',
      cancelledAt: now,
      cancelReason: reason || '无'
    }
  }

  await applyCourseStateTransition(null, orderId, {
    to: COURSE_STATE.CANCELLED,
    actor: { role: ACTOR_ROLE.PUBLISHER, userId, openid },
    reason: 'cancel',
    extra: {
      order_base_info: {
        ...getOrderBaseInfo(data),
        updatedAt: now
      },
      'course_flow_info.publish_state': 'closed',
      'course_flow_info.cancelledAt': now,
      'course_flow_info.cancelReason': reason || '无'
    }
  })

  await syncCoachResultToBIfNeeded(nextOrder, 'order_cancelled')
  return { code: 0, msg: '订单已取消' }
}

// 结课。
async function closeOrder(orderId, openid, userId, closeSummary, closeCoachNote) {
  const { data, ref } = await findOrder(orderId)
  if (!data) return { code: 404, msg: '订单不存在' }

  if (!isPublisher(data, openid, userId) && !isAcceptor(data, openid, userId)) {
    return { code: 403, msg: '无权操作' }
  }

  const now = new Date()

  const currentHistoryForClose = getStateHistory(data)
  const nextHistoryForClose = appendStateSuffix(currentHistoryForClose, STATE_SUFFIX_DONE_LESSON)
  const finalCourseCodeForClose = String(data.courseCode || data.joinCode || data.parent_course_code || '').trim()
  const newDoneFullCode = finalCourseCodeForClose && currentHistoryForClose.length
    ? buildStatePickupCode(finalCourseCodeForClose, STATE_SUFFIX_DONE_LESSON)
    : ''

  const nextOrder = {
    ...data,
    order_base_info: {
      ...getOrderBaseInfo(data),
      updatedAt: now
    },
    course_flow_info: {
      ...getCourseFlowInfo(data),
      fulfill_state: COURSE_STATE.CLOSED,
      publish_state: 'closed',
      closedAt: now,
      close_summary: closeSummary || '',
      close_coach_note: closeCoachNote || ''
    },
    [STATE_HISTORY_FIELD]: nextHistoryForClose,
    updatedAt: now
  }
  nextOrder.course_flow_info[STATE_HISTORY_FIELD] = nextHistoryForClose

  const actorCloseRole = isPublisher(data, openid, userId) ? ACTOR_ROLE.PUBLISHER : ACTOR_ROLE.COACH
  const courseCloseExtra = {
    order_base_info: nextOrder.order_base_info,
    'course_flow_info.publish_state': 'closed',
    'course_flow_info.closedAt': now,
    'course_flow_info.close_summary': closeSummary || '',
    'course_flow_info.close_coach_note': closeCoachNote || ''
  }
  if (newDoneFullCode) {
    courseCloseExtra.pickup_full_code = newDoneFullCode
    courseCloseExtra.pickup_final_code = newDoneFullCode
  }

  await applyCourseStateTransition(null, orderId, {
    to: COURSE_STATE.CLOSED,
    actor: { role: actorCloseRole, userId, openid },
    reason: 'close',
    extra: courseCloseExtra
  })

  await syncCoachResultToBIfNeeded(nextOrder, 'order_closed')

  return {
    code: 0,
    msg: '课程已结课',
    state_history: nextHistoryForClose,
    currentStateSuffix: nextHistoryForClose.length ? nextHistoryForClose[nextHistoryForClose.length - 1] : '',
    pickupFullCode: newDoneFullCode
  }
}

module.exports = {
  assignCoachByPickupCode,
  requestCoachBinding,
  confirmCoachBinding,
  rejectCoachBinding,
  confirmGeneratePickupCode,
  resetPickupConfirmCode,
  markCourseInfoReady,
  startOrder,
  completeOrder,
  cancelOrder,
  closeOrder
}
