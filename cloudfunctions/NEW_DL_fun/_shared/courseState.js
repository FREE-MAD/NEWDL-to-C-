/**
 * _shared/courseState.js —— L2 领域层：课程生命周期状态（fulfill_state）唯一真源
 *
 * 治的病（现状实测）：
 *   - fulfill_state 在 NEWDL_execution_order/dev_index.js 里出现 66 次，其中**写入 22 处**，
 *     状态值全是裸字符串：「'in_progress'」写了 7 遍、「'editing'」写了 6 遍、「'awaiting'」4 遍……
 *     新增/改名一个状态要改 22 个字面量，漏一处就是「progress 页 Tab 落错档、publish 页按钮不出现」。
 *   - 「是否终态」的三连或（closed || cancelled || completed）在 4 个函数里各写一遍，
 *     且有一处只判了 closed || cancelled（execution_order:1477），口径已经不一致。
 *   - state_history 的「存在则不重复 push」逻辑有 3 份逐字副本（接取 / 确认绑定 / 结课）。
 *   - 状态后缀（pl/ip/dl）与 fulfill_state 的兜底映射写死在 resolveCurrentStateSuffix 里，
 *     前端展示码与库里状态靠这段代码对齐，改状态就要同步改两处。
 *
 * 本轮边界（重要）：
 *   只做「单一真源 + 只读判定」，**不改任何一条已存在的流转规则**。
 *   TRANSITIONS 表是把现状抄下来当文档，本轮**不启用强校验**——
 *   现状存在 awaiting→awaiting（重置接取码）、in_progress→awaiting（重置且不保留教练）这类同态/回退，
 *   一旦上强校验就会把正在跑的业务拦死。要上校验必须单独一轮、逐条确认。
 *
 * 用法：
 *   const courseState = require('./_shared/courseState')
 *   courseState.COURSE_STATE.IN_PROGRESS                     // 'in_progress'
 *   courseState.isTerminalState(readCourseState(order))      // true / false
 *   courseState.readCourseState(order, 'editing')            // 顶层 / 内层双读兜底
 *   courseState.appendStateSuffix(history, 'ip')             // 去重 push，返回新数组
 */

// ---------------------------------------------------------------------------
// 1. 状态值（唯一真源）
// ---------------------------------------------------------------------------

/** 课程生命周期状态：fulfill_state 的全部合法取值 */
const COURSE_STATE = {
  EDITING: 'editing',         // 待编辑：发布/桥接建单初始态，管理层还没确认资料
  AWAITING: 'awaiting',       // 待接取：已生成 pl 接取码，等教练申请
  IN_PROGRESS: 'in_progress', // 进行中：教练已绑定（assignedCoach* 已写）
  COMPLETED: 'completed',     // 已完成：全部课节 DONE 或发布者手动完成
  CANCELLED: 'cancelled',     // 已取消
  CLOSED: 'closed',           // 已结课（教练/发布者结课，带 close_summary）
  PENDING: 'pending'          // 历史遗留值：课节收敛处仍会写，读取时与 awaiting 同档（见 stateSuffixOf）
};

/** 终态集合：进入后不再接受接取 / 确认资料 / 生成接取码 */
const TERMINAL_STATES = [
  COURSE_STATE.COMPLETED,
  COURSE_STATE.CANCELLED,
  COURSE_STATE.CLOSED
];

/** 接取码状态后缀（新码制：8 位课程码 + 2 位后缀） */
const STATE_SUFFIX = {
  PENDING_LESSON: 'pl',   // 待接取
  IN_PROGRESS: 'ip',      // 进行中
  DONE_LESSON: 'dl'       // 已结课
};

const VALID_STATE_SUFFIXES = [
  STATE_SUFFIX.PENDING_LESSON,
  STATE_SUFFIX.IN_PROGRESS,
  STATE_SUFFIX.DONE_LESSON
];

const STATE_SUFFIX_LENGTH = 2;
const STATE_PICKUP_CODE_LENGTH = 10; // 8(M 码) + 2(状态后缀)

/** state_history 字段名（顶层与 course_flow_info 内层同步写，两处都能读） */
const STATE_HISTORY_FIELD = 'state_history';

/** course_flow_info 内层字段名 */
const COURSE_FLOW_FIELD = 'course_flow_info';

// ---------------------------------------------------------------------------
// 2. 流转表（现状抄录，本轮仅作文档，不做校验）
// ---------------------------------------------------------------------------

/**
 * 现状实际发生的流转（从 dev_index.js 逐个写入点抄下来，不是理想模型）。
 * 含同态（awaiting→awaiting）与回退（in_progress→awaiting），所以不能直接拿来做校验。
 */
const TRANSITIONS = {
  [COURSE_STATE.EDITING]: [COURSE_STATE.AWAITING, COURSE_STATE.CANCELLED, COURSE_STATE.CLOSED],
  [COURSE_STATE.AWAITING]: [COURSE_STATE.AWAITING, COURSE_STATE.IN_PROGRESS, COURSE_STATE.CANCELLED, COURSE_STATE.CLOSED],
  [COURSE_STATE.PENDING]: [COURSE_STATE.IN_PROGRESS, COURSE_STATE.COMPLETED, COURSE_STATE.CANCELLED, COURSE_STATE.CLOSED],
  [COURSE_STATE.IN_PROGRESS]: [COURSE_STATE.AWAITING, COURSE_STATE.COMPLETED, COURSE_STATE.CANCELLED, COURSE_STATE.CLOSED],
  [COURSE_STATE.COMPLETED]: [],
  [COURSE_STATE.CANCELLED]: [],
  [COURSE_STATE.CLOSED]: []
};

// ---------------------------------------------------------------------------
// 3. 读取 / 判定（纯函数）
// ---------------------------------------------------------------------------

/**
 * 读订单当前状态：内层 course_flow_info.fulfill_state 优先，回退顶层 fulfill_state，
 * 两者都为空时返回 fallback。
 *
 * 为什么要双读：历史上先有顶层字段，后才加 course_flow_info 内层，
 * 老文档只有顶层、新写入两处都写，读取必须兼容。
 *
 * @param {Object} order 订单文档
 * @param {String} fallback 都取不到时的兜底（默认 editing）
 */
function readCourseState(order, fallback = COURSE_STATE.EDITING) {
  const safeOrder = order || {};
  const flow = safeOrder[COURSE_FLOW_FIELD] || {};
  return pickState(flow.fulfill_state, safeOrder.fulfill_state, fallback);
}

/**
 * 从两个候选值里挑状态：primary 优先，空则 secondary，都空则 fallback。
 * 用于「已解析的 course_flow_info + 入参表单兜底」这类场景（源不是完整订单文档时）。
 */
function pickState(primary, secondary, fallback = COURSE_STATE.EDITING) {
  const raw = (primary === undefined || primary === null ? '' : primary)
    || (secondary === undefined || secondary === null ? '' : secondary)
    || '';
  const value = String(raw).trim();
  return value || fallback;
}

/** 是否终态（completed / cancelled / closed） */
function isTerminalState(state) {
  const value = String(state || '').trim();
  if (!value) return false;
  return TERMINAL_STATES.indexOf(value) !== -1;
}

/** 是否已结课（closed）—— 与终态分开，接取链路历史上只挡 closed / cancelled */
function isClosedState(state) {
  const value = String(state || '').trim();
  return value === COURSE_STATE.CLOSED || value === COURSE_STATE.CANCELLED;
}

/**
 * 终态拒绝的统一文案。现状三处文案前缀完全一致，只是后缀不同：
 *   '…无法确认绑定' / '…无需再生成接取码' / '…无需再确认课程资料'
 * @param {String} actionText 后缀，例如 '无法确认绑定'
 */
function terminalBlockedMessage(actionText) {
  return `该课程已关闭或已完成，${actionText}`;
}

// ---------------------------------------------------------------------------
// 4. state_history：读取 / 后缀映射 / 去重 push
// ---------------------------------------------------------------------------

/** 读 state_history：顶层优先，回退 course_flow_info 内层，都没有返回 [] */
function getStateHistory(order) {
  const safeOrder = order || {};
  const top = Array.isArray(safeOrder[STATE_HISTORY_FIELD]) ? safeOrder[STATE_HISTORY_FIELD] : null;
  if (top && top.length) return top;
  const flow = safeOrder[COURSE_FLOW_FIELD] || {};
  const inner = Array.isArray(flow[STATE_HISTORY_FIELD]) ? flow[STATE_HISTORY_FIELD] : null;
  return inner && inner.length ? inner : [];
}

/**
 * 状态 → 状态后缀。
 * awaiting / pending → pl；in_progress → ip；三个终态 → dl；其余 ''。
 * 入参不区分大小写（与现状 resolveCurrentStateSuffix 一致，先小写再比）。
 */
function stateSuffixOf(state) {
  const value = String(state || '').trim().toLowerCase();
  if (value === COURSE_STATE.AWAITING || value === COURSE_STATE.PENDING) return STATE_SUFFIX.PENDING_LESSON;
  if (value === COURSE_STATE.IN_PROGRESS) return STATE_SUFFIX.IN_PROGRESS;
  if (isTerminalState(value)) return STATE_SUFFIX.DONE_LESSON;
  return '';
}

/**
 * 当前该展示的状态后缀：
 *   1) state_history 末尾元素合法 → 直接用（历史是权威，库里累积写过什么就是什么）；
 *   2) 历史为空 → 按 fulfill_state 兜底映射；
 *   3) 都拿不到 → ''。
 */
function resolveStateSuffix(order) {
  const history = getStateHistory(order);
  if (history.length) {
    const last = String(history[history.length - 1] || '').toLowerCase();
    if (VALID_STATE_SUFFIXES.indexOf(last) !== -1) return last;
  }
  return stateSuffixOf(readCourseState(order, ''));
}

/**
 * 往 state_history 追加一个后缀：已存在则原样返回（不重复写），否则返回新数组。
 * 现状三处调用点全是这个语义，写成共享函数避免哪天漏了 includes 判断导致数组里堆重复值。
 */
function appendStateSuffix(history, suffix) {
  const safeHistory = Array.isArray(history) ? history : [];
  const safeSuffix = String(suffix || '').trim().toLowerCase();
  if (!safeSuffix) return safeHistory;
  if (safeHistory.indexOf(safeSuffix) !== -1) return safeHistory;
  return safeHistory.concat([safeSuffix]);
}

// ---------------------------------------------------------------------------
// 5. 入参归一化（B 侧桥接透传）
// ---------------------------------------------------------------------------

/** B 侧透传过来时允许直接落库的状态白名单（twowaybinding_1_DLforC:404） */
const BRIDGE_ALLOWED_STATES = [
  COURSE_STATE.EDITING,
  COURSE_STATE.AWAITING,
  COURSE_STATE.IN_PROGRESS
];

/**
 * 归一化外部（B 侧 / HTTP）透传进来的状态值：不在白名单里一律回退 fallback。
 * 默认白名单 = editing / awaiting / in_progress，兜底 editing —— B 侧桥接课程建单即「待编辑」。
 *
 * 注意只 trim、不小写：现状实现（twowaybinding_1_DLforC:404-410）就是 trim 后精确比较，
 * 库里状态值本身全小写，加 toLowerCase 会悄悄放宽口径。
 */
function normalizeIncomingState(value, fallback = COURSE_STATE.EDITING, allowed = BRIDGE_ALLOWED_STATES) {
  const safeValue = String(value || '').trim();
  if (!safeValue) return fallback;
  const list = Array.isArray(allowed) && allowed.length ? allowed : BRIDGE_ALLOWED_STATES;
  return list.indexOf(safeValue) !== -1 ? safeValue : fallback;
}

module.exports = {
  COURSE_STATE,
  TERMINAL_STATES,
  STATE_SUFFIX,
  VALID_STATE_SUFFIXES,
  STATE_SUFFIX_LENGTH,
  STATE_PICKUP_CODE_LENGTH,
  STATE_HISTORY_FIELD,
  COURSE_FLOW_FIELD,
  TRANSITIONS,
  BRIDGE_ALLOWED_STATES,
  readCourseState,
  pickState,
  isTerminalState,
  isClosedState,
  terminalBlockedMessage,
  getStateHistory,
  stateSuffixOf,
  resolveStateSuffix,
  appendStateSuffix,
  normalizeIncomingState
};
