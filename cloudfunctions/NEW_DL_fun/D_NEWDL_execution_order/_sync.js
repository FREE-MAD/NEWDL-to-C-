/**
 * _sync.js —— 订单域 A↔B 出入站
 *
 * 从 dev_index.js 抽出的 B 侧联动函数：requestBHttpApi / syncCoachResultToBIfNeeded / syncParentBookingToA。
 * 依赖 _constants / _common / _db / _shared(http、request)。
 */

const { getJson, ENDPOINTS } = require('./_shared/http')
const { parseJsonLike } = require('./_shared/request')
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

// 调整（2026-10-08）：HTTPS GET 的具体实现下沉到 _shared/http.js 的 getJson，返回结构不变。
function requestBHttpApi(payload = {}) {
  return getJson(ENDPOINTS.bTwowaybinding, payload, {
    timeoutMessage: '调用 B 侧 HTTP 服务超时'
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
    fulfill_state: INITIAL_COURSE_STATE,
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
