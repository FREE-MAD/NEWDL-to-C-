/**
 * _lesson.js —— 订单域课节与教学内容
 *
 * 从 dev_index.js 抽出的课节函数：updateLessonContent / completeLesson /
 * syncLessonProgress / addEntryLog。
 * 依赖 _common / _db / _sync / courseState。
 *
 * 归档（2026-10-10 · 课程流转 T9）：lessonHandshake / addLesson 已移除，
 * 备份见 cloudfunctions/_legacy_disabled/dead_code_execution_order_20261010.js.txt
 */

const courseState = require('./_shared/courseState')
const {
  COURSE_STATE,
  readCourseState,
  isTerminalState,
  terminalBlockedMessage,
  ACTOR_ROLE,
  applyCourseStateTransition
} = courseState
const {
  getCourseFlowInfo,
  getOrderBaseInfo,
  isAcceptor,
  isParticipant,
  isPublisher,
  hasLessonPlanConfigured,
  normalizeLessonRating,
  normalizeLessonRatingTags,
  normalizeLessonDimensionRatings,
  getShareVisibility,
  currentSafeNumber
} = require('./_common')
const { _, findOrder } = require('./_db')
const { syncCoachResultToBIfNeeded } = require('./_sync')

// 归档（2026-10-10 · 课程流转 T9）：lessonHandshake 已移除。备份见 cloudfunctions/_legacy_disabled/dead_code_execution_order_20261010.js.txt

// 更新课程内容 (总结、图片/视频)。
async function updateLessonContent(orderId, openid, userId, lessonIndex, content) {
  const { data, ref } = await findOrder(orderId)
  if (!data) return { code: 404, msg: '订单不存在' }
  const courseFlowInfo = getCourseFlowInfo(data)
  if (!Array.isArray(courseFlowInfo.schedule) && !Array.isArray(data.schedule)) return { code: 400, msg: '课表不存在' }

  if (!isAcceptor(data, openid, userId)) {
    return { code: 403, msg: '无权操作' }
  }

  const schedule = Array.isArray(courseFlowInfo.schedule) ? courseFlowInfo.schedule : data.schedule
  const lessonIdx = schedule.findIndex(l => l.lesson == lessonIndex)
  if (lessonIdx === -1) {
    console.warn(`[execution_order] [updateLessonContent] Lesson not found. OrderId: ${orderId}, Target: ${lessonIndex}, Schedule:`, schedule.map(l => l.lesson));
    return { code: 404, msg: '课节不存在' }
  }

  const lesson = {
    ...schedule[lessonIdx],
    logs: Array.isArray(schedule[lessonIdx].logs) ? schedule[lessonIdx].logs : []
  }
  const now = new Date()

  if (content.summary !== undefined) {
    lesson.summary = content.summary
    lesson.summaryUpdatedAt = now
    lesson.logs.push({ action: 'summary_update', time: now, userId })
  }
  if (content.summaryDate !== undefined) {
    lesson.summaryDate = content.summaryDate || ''
    lesson.logs.push({ action: 'summary_date_update', time: now, userId })
  }
  if (content.startedAt !== undefined) {
    lesson.startedAt = content.startedAt || ''
    lesson.logs.push({ action: 'started_at_update', time: now, userId })
  }
  if (content.completedAt !== undefined) {
    lesson.completedAt = content.completedAt || ''
    lesson.logs.push({ action: 'completed_at_update', time: now, userId })
  }
  if (content.rating !== undefined) {
    lesson.rating = normalizeLessonRating(content.rating)
    lesson.logs.push({ action: 'rating_update', time: now, userId })
  }
  if (content.ratingTags !== undefined) {
    lesson.ratingTags = normalizeLessonRatingTags(content.ratingTags)
    lesson.logs.push({ action: 'rating_tags_update', time: now, userId })
  }
  if (content.dimensionRatings !== undefined) {
    lesson.dimensionRatings = normalizeLessonDimensionRatings(content.dimensionRatings)
    lesson.logs.push({ action: 'dimension_ratings_update', time: now, userId })
  }
  if (content.media !== undefined) lesson.media = content.media

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

// 新增（2026-10-09 · 课程流转 T1-b）：「课节完成」的唯一存活入口。
// 口径（Q1 已定）：**教练显式点「完成」**才算完成 —— 不再用「有没有写 summary」这种前端推断。
//
// 设计要点：
//   1. 课节状态写 `schedule[i].status = 'DONE'`（这是全工程唯一写 DONE 的地方，
//      旧的 lessonHandshake 实现已于 2026-10-10 归档删除，见 _legacy_disabled）。
//   2. progress_done 的自增**在这里**发生（通过 owner 的 extra 原子提交），
//      而不是在 owner 里按 to===completed 自增 —— 否则最后一节课会「完成 +1、推 completed 再 +1」。
//   3. 全部课节 DONE 时顺带把整单推到 completed；否则状态保持不变（owner 走同态幂等分支）。
//   4. 幂等：本节课已经是 DONE 就直接返回，不重复自增。
async function completeLesson(orderId, openid, userId, lessonIndex) {
  const { data } = await findOrder(orderId)
  if (!data) return { code: 404, msg: '订单不存在' }

  const actorIsCoach = isAcceptor(data, openid, userId)
  const actorIsPublisher = isPublisher(data, openid, userId)
  if (!actorIsCoach && !actorIsPublisher) {
    return { code: 403, msg: '只有本课程的教练或发布者可以标记课节完成' }
  }

  const fulfillState = readCourseState(data, '')
  if (isTerminalState(fulfillState)) {
    return { code: 403, msg: terminalBlockedMessage('无法标记课节完成') }
  }
  // 课节只可能在教练已绑定（in_progress）之后才真正上完；editing / awaiting 阶段没有执行教练。
  if (fulfillState !== COURSE_STATE.IN_PROGRESS) {
    return { code: 403, msg: '课程不在进行中，无法标记课节完成' }
  }

  const courseFlowInfo = getCourseFlowInfo(data)
  const schedule = Array.isArray(courseFlowInfo.schedule)
    ? courseFlowInfo.schedule
    : (Array.isArray(data.schedule) ? data.schedule : [])
  if (!schedule.length) return { code: 400, msg: '课表不存在' }

  // 与 updateLessonContent 保持一致：用宽松比较兼容 lesson 号是字符串的历史数据。
  const targetIndex = schedule.findIndex((item) => item && item.lesson == lessonIndex)
  if (targetIndex === -1) {
    console.warn(`[execution_order] [completeLesson] Lesson not found. OrderId: ${orderId}, Target: ${lessonIndex}, Schedule:`, schedule.map((item) => item && item.lesson))
    return { code: 404, msg: '课节不存在' }
  }

  const currentProgressDone = currentSafeNumber(courseFlowInfo.progress_done || data.progress_done)
  const currentProgressTotal = currentSafeNumber(courseFlowInfo.progress_total || data.progress_total)

  const targetLesson = schedule[targetIndex] || {}
  if (String(targetLesson.status || '') === 'DONE') {
    return {
      code: 0,
      msg: '本节课已完成，无需重复操作',
      alreadyDone: true,
      lessonIndex: targetLesson.lesson,
      progress_done: currentProgressDone,
      progress_total: currentProgressTotal,
      fulfill_state: fulfillState
    }
  }

  const now = new Date()
  const nextSchedule = schedule.map((item, idx) => {
    if (idx !== targetIndex) return item
    return {
      ...item,
      status: 'DONE',
      completedAt: item.completedAt || now,
      logs: (Array.isArray(item.logs) ? item.logs : []).concat([
        { action: 'lesson_complete', time: now, userId: userId || '', openid: openid || '' }
      ])
    }
  })
  const allDone = nextSchedule.every((item) => String((item && item.status) || '') === 'DONE')
  const nextState = allDone ? COURSE_STATE.COMPLETED : fulfillState
  const actorRole = actorIsCoach ? ACTOR_ROLE.COACH : ACTOR_ROLE.PUBLISHER

  try {
    await applyCourseStateTransition(null, orderId, {
      to: nextState,
      actor: { role: actorRole, userId: userId || '', openid: openid || '' },
      reason: 'complete_lesson',
      extra: {
        'course_flow_info.schedule': nextSchedule,
        // 幂等已在上方拦截；这里与课节 DONE 的同一次事务提交，不可能漏也不可能重复。
        'course_flow_info.progress_done': _.inc(1),
        ...(allDone ? { 'course_flow_info.completedAt': now } : {})
      }
    })
  } catch (err) {
    console.error('[completeLesson] state transition failed:', err && err.message)
    return { code: 500, msg: '标记失败，写入课程信息时出错，请稍后重试' }
  }

  const nextOrder = {
    ...data,
    course_flow_info: {
      ...courseFlowInfo,
      fulfill_state: nextState,
      schedule: nextSchedule,
      progress_done: currentProgressDone + 1,
      ...(allDone ? { completedAt: now } : {})
    },
    updatedAt: now
  }
  try {
    await syncCoachResultToBIfNeeded(nextOrder, 'lesson_completed')
  } catch (err) {
    // B 侧同步失败不影响本端结果：课节已完成是既成事实，同步是尽力而为。
    console.warn('[completeLesson] syncCoachResultToB failed:', err && err.message)
  }

  console.log('[completeLesson] success:', {
    orderId,
    lessonIndex: targetLesson.lesson,
    allDone,
    nextState,
    actorRole
  })

  return {
    code: 0,
    msg: allDone ? '本节课已完成，全部课节已上完，课程已结课' : '本节课已完成',
    lessonIndex: targetLesson.lesson,
    alreadyDone: false,
    allDone,
    progress_done: currentProgressDone + 1,
    progress_total: currentProgressTotal,
    fulfill_state: nextState
  }
}

// 归档（2026-10-10 · 课程流转 T9）：addLesson 已移除。备份见 cloudfunctions/_legacy_disabled/dead_code_execution_order_20261010.js.txt

// 半途接入课程。
async function syncLessonProgress(orderId, openid, userId, totalLessons, startLesson, historyCount) {
  const { data, ref } = await findOrder(orderId)
  if (!data) return { code: 404, msg: '订单不存在' }

  if (!isParticipant(data, openid, userId)) {
    return { code: 403, msg: '无权操作' }
  }

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

  // 修复（2026-10-09 · 课程流转 T5）：重建 schedule 时**继承已有课节的字段**。
  // 原实现无条件 push `{ lesson, logs }`，会把原课节上的 summary / summaryDate / rating /
  // ratingTags / dimensionRatings / startedAt / completedAt / media / status 全部抹掉 ——
  // 表现为「半途接入后又调整一次总课时，已记录的课节内容静默消失」。
  // 继承范围只覆盖落在新课表区间（safeStartLesson ~ safeTotalLessons）的课节；
  // 早于 safeStartLesson 的课节属于「历史已完成」区间，由 history_sync.syncedCount 代表，
  // 刻意不放进 schedule —— 否则前端 progress 计数会重复（前端算法是 historyCount + schedule 已完成数）。
  const currentCourseFlowInfo = getCourseFlowInfo(data)
  const existingSchedule = Array.isArray(currentCourseFlowInfo.schedule)
    ? currentCourseFlowInfo.schedule
    : (Array.isArray(data.schedule) ? data.schedule : [])
  const existingLessonMap = new Map()
  existingSchedule.forEach((item) => {
    const lessonNum = Number(item && item.lesson)
    if (!Number.isNaN(lessonNum)) existingLessonMap.set(lessonNum, item)
  })

  const newSchedule = []
  for (let lessonNum = safeStartLesson; lessonNum <= safeTotalLessons; lessonNum += 1) {
    const existingLesson = existingLessonMap.get(lessonNum)
    if (existingLesson) {
      newSchedule.push({ ...existingLesson, lesson: lessonNum })
      continue
    }
    newSchedule.push({
      lesson: lessonNum,
      logs: []
    })
  }

  const historyDoneCount = safeStartLesson - 1
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
    // 注意（T5）：这里仍以入参 historyCount 为准重算（historyDoneCount），
    // **不叠加**上方 schedule 里被继承下来的 DONE 课节数 —— 保持「重新校准」的原有语义，
    // 宁可低估不虚高。这条差异由 T7 的存量回填统一处理。
    progress_done: historyDoneCount,
    schedule: newSchedule,
    history_sync: nextHistorySync
    // 状态机收口（2026-10-09）：半途接入不再写 fulfill_state，保持原值。
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

// 新增页面进入记录。
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

// 归档（2026-10-10 · 课程流转 T9）：lessonHandshake / addLesson 已移除，
// 备份见 cloudfunctions/_legacy_disabled/dead_code_execution_order_20261010.js.txt
module.exports = {
  updateLessonContent,
  completeLesson,
  syncLessonProgress,
  addEntryLog
}
