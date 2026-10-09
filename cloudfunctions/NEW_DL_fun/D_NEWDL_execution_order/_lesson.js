/**
 * _lesson.js —— 订单域课节与教学内容
 *
 * 从 dev_index.js 抽出的课节函数：lessonHandshake / updateLessonContent / addLesson /
 * syncLessonProgress / addEntryLog。
 * 依赖 _common / _db / _sync / courseState。
 */

const courseState = require('./_shared/courseState')
const { COURSE_STATE, readCourseState } = courseState
const {
  getCourseFlowInfo,
  getOrderBaseInfo,
  isAcceptor,
  isParticipant,
  hasLessonPlanConfigured,
  normalizeLessonRating,
  normalizeLessonRatingTags,
  normalizeLessonDimensionRatings,
  getShareVisibility,
  currentSafeNumber,
  getAcceptorOpenid
} = require('./_common')
const { _, findOrder } = require('./_db')
const { syncCoachResultToBIfNeeded } = require('./_sync')

// 课节握手（旧状态链，入口已下线，保留函数体）。
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

  const lesson = {
    ...schedule[lessonIdx],
    logs: Array.isArray(schedule[lessonIdx].logs) ? schedule[lessonIdx].logs : []
  }
  const now = new Date()
  let updates = {}

  switch (subAction) {
    case 'coach_ready':
      if (!isAcceptor(data, openid, userId)) {
        return { code: 403, msg: '非当前教练' }
      }
      lesson.coach_status = 'ready'
      lesson.status = 'PARENT_CONFIRMED'
      lesson.parent_status = 'confirmed'
      if (!lesson.startedAt) lesson.startedAt = now

      lesson.logs.push({ action: 'coach_start', time: now, userId })
      break

    case 'parent_confirm':
      return { code: 403, msg: 'P侧操作已下线，请使用教练端开始课程' }

    case 'coach_complete':
      if (!isAcceptor(data, openid, userId)) {
        return { code: 403, msg: '非当前教练' }
      }
      lesson.coach_status = 'completed'
      if (!lesson.completedAt) lesson.completedAt = now
      lesson.parent_status = 'completed'
      lesson.status = 'DONE'
      updates.progress_done = _.inc(1)
      lesson.logs.push({ action: 'coach_complete', time: now, userId })
      break

    case 'parent_complete':
      return { code: 403, msg: 'P侧操作已下线，请使用教练端完成课程' }

    default:
      return { code: 400, msg: '未知握手动作' }
  }

  schedule[lessonIdx] = lesson
  const nextCourseFlowInfo = {
    ...courseFlowInfo,
    schedule
  }

  if (lesson.status === 'DONE') {
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
      nextCourseFlowInfo.fulfill_state = COURSE_STATE.COMPLETED
      nextCourseFlowInfo.completedAt = new Date()
    } else {
      if (readCourseState(data, '') !== COURSE_STATE.IN_PROGRESS) {
        nextCourseFlowInfo.fulfill_state = COURSE_STATE.IN_PROGRESS
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

// 手动添加课节 (教练)。
async function addLesson(orderId, openid) {
  const { data, collection, ref } = await findOrder(orderId)
  if (!data) return { code: 404, msg: '订单不存在' }

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

  const newSchedule = []
  for (let lessonNum = safeStartLesson; lessonNum <= safeTotalLessons; lessonNum += 1) {
    newSchedule.push({
      lesson: lessonNum,
      logs: []
    })
  }

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

module.exports = {
  lessonHandshake,
  updateLessonContent,
  addLesson,
  syncLessonProgress,
  addEntryLog
}
