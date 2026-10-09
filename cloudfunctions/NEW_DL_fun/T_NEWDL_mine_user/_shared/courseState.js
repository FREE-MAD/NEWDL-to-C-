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

/**
 * 建单初始态（唯一真源）：发布 / 桥接建单时 fulfill_state 的初始值。
 * 建单走 add，不经 applyCourseStateTransition（owner 只管迁移、管不了创建），
 * 所以建单处必须引用这个常量，而不是散落写 COURSE_STATE.EDITING。
 */
const INITIAL_COURSE_STATE = COURSE_STATE.EDITING;

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

// ---------------------------------------------------------------------------
// 6. 状态机 owner：fulfill_state 的唯一下写入口（2026-10-09 新增）
// ---------------------------------------------------------------------------
//
// 为什么要有 owner：
//   - fulfill_state 在 dev_index.js 里有 22 处各自直写 DB（顶层 / 内层 / 双写混杂），
//     谁可以推状态、哪些迁移合法，全部散在各函数自己的 if 里 —— 教练凭接取码直接把自己
//     推成 in_progress 的后门、双写导致两处读出来不一致，都是"散写"的产物。
//   - 本函数是今后全工程唯一允许写 course_flow_info.fulfill_state 的位置，
//     状态读写收敛到一处事务，日志（state_transition_log）只会追加、不再整块覆盖。
//
// 校验两档（重要）：
//   - enforce=false（默认）：只收口「单写内层 + 追加 state_transition_log + 去重追加
//     state_history 后缀 + completed 自增 progress_done」，不做合法性/权限拦截，
//     保证 22 处替换期间线上行为零变化。全部替换、逐一核对后，再逐函数打开 enforce。
//   - enforce=true：assertTransition（迁移合法性 + 终态冻结）+ assertActorPermission
//     （操作者角色）。未登记的迁移默认只放行 admin。

const { fail } = require('./errors');
const { normalizeCollectionName } = require('./collections');
const { currentContext, currentEnvVersion, initRuntime } = require('./runtime');

/** 订单集合基础名（与 dev_index.js 的 ORDER_COLLECTION_BASE 保持一致，含 NDLdev_/NDLreal_ 前缀归一） */
const ORDER_BASE_NAME = 'execution_orders';

/** 操作者角色常量（权限判定用） */
const ACTOR_ROLE = {
  PUBLISHER: 'publisher', // 发布者 / 管理层
  COACH: 'coach',         // 教练
  PARENT: 'parent',       // 家长（B 端桥接）
  SYSTEM: 'system',       // 系统 / 自动收敛
  ADMIN: 'admin'          // 管理员
};

/**
 * 特殊通道：重置接取码回退（现状唯一的状态回退能力，reset_pickup_confirm_code 用）。
 * 需显式传 allowReset=true 才会放行，否则按 TRANSITIONS 表拒绝。
 */
const RESET_TRANSITION = {
  from: [COURSE_STATE.AWAITING, COURSE_STATE.IN_PROGRESS],
  to: COURSE_STATE.AWAITING
};

/**
 * 操作者权限表：key = `${from}→${to}`，与代码现状逐条核对（2026-10-09）：
 *   - 教练不能直接把自己推成进行中（后门 assign_coach_by_pickup_code 在 enforce 下失效）
 *   - 完成 / 取消 / 关闭由发布者或系统推进，完成也允许教练本人
 * 未登记的迁移在 enforce 下默认只放行 admin。
 */
const ACTOR_RULES = {
  [`${COURSE_STATE.EDITING}→${COURSE_STATE.AWAITING}`]:       [ACTOR_ROLE.PUBLISHER, ACTOR_ROLE.ADMIN],
  [`${COURSE_STATE.AWAITING}→${COURSE_STATE.IN_PROGRESS}`]:   [ACTOR_ROLE.PUBLISHER, ACTOR_ROLE.ADMIN],
  [`${COURSE_STATE.IN_PROGRESS}→${COURSE_STATE.COMPLETED}`]:  [ACTOR_ROLE.PUBLISHER, ACTOR_ROLE.ADMIN, ACTOR_ROLE.COACH, ACTOR_ROLE.SYSTEM],
  [`${COURSE_STATE.IN_PROGRESS}→${COURSE_STATE.CLOSED}`]:     [ACTOR_ROLE.PUBLISHER, ACTOR_ROLE.ADMIN, ACTOR_ROLE.SYSTEM],
  [`${COURSE_STATE.AWAITING}→${COURSE_STATE.CANCELLED}`]:     [ACTOR_ROLE.PUBLISHER, ACTOR_ROLE.ADMIN, ACTOR_ROLE.PARENT, ACTOR_ROLE.SYSTEM],
  [`${COURSE_STATE.IN_PROGRESS}→${COURSE_STATE.CANCELLED}`]:  [ACTOR_ROLE.PUBLISHER, ACTOR_ROLE.ADMIN, ACTOR_ROLE.SYSTEM],
  [`${COURSE_STATE.COMPLETED}→${COURSE_STATE.CLOSED}`]:       [ACTOR_ROLE.PUBLISHER, ACTOR_ROLE.ADMIN, ACTOR_ROLE.SYSTEM]
};

/** to 值归一：历史遗留 pending 统一归一成 awaiting，不再向库里产生新 pending（治理 #17） */
function normalizeTargetState(to) {
  const value = String(to || '').trim();
  return value === COURSE_STATE.PENDING ? COURSE_STATE.AWAITING : value;
}

/** 迁移合法性断言（enforce 模式才调用） */
function assertTransition(from, to, allowReset) {
  if (allowReset
    && RESET_TRANSITION.from.indexOf(from) !== -1
    && to === RESET_TRANSITION.to) return;
  const allowed = TRANSITIONS[from];
  if (!allowed) throw fail.stateConflict(from, to, '未知起始状态');
  if (allowed.indexOf(to) === -1) throw fail.stateConflict(from, to, '终态冻结或不允许跳档');
}

/** 操作者权限断言（enforce 模式才调用；未登记的迁移默认只放行 admin） */
function assertActorPermission(actor, from, to) {
  const role = (actor && actor.role) || '';
  const roles = ACTOR_RULES[`${from}→${to}`] || [ACTOR_ROLE.ADMIN];
  if (roles.indexOf(role) === -1) {
    throw fail.actorDenied(role || 'unknown', from, to);
  }
}

/**
 * 解析运行时上下文：优先用调用方传入的 ctx；取不到时回退到本次请求的 AsyncLocalStorage
 * 上下文（业务函数在 runInContext 包裹内直接调 owner 时不传 ctx 也能用）；再兜底自建一个
 * develop 环境的临时上下文 —— 与历史默认行为一致，保证 owner 在任何调用方都能工作。
 */
function resolveCtx(ctx) {
  if (ctx && ctx.db && ctx._) return ctx;
  const alsCtx = currentContext();
  if (alsCtx && alsCtx.db) return alsCtx;
  return initRuntime({ envVersion: currentEnvVersion() });
}

/**
 * 课程状态迁移的唯一写入口。
 * 在一个事务里完成：读当前订单 → 合法性 / 权限断言（enforce 时）→ 只写内层一份 →
 * 追加 state_transition_log → 去重追加 state_history 后缀 → completed 时 progress_done 自增。
 *
 * @param {Object} ctx   initRuntime() 返回的请求上下文；可传 null（自动回退到本次请求上下文）
 * @param {String} orderId  订单 _id
 * @param {Object} opts  { to, actor, reason, extra, allowReset, enforce }
 *   - to:        目标状态（COURSE_STATE 之一；传 pending 会归一成 awaiting）
 *   - actor:     { role, userId, openid }，enforce 时做权限断言，平时只记日志
 *   - reason:    本次迁移的业务来源（如 'confirm_coach_binding'），进 transition log
 *   - extra:     与状态无关的字段补丁（如 pickup_final_code、assignedCoach*），
 *                与状态字段同一个事务原子提交；字段名用点路径（如 'pickup_full_code'）
 *   - allowReset: true 时放行 RESET_TRANSITION 回退通道（重置接取码专用）
 *   - enforce:   true 时启用 assertTransition + assertActorPermission（默认 false）
 * @returns {Promise<{from, to, noop}>}  noop=true 表示状态未变化（同态幂等，extra 仍会提交）
 */
async function applyCourseStateTransition(ctx, orderId, opts = {}) {
  const { actor = {}, reason = '', extra = null, allowReset = false, enforce = false } = opts;
  const to = normalizeTargetState(opts.to);
  if (!to) throw fail.badRequest('目标状态为空');
  if (!orderId) throw fail.badRequest('缺少订单ID');

  const resolvedCtx = resolveCtx(ctx);
  const db = resolvedCtx.db;
  const _ = resolvedCtx._;
  const collName = normalizeCollectionName(ORDER_BASE_NAME, resolvedCtx.isDev);
  const now = resolvedCtx.now || Date.now();

  let result = null;
  await db.runTransaction(async (tx) => {
    const ref = tx.collection(collName).doc(orderId);
    const snap = await ref.get();
    if (!snap.data) throw fail.notFound('订单');

    const from = readCourseState(snap.data, COURSE_STATE.EDITING);
    // 同态幂等：状态没变不算迁移，但 extra 副作用（如重置接取码换码）仍需原子提交
    if (from === to) {
      const samePatch = { updatedAt: now };
      if (extra && typeof extra === 'object') Object.assign(samePatch, extra);
      await ref.update({ data: samePatch });
      result = { from, to, noop: true };
      return;
    }

    if (enforce) {
      assertTransition(from, to, allowReset);          // ① 迁移合法性
      assertActorPermission(actor, from, to);         // ② 操作者权限
    } else {
      // 宽松模式：只对未登记迁移打 warn 日志，不拦截（替换过渡期）
      const allowed = TRANSITIONS[from];
      if (!allowReset && (!allowed || allowed.indexOf(to) === -1)) {
        console.warn('[courseState] 宽松模式放行未登记迁移', { orderId, from, to, reason });
      }
    }

    // ★ 状态只写内层 course_flow_info.fulfill_state 一份，不再有顶层双写
    const patch = {
      'course_flow_info.fulfill_state': to,
      'course_flow_info.state_transition_log': _.push([{
        from, to, at: now, actor, role: (actor && actor.role) || '', reason
      }]),
      updatedAt: now
    };

    // state_history 后缀：去重追加（editing 无后缀，显式留空）。
    // 注意顶层与内层同步写：getStateHistory 读侧是「顶层优先」，只写内层会让旧顶层数组遮蔽新后缀。
    const suffix = stateSuffixOf(to);
    if (suffix) {
      const currentHistory = getStateHistory(snap.data);
      const nextHistory = appendStateSuffix(currentHistory, suffix);
      if (nextHistory !== currentHistory) {
        patch[STATE_HISTORY_FIELD] = nextHistory;
        patch[`course_flow_info.${STATE_HISTORY_FIELD}`] = nextHistory;
      }
    }

    // 课时进度：只有「完成」这一档自增，与迁移绑定，不可能漏也有可能不重复
    if (to === COURSE_STATE.COMPLETED) {
      patch[`course_flow_info.progress_done`] = _.inc(1);
    }

    // 调用方传入的非状态副作用字段，与状态同事务原子提交
    if (extra && typeof extra === 'object') Object.assign(patch, extra);

    await ref.update({ data: patch });
    result = { from, to, noop: false };
  });

  console.log('[courseState] state.transition', {
    orderId, ...result, actor: (actor && actor.userId) || '', role: (actor && actor.role) || '', reason
  });
  // 出站同步（对 B 回调等）不在本函数做 —— 调用方在拿到结果后自行触发，避免事务内做网络 IO
  return result;
}

module.exports = {
  COURSE_STATE,
  INITIAL_COURSE_STATE,
  TERMINAL_STATES,
  STATE_SUFFIX,
  VALID_STATE_SUFFIXES,
  STATE_SUFFIX_LENGTH,
  STATE_PICKUP_CODE_LENGTH,
  STATE_HISTORY_FIELD,
  COURSE_FLOW_FIELD,
  TRANSITIONS,
  BRIDGE_ALLOWED_STATES,
  ACTOR_ROLE,
  RESET_TRANSITION,
  ACTOR_RULES,
  readCourseState,
  pickState,
  isTerminalState,
  isClosedState,
  terminalBlockedMessage,
  getStateHistory,
  stateSuffixOf,
  resolveStateSuffix,
  appendStateSuffix,
  normalizeIncomingState,
  // L2 状态机 owner（唯一写入口）
  normalizeTargetState,
  assertTransition,
  assertActorPermission,
  applyCourseStateTransition
};
