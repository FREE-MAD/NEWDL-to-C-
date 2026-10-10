/**
 * _sync.js —— 订单域 A↔B 出入站
 *
 * 从 dev_index.js 抽出的 B 侧联动函数：requestBHttpApi / syncCoachResultToBIfNeeded / syncParentBookingToA。
 * 依赖 _constants / _common / _db / _shared(http、request、runtime)。
 */

const { getJson, postJson, ENDPOINTS, isRouteMiss } = require('./_shared/http')
const { parseJsonLike } = require('./_shared/request')
const { currentEnvVersion, currentIsDev } = require('./_shared/runtime')
const courseState = require('./_shared/courseState')
const { INITIAL_COURSE_STATE } = courseState
const {
  M_CODE_PREFIX_FROM_B,
  BRIDGE_STATUS_SYNCED,
  SOURCE_FROM_B_PARENT,
  ORDER_COLLECTION_BASE
} = require('./_constants')
const {
  shouldSyncResultToB,
  buildCoachResultSyncPayload,
  buildImportedSubmitForm,
  buildGroupedOrderPayload,
  normalizeOrderOrganizationInfo,
  normalizeInviteCode,
  normalizePhone,
  isValidPhone
} = require('./_common')
const {
  db,
  getCollectionName,
  generateOrgSequenceMCode,
  generateUniqueMCode,
  getOrganizationDocByInviteCode,
  appendOrderIdToOrganizationClass
} = require('./_db')

// 新增（2026-10-10 · AB 全量推）：全量推之后 requestUrl 可能把整张课表带进日志（GET 回退时），统一截断预览。
function previewForLog(text = '', limit = 300) {
  const safe = String(text || '')
  return safe.length > limit ? `${safe.slice(0, limit)}...(len=${safe.length})` : safe
}

// 调整（2026-10-10 · AB 全量推）：GET 改 POST —— 全量快照（含整张课表）体积远超 query 串承受范围。
// B 侧 HTTP 入口（twowaybinding_1_DLforP 的 buildHttpEvent）原生支持 POST body 合并成 event；
// 过渡期兜底：POST 未成功（对端还是只认 GET 的旧部署等）自动回退 GET，保证回抄不断链。
function requestBHttpApiAt(baseUrl, payload = {}) {
  const bSideOptions = {
    timeoutMessage: '调用 B 侧 HTTP 服务超时',
    // B 侧口径：HTTP < 400 且业务体 success !== false
    isSuccess: (statusCode, parsed) => (statusCode || 0) < 400 && (!parsed || parsed.success !== false),
    invalidPayload: (rawText) => ({ success: false, message: '对端返回的不是 JSON', rawText })
  }

  return postJson(baseUrl, payload, bSideOptions).then(
    (postResult) => {
      if (postResult && postResult.success) {
        return postResult
      }
      console.warn('[execution_order][requestBHttpApi] POST 未成功，回退 GET', {
        statusCode: (postResult && postResult.statusCode) || 0
      })
      return getJson(baseUrl, payload, bSideOptions)
    },
    (postError) => {
      console.warn('[execution_order][requestBHttpApi] POST 失败，回退 GET', {
        message: postError && (postError.message || postError.errMsg) || String(postError)
      })
      return getJson(baseUrl, payload, bSideOptions)
    }
  )
}

// 调整（2026-10-10 拆双函数）：B 侧 twowaybinding_1_DLforP 已拆成 D_/T_ 两个部署单元，
// 按本次请求环境选地址（develop → D_，其余 → T_）；旧函数名地址（Legacy）留作迁移期兜底。
async function requestBHttpApi(payload = {}) {
  const primaryUrl = currentIsDev() ? ENDPOINTS.bTwowaybindingD : ENDPOINTS.bTwowaybindingT
  let result

  try {
    result = await requestBHttpApiAt(primaryUrl, payload)
  } catch (error) {
    // 连不上 / DNS 层失败也按「路由不到」处理：给旧地址最后一次机会，旧地址也失败则抛出。
    console.warn('[execution_order][requestBHttpApi] 新地址请求失败，回退旧函数名地址', {
      from: primaryUrl,
      to: ENDPOINTS.bTwowaybindingLegacy,
      message: error && (error.message || error.errMsg) || String(error)
    })
    return requestBHttpApiAt(ENDPOINTS.bTwowaybindingLegacy, payload)
  }

  if (!isRouteMiss(result)) {
    return result
  }

  // 兜底（拆双迁移期）：B 侧 D_/T_ 还没部署时，回退旧函数名地址，保证回抄不断链。
  console.warn('[execution_order][requestBHttpApi] 新地址未命中，回退旧函数名地址', {
    from: primaryUrl,
    to: ENDPOINTS.bTwowaybindingLegacy,
    statusCode: (result && result.statusCode) || 0
  })
  return requestBHttpApiAt(ENDPOINTS.bTwowaybindingLegacy, payload)
}

async function syncCoachResultToBIfNeeded(order = {}, syncReason = '') {
  if (!shouldSyncResultToB(order)) {
    return {
      skipped: true,
      reason: 'not_from_b'
    }
  }

  const payload = {
    ...buildCoachResultSyncPayload(order, { syncReason }),
    // 新增（2026-10-10 · AB 全量推）：把本次请求的环境带上，让 B 侧按同一环境落 dev_/real_ 集合，
    // 避免 D_（develop）的全量快照写进 B 的 real_ 库（此前 payload 不带 envVersion，B 侧一律按 real_ 处理）。
    envVersion: currentEnvVersion()
  }
  const snapshotBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')

  try {
    const result = await requestBHttpApi(payload)
    console.log('[execution_order][syncCoachResultToB][success]', {
      orderId: order._id || '',
      // 新增（2026-10-10）：B 侧业务体 success:false 也会走到这里，单独记录，便于区分「送达」与「送达但被拒」
      success: !!(result && result.success),
      // requestUrl 仅在 GET 回退时可能极长（全量快照都在 query 里），日志只留预览
      requestUrl: previewForLog(result.requestUrl),
      snapshotBytes,
      fromBFormId: payload.from_b_form_id,
      fromBCourseId: payload.from_b_course_id,
      syncReason
    })
    return result
  } catch (error) {
    console.error('[execution_order][syncCoachResultToB][fail]', {
      orderId: order._id || '',
      snapshotBytes,
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

  const organizationBasicForCode = (importedOrganizationDoc && importedOrganizationDoc.organization_basic) || {}
  const orgInvitationCode = normalizeInviteCode(organizationBasicForCode.invitation_code || '')
  const orgSequenceMCode = orgInvitationCode
    ? await generateOrgSequenceMCode(targetCollection, orgInvitationCode)
    : ''
  const uniqueMCode = orgSequenceMCode || (await generateUniqueMCode(targetCollection, M_CODE_PREFIX_FROM_B))
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
    publish_state: 'bridged_from_b',
    fulfill_state: INITIAL_COURSE_STATE,
    // 新增（2026-10-09 · 课程流转 T4）：桥接建单同样要有一条起点记录，否则 owner 的 from 只能靠兜底。
    state_transition_log: [{
      from: '',
      to: INITIAL_COURSE_STATE,
      at: now,
      actor: { role: courseState.ACTOR_ROLE.SYSTEM, userId: '', openid: String(event.from_b_openid || '').trim() },
      role: courseState.ACTOR_ROLE.SYSTEM,
      reason: 'created:sync_parent_booking_to_a'
    }],
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
    joinCode: uniqueMCode,
    courseCode: uniqueMCode,
    parent_course_code: uniqueMCode,
    m_code_org_invite: orgSequenceMCode ? orgInvitationCode : '',
    pickup_confirm_code: '',
    pickup_full_code: '',
    pickup_final_code: '',
    assignedCoachToken: '',
    assignedCoachOpenid: '',
    assignedCoachName: '',
    assignedCoachAt: null,
    // 调整（2026-10-09 · 课程流转 T4）：去掉顶层 fulfill_state 双写，状态只落 course_flow_info 一份。
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

module.exports = {
  requestBHttpApi,
  syncCoachResultToBIfNeeded,
  syncParentBookingToA
}
