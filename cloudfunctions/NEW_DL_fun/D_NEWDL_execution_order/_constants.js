/**
 * _constants.js —— 订单域常量层（唯一真源）
 *
 * 从 dev_index.js 顶部抽出的顶层常量，供 _db / _common / _sync / _state / _lesson 共享。
 * 本文件无业务依赖（仅依赖 _shared/courseState），是依赖图的叶子层。
 *
 * 状态后缀 / state_history 字段等真值仍从 _shared/courseState 取值后 re-export，
 * 避免两处定义分叉（与拆分前 dev_index.js 顶部「值改为从共享层取」的做法一致）。
 */

const courseState = require('./_shared/courseState')

// 集合基础名（develop → NDLdev_，trial/release → NDLreal_，前缀由 _shared/collections 处理）
const ORDER_COLLECTION_BASE = 'execution_orders'
const USER_COLLECTION_BASE = 'users'
const ORGANIZATION_COLLECTION_BASE = 'organization'

// action 常量
const ACTION_SYNC_PARENT_BOOKING_TO_A = 'syncParentBookingToA'
const ACTION_SYNC_COACH_RESULT_TO_B = 'syncCoachResultToB'

// 来源标识
const SOURCE_FROM_A_DIRECT = '在小程序A由教练直接提交'
const SOURCE_FROM_B_PARENT = '在小程序B由家长提交经过api中转进入小程序A移交教练操作'

// 桥接状态（BRIDGE_STATUS_PENDING / FAILED 为历史死常量，拆分时清理）
const BRIDGE_STATUS_SYNCED = 'synced'

// M 码规则
const M_CODE_CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const M_CODE_RAND_LENGTH = 7
const M_CODE_GENERATE_MAX_RETRY = 10
const M_CODE_PREFIX_FROM_A = 'A'
const M_CODE_PREFIX_FROM_B = 'B'

// 接取码辅助常量
const PICKUP_CONFIRM_CODE_LENGTH = 4
const PICKUP_FULL_CODE_LENGTH = 12 // 旧码 = 8(M 码) + 4(确认码)
const PICKUP_FULL_CODE_LENGTH_ORG = 13 // 历史过渡兼容（9 位方案遗留测试码）
const PICKUP_FINAL_CODE_SUFFIX = 'DL'

// 课程状态后缀（真值在 _shared/courseState，这里 re-export 保持下游引用不变）
const STATE_SUFFIX_PENDING_LESSON = courseState.STATE_SUFFIX.PENDING_LESSON
const STATE_SUFFIX_IN_PROGRESS = courseState.STATE_SUFFIX.IN_PROGRESS
const STATE_SUFFIX_DONE_LESSON = courseState.STATE_SUFFIX.DONE_LESSON
const STATE_SUFFIX_LENGTH = courseState.STATE_SUFFIX_LENGTH
const STATE_PICKUP_CODE_LENGTH = courseState.STATE_PICKUP_CODE_LENGTH
const STATE_HISTORY_FIELD = courseState.STATE_HISTORY_FIELD
const VALID_STATE_SUFFIXES = courseState.VALID_STATE_SUFFIXES

// 机构码
const ORG_M_CODE_SOURCE_SUFFIX_FROM_B = 'b'
const ORG_M_CODE_TOTAL_LENGTH = 8

// 教练绑定申请（coach_binding_requests）
const COACH_BINDING_REQUESTS_FIELD = 'coach_binding_requests'
const COACH_BINDING_STATUS_PENDING = 'pending'
const COACH_BINDING_STATUS_CONFIRMED = 'confirmed'
const COACH_BINDING_STATUS_REJECTED = 'rejected'

module.exports = {
  ORDER_COLLECTION_BASE,
  USER_COLLECTION_BASE,
  ORGANIZATION_COLLECTION_BASE,
  ACTION_SYNC_PARENT_BOOKING_TO_A,
  ACTION_SYNC_COACH_RESULT_TO_B,
  SOURCE_FROM_A_DIRECT,
  SOURCE_FROM_B_PARENT,
  BRIDGE_STATUS_SYNCED,
  M_CODE_CHARSET,
  M_CODE_RAND_LENGTH,
  M_CODE_GENERATE_MAX_RETRY,
  M_CODE_PREFIX_FROM_A,
  M_CODE_PREFIX_FROM_B,
  PICKUP_CONFIRM_CODE_LENGTH,
  PICKUP_FULL_CODE_LENGTH,
  PICKUP_FULL_CODE_LENGTH_ORG,
  PICKUP_FINAL_CODE_SUFFIX,
  STATE_SUFFIX_PENDING_LESSON,
  STATE_SUFFIX_IN_PROGRESS,
  STATE_SUFFIX_DONE_LESSON,
  STATE_SUFFIX_LENGTH,
  STATE_PICKUP_CODE_LENGTH,
  STATE_HISTORY_FIELD,
  VALID_STATE_SUFFIXES,
  ORG_M_CODE_SOURCE_SUFFIX_FROM_B,
  ORG_M_CODE_TOTAL_LENGTH,
  COACH_BINDING_REQUESTS_FIELD,
  COACH_BINDING_STATUS_PENDING,
  COACH_BINDING_STATUS_CONFIRMED,
  COACH_BINDING_STATUS_REJECTED
}
