// A 侧 AB 关联云函数最小入口。
// 当前这份代码专门给 B 侧通过 HTTP / API 直连使用：
// 1) 只承接 action=syncParentBookingToA；
// 2) 不再转调 A 的其他云函数，直接在这里入库；
// 3) 允许通过 inviteCode 命中机构邀请码，把订单先挂到机构 owner 名下；
// 4) 保留 source / from_b_* 字段，方便后续回抄和排查。
// 5) 当前补上 HTTP 云函数启动能力，避免云端部署时缺少 scf_bootstrap / 9000 端口入口。
// tcb fn deploy --env-id cloud1-6gh7jgl8c5b16a83 --force twowaybinding_1_DLforC
const http = require("http");
const { URL } = require("url");
const cloud = require("wx-server-sdk");

// 调整（2026-10-08）：cloud.init / 集合名 / 入参归一化统一走公共层 _shared（源在 NEW_DL_fun/_shared/，副本只读）。
const { dbHandle } = require("./_shared/runtime");
const { normalizeCollectionName, prefix } = require("./_shared/collections");
const { parseJsonLike } = require("./_shared/request");
// 调整（2026-10-08）：B 侧透传的 fulfill_state 白名单归一化走公共层（源在 _shared/courseState.js）。
const { normalizeIncomingState, ACTOR_ROLE } = require("./_shared/courseState");

// 注：本函数沿用 cloud.DYNAMIC_CURRENT_ENV（与其余写死 env 的函数不同），显式传给公共层保持行为不变。
const db = dbHandle({ env: cloud.DYNAMIC_CURRENT_ENV });

// 启动阶段先打一条模块装载日志，便于确认实例是否真的把业务代码跑起来了。
console.log("[twowaybinding_1_DLforC][INFO] module.loaded", {
  pid: process.pid,
  portFromEnv: process.env.PORT || "",
  nodeEnv: process.env.NODE_ENV || "",
});

const ORDER_COLLECTION_BASE = "execution_orders";
const ORGANIZATION_COLLECTION_BASE = "organization";
const ACTION_SYNC_PARENT_BOOKING_TO_A = "syncParentBookingToA";
const ACTION_RESOLVE_INVITE = "resolveInvite";
const SOURCE_FROM_B_PARENT = "在小程序B由家长提交经过api中转进入小程序A移交教练操作";
const DEFAULT_CLASS_COUNT = 10;

// 集合前缀规则已下沉到 _shared/collections.js（develop → NDLdev_，trial/release → NDLreal_）。
// 本函数是 8 个函数里唯一把 envVersion 一路当参数传的，收口后只是把规则换了个出处，签名不变。
function getCollectionPrefix(envVersion = "develop") {
  return prefix(envVersion === "develop");
}

function getCollectionName(baseName = "", envVersion = "develop") {
  return normalizeCollectionName(baseName, envVersion === "develop");
}

function normalizeInviteCode(code = "") {
  return String(code || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 16);
}

function normalizePhone(phone = "") {
  return String(phone || "").replace(/\D/g, "").slice(0, 11);
}

function isValidPhone(phone = "") {
  return /^1[3-9]\d{9}$/.test(normalizePhone(phone));
}

// 注：parseJsonLike 已下沉到 _shared/request.js（本文件顶部 require）。

function normalizeChildProfiles(childProfiles = []) {
  const safeList = Array.isArray(childProfiles) ? childProfiles : [];

  return safeList
    .map((item) => ({
      nickname: String((item || {}).nickname || "").trim(),
      age: String((item || {}).age || "").trim(),
      gender: String((item || {}).gender || "").trim(),
      height: String((item || {}).height || "").trim(),
      weight: String((item || {}).weight || "").trim(),
    }))
    .filter((item) => item.nickname || item.age || item.gender || item.height || item.weight);
}

function normalizeOrderOrganizationInfo(orderOrgInfo = {}) {
  return {
    orgId: String(orderOrgInfo.orgId || orderOrgInfo.organizationId || "").trim(),
    orgName: String(orderOrgInfo.orgName || orderOrgInfo.organizationName || "").trim(),
    memberRole: String(orderOrgInfo.memberRole || orderOrgInfo.orgMemberRole || "").trim(),
    inviteCode: String(orderOrgInfo.inviteCode || orderOrgInfo.invitationCode || "").trim(),
  };
}

// 家长课程码现在改为「A/B 统一 M 码规范」：
// - 情况1 B 约课：前缀 B，格式 BXXXXXXX，共 8 位
// - 情况2 A 直建：前缀 A，格式 AXXXXXXX，共 8 位
// 随机位字符集同样去掉 0/O/1/I/L，降低家长/教练读错。
// 说明：老代码使用订单 _id 计算 16 进制 hash 的实现已废弃，避免两端出现两套格式。
const M_CODE_CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const M_CODE_RAND_LENGTH = 7;
const M_CODE_GENERATE_MAX_RETRY = 10;
const M_CODE_PREFIX_FROM_B = "B";

// 情况1 twowaybinding_1_DLforC 构造 B 前缀的单条候选码；不做唯一性校验。
function buildParentCourseCode() {
  let randPart = "";
  const ts = Date.now();
  let seed = ts & 0x7fffffff;
  for (let i = 0; i < M_CODE_RAND_LENGTH; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const randomByte = (seed ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    const idx = randomByte % M_CODE_CHARSET.length;
    randPart += M_CODE_CHARSET[idx];
  }
  return `${M_CODE_PREFIX_FROM_B}${randPart}`;
}

// 情况1 检查 8 位 M 码是否已占用（覆盖 joinCode / courseCode / parent_course_code 三个展示字段）。
async function isParentCourseCodeOccupied(orderCollection = "", parentCourseCode = "") {
  if (!orderCollection || !parentCourseCode) {
    return true;
  }
  const _ = db.command;
  try {
    const res = await db.collection(orderCollection)
      .where(_.or([
        { joinCode: parentCourseCode },
        { courseCode: parentCourseCode },
        { parent_course_code: parentCourseCode }
      ]))
      .limit(1)
      .count();
    return (Number(res && res.total) || 0) > 0;
  } catch (error) {
    console.warn("[twowaybinding_1_DLforC][WARN] isParentCourseCodeOccupied fallback true:", error && error.message);
    return true;
  }
}

// 情况1 生成唯一的 B 前缀 M 码，最多重试 10 次；极端冲突降级返回候选。
async function ensureUniqueParentCourseCode(orderCollection = "") {
  if (!orderCollection) {
    throw new Error("缺少订单集合名，无法生成 B 前缀家长课程码");
  }
  for (let i = 0; i < M_CODE_GENERATE_MAX_RETRY; i += 1) {
    const candidate = buildParentCourseCode();
    const occupied = await isParentCourseCodeOccupied(orderCollection, candidate);
    if (!occupied) {
      return candidate;
    }
  }
  const fallback = buildParentCourseCode();
  console.warn("[twowaybinding_1_DLforC][WARN] courseCode fallback after max retry", { fallback });
  return fallback;
}

// 新增（2026-09-16）：机构代码前缀归一化 —— 取机构邀请码前 4 位作为课程码前缀；
// 超出 4 位取前 4 位，不足 4 位右侧补 0 凑满 4 位（如 XINGYAO → XING、AB → AB00），统一大写。
// 调整（2026-09-16 二次定版）：不足 4 位改为左侧补 0、机构代码放结尾，并统一转小写
// （如 XINGYAO → xing、AB → 00ab），配合码尾小写 a/b 后缀组成完整课程码。
// 与 NEWDL_execution_order 保持同一套规则，避免两条桥接链路码源不一致。
// 调整（2026-09-16 三次定版·最终版）：机构代码改为大写放开头、不足 4 位不补 0 保持原样
// （如 XINGYAO → XING、AB → AB），空缺位数由序号动态补足（课程码总长恒 9 位）。
// 修正（2026-09-16 终版确认）：课程码总长恒 8 位（上一行"9 位"为笔误），机构代码最长 4 位，码尾固定 1 位来源后缀。
function buildOrgCodePrefix(invitationCode = "") {
  const rawCode = String(invitationCode || "").trim().toUpperCase();
  if (!rawCode) {
    return "";
  }
  return rawCode.slice(0, 4);
}

// 新增（2026-09-16）：机构新码制来源后缀 —— 小写 a/b 放在码尾区分来源：
// b = 家长从 B 端约课（本文件链路固定用 b）；a = 教练 A 端直建（预留，暂未接入新码制）。
// 原系统里该标记是大写 A/B 放在码首，现改为小写放码尾。
const ORG_M_CODE_SOURCE_SUFFIX_FROM_B = "b";

// 修复（2026-09-16）：家长课程码标准化 —— 主体（机构代码 + 序号）转大写，
// 末尾来源后缀 b（B 端家长约课标记）保留小写形式。
// 之前的实现直接 .toUpperCase()，会把 B 侧透传过来的 "SZDX001b" 误转成 "SZDX001B"，
// 导致 A 端三份字段（joinCode/courseCode/parent_course_code）持久化了大写 B，
// 与 B 侧数据库的小写 b 不一致。
// 规则：
// - 末位小写 b：直接视为新码制后缀，保留小写 b，主体转大写；
// - 末位大写 B：若整体匹配旧 M 码（B + 7 位字符集 [23456789ABCDEFGHJKMNPQRSTUVWXYZ]，全大写），
//   视为旧 M 码保持大写不动；否则视为新码制后缀被误转大写，转回小写 b；
// - 其他：统一转大写。
function normalizeParentCourseCode(code = "") {
  const trimmed = String(code || "").replace(/\s+/g, "").trim();
  if (!trimmed) {
    return "";
  }
  const last = trimmed.slice(-1);
  // 末位小写 b：视为新码制后缀，保留小写 b，主体（机构代码 + 序号）转大写
  if (last === "b") {
    return trimmed.slice(0, -1).toUpperCase() + ORG_M_CODE_SOURCE_SUFFIX_FROM_B;
  }
  // 末位大写 B：先判旧 M 码，是旧 M 码保持全大写；否则视作新码制后缀转回小写 b
  if (last === "B") {
    const upperTrimmed = trimmed.toUpperCase();
    const isLegacyMCode = upperTrimmed.length === 8
      && /^B[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$/.test(upperTrimmed);
    if (isLegacyMCode) {
      return upperTrimmed;
    }
    return trimmed.slice(0, -1).toUpperCase() + ORG_M_CODE_SOURCE_SUFFIX_FROM_B;
  }
  return trimmed.toUpperCase();
}

// 新增（2026-09-16）：机构序号格式化 —— 从 001 开始左补 0；
// 调整（2026-09-16 三次定版·最终版）：课程码总长恒 8 位，序号位数 = 8 - 机构代码位数 - 1(来源后缀)，
// 机构代码越短序号位数越多（XING→001 三位、XYAO→011 三位、AB→00002 五位）；超出位数上限回绕复用，撞码由唯一性重试兜底。
const ORG_M_CODE_TOTAL_LENGTH = 8;
function formatOrgMCodeSeq(seq = 1, orgPrefix = "") {
  const seqWidth = Math.max(1, ORG_M_CODE_TOTAL_LENGTH - String(orgPrefix || "").length - 1);
  const safeSeq = Number(seq);
  const base = Number.isFinite(safeSeq) && safeSeq >= 1 ? Math.floor(safeSeq) : 1;
  const maxSeq = Math.pow(10, seqWidth) - 1;
  return String(((base - 1) % maxSeq) + 1).padStart(seqWidth, "0");
}

// 新增（2026-09-16）：生成机构口径的唯一课程码 = 机构代码前 4 位 + 4 位序号（该机构第 N 个约课用户，从 0001 叠加）。
// 序号计数口径：订单 m_code_org_invite 字段等于当前机构邀请码的历史订单数 + 1（只统计新码制订单，
// 旧「B + 7 位随机」订单不占序号，保证切换后第一个用户从 0001 开始）；
// 并发/撞码时序号递增重试（最多 10 次），仍冲突则返回空串，由调用方退回原随机码方案，不阻塞建单。
// 调整（2026-09-16 二次定版）：课程码改为 9 位 —— 机构代码(4) + 序号(4) + 小写来源后缀 b(1)，
// 如 xing0001b、00ab0001b；12 位接取码体系同步升级为双长度兼容（旧 12 = 8+4 / 新 13 = 9+4）。
// 修正（2026-09-16 三次定版·终版确认）：课程码回归恒长 8 位 —— 机构代码(≤4 位，大写放开头不补 0)
// + 序号(动态补位，从 001 起左补 0) + 小写来源后缀 b(1)，如 XING001b、XYAO011b、AB00002b；
// 完整接取码回归 12 位（8+4），13 位拆分分支仅作历史过渡兼容保留。
async function generateOrgSequenceParentCourseCode(orderCollection = "", invitationCode = "") {
  const orgPrefix = buildOrgCodePrefix(invitationCode);
  const safeInviteCode = normalizeInviteCode(invitationCode);
  if (!orderCollection || !orgPrefix || !safeInviteCode) {
    return "";
  }

  let seq = 1;
  try {
    const countRes = await db.collection(orderCollection)
      .where({ m_code_org_invite: safeInviteCode })
      .count();
    seq = (Number(countRes && countRes.total) || 0) + 1;
  } catch (error) {
    console.warn("[twowaybinding_1_DLforC][WARN] org seq count failed, start from 0001:", error && error.message);
    seq = 1;
  }

  for (let i = 0; i < M_CODE_GENERATE_MAX_RETRY; i += 1) {
    // 调整（2026-09-16 二次定版）：码尾追加小写来源后缀 b（家长 B 端约课标记）
    // 调整（2026-09-16 三次定版·最终版）：机构代码大写放开头不补 0，序号动态补位使总长恒 9 位
    // 修正（2026-09-16 终版确认）：总长恒 8 位（上一行"9 位"为笔误），示例 XING001b、AB00002b
    const candidate = `${orgPrefix}${formatOrgMCodeSeq(seq, orgPrefix)}${ORG_M_CODE_SOURCE_SUFFIX_FROM_B}`;
    const occupied = await isParentCourseCodeOccupied(orderCollection, candidate);
    if (!occupied) {
      return candidate;
    }
    seq += 1;
  }

  console.warn("[twowaybinding_1_DLforC][WARN] org sequence code conflict after max retry", {
    orgPrefix,
    inviteCode: safeInviteCode,
  });
  return "";
}

function buildSchedule(classCount = DEFAULT_CLASS_COUNT) {
  const safeClassCount = Number(classCount || DEFAULT_CLASS_COUNT) || DEFAULT_CLASS_COUNT;
  const schedule = [];

  for (let lessonNum = 1; lessonNum <= safeClassCount; lessonNum += 1) {
    schedule.push({
      lesson: lessonNum,
      logs: [],
    });
  }

  return schedule;
}

function buildTargetSnapshot(event = {}) {
  const rawTargetSnapshot = parseJsonLike(event.targetSnapshot, {});
  return {
    inviteCode: String(rawTargetSnapshot.inviteCode || event.inviteCode || "").trim(),
    targetType: String(rawTargetSnapshot.targetType || "").trim(),
    displayName: String(rawTargetSnapshot.displayName || "").trim(),
    description: String(rawTargetSnapshot.description || "").trim(),
    pageTitle: String(rawTargetSnapshot.pageTitle || "").trim(),
    coachName: String(rawTargetSnapshot.coachName || "").trim(),
    organizationName: String(rawTargetSnapshot.organizationName || "").trim(),
    themeColor: String(rawTargetSnapshot.themeColor || "").trim(),
  };
}

async function getOrganizationDocByInviteCode(inviteCode = "", envVersion = "develop") {
  const safeInviteCode = normalizeInviteCode(inviteCode);
  if (!safeInviteCode) {
    return null;
  }

  const organizationCollection = getCollectionName(ORGANIZATION_COLLECTION_BASE, envVersion);
  const res = await db.collection(organizationCollection).where({
    "organization_basic.invitation_code": safeInviteCode,
  }).limit(1).get();

  return Array.isArray(res.data) && res.data.length ? res.data[0] : null;
}

// A 侧把识别码解释成统一 target 卡片，给 B 侧识别页和提交前校验共用。
// 这样即使 B 侧本地缓存还没补齐，也能直接以 A 侧真实机构数据为准。
function buildTargetCardFromOrganization(organizationDoc = {}, inviteCode = "") {
  const organizationBasic = (organizationDoc && organizationDoc.organization_basic) || {};
  const displayName = String(organizationBasic.organization_name || "").trim() || "未命名机构";
  const ownerNickname = String(
    organizationBasic.owner_nickname ||
    organizationBasic.owner_name ||
    organizationBasic.owner_real_name ||
    ""
  ).trim();

  return {
    inviteCode: normalizeInviteCode(inviteCode || organizationBasic.invitation_code || ""),
    targetType: "org",
    displayName,
    description: ownerNickname
      ? `识别成功，当前将进入 ${displayName}，由 ${ownerNickname} 负责承接。`
      : `识别成功，当前将进入 ${displayName}。`,
    pageTitle: `${displayName} - 家长约课登记`,
    coachName: ownerNickname,
    organizationName: displayName,
    themeColor: "#2f6bff",
    // 新增（B 侧家长端「机构展示页」改版，2026-09-05）：
    // 把 A 侧机构主键 organization_id 与入口二维码 entryId 一并回给 B，
    // B 侧机构展示页据此调 DLforP_entry_qrcode/get_org_show 拉取 dev_forPshowC 完整展示文档
    // （品牌轮播图 / 教练成员 / 城市地址等）；未生成入口二维码时 entryId 为空串，B 侧会用 organizationId 直查。
    organizationId: String(organizationBasic.organization_id || "").trim(),
    entryId: String(
      (organizationDoc && organizationDoc.entry_qrcode && organizationDoc.entry_qrcode.entryId) || ""
    ).trim(),
  };
}

async function resolveInviteOnA(event = {}, envVersion = "develop") {
  const inviteCode = normalizeInviteCode(event.inviteCode);
  if (!inviteCode) {
    return {
      success: false,
      code: 1,
      message: "请先填写识别码",
    };
  }

  const organizationDoc = await getOrganizationDocByInviteCode(inviteCode, envVersion);
  if (!organizationDoc) {
    return {
      success: false,
      code: 1,
      message: "识别码不存在",
    };
  }

  return {
    success: true,
    code: 0,
    message: "识别码有效",
    target: buildTargetCardFromOrganization(organizationDoc, inviteCode),
  };
}

async function findExistingImportedOrder(fromBFormId = "", envVersion = "develop") {
  const safeFromBFormId = String(fromBFormId || "").trim();
  if (!safeFromBFormId) {
    return null;
  }

  const orderCollection = getCollectionName(ORDER_COLLECTION_BASE, envVersion);
  const res = await db.collection(orderCollection).where({
    source: SOURCE_FROM_B_PARENT,
    from_b_form_id: safeFromBFormId,
  }).limit(1).get();

  return Array.isArray(res.data) && res.data.length ? res.data[0] : null;
}

function buildImportedOrder(event = {}, organizationDoc = null, envVersion = "develop") {
  const now = new Date();
  const inviteCode = normalizeInviteCode(event.inviteCode);
  const phone = normalizePhone(event.contact || event.phone || "");
  const location = String(event.location || "").trim();
  const frequency = String(event.frequency || "").trim();
  const note = String(event.note || "").trim();
  // 新增：与 NEWDL_execution_order / publish.js 保持同一套规范：
  // - 课程标题保持原来路线，直接用 targetSnapshot.pageTitle / displayName，不改成固定「悦动邻 - 家长约课登记」；
  // - 课程备注(teaching_record.description)统一前置加一行「悦动邻 - 家长约课登记导入」，且已带标识时不重复拼接。
  const IMPORT_TAG_LINE = "悦动邻 - 家长约课登记导入";
  const needTag = note && note.indexOf(IMPORT_TAG_LINE) !== 0;
  const description = needTag
    ? `${IMPORT_TAG_LINE}\n${note}`
    : (note || IMPORT_TAG_LINE);
  const targetSnapshot = buildTargetSnapshot(event);
  const childProfiles = normalizeChildProfiles(parseJsonLike(event.childProfiles, []));
  const firstChild = childProfiles[0] || {
    nickname: String(event.childName || "").trim(),
    age: String(event.childAge || "").trim(),
    gender: "",
    height: "",
    weight: "",
  };
  const classCount = Number(event.class_count || DEFAULT_CLASS_COUNT) || DEFAULT_CLASS_COUNT;
  // 新增：优先采用 B 侧（DLforP__do）透传过来的 fulfill_state，
  // 合法值只接受 editing / awaiting / in_progress；其它任何值或空值一律兜底 editing。
  // 家长提交的桥接课程默认就是"待编辑"态，确保 A 端教练/管理层能正常编辑班级信息与课节，
  // 不再写死为 pending 导致 publish.js 阶段判断不在 editing/awaiting 范围内而权限全锁。
  // 白名单（editing / awaiting / in_progress）与兜底值统一由 _shared/courseState.js 提供，
  // 本函数不再自己维护一份状态字面量。
  const normalizedFulfillState = normalizeIncomingState(event.fulfill_state);
  const organizationBasic = (organizationDoc && organizationDoc.organization_basic) || {};
  const ownerOpenid = String(organizationBasic.owner_openid || "").trim();
  const ownerUserId = String(organizationBasic.owner_user_id || "").trim();
  // 修复（2026-09-16）：改用 normalizeParentCourseCode 保留末尾小写 b 后缀，
  // 避免 toUpperCase 把 B 侧传来的 "SZDX001b" 误转成 "SZDX001B" 写入 A 端三字段。
  const parentCourseCode = normalizeParentCourseCode(event.parent_course_code || "");
  const orderOrgInfo = normalizeOrderOrganizationInfo({
    orgId: organizationBasic.organization_id || "",
    orgName: organizationBasic.organization_name || "",
    memberRole: organizationDoc ? "admin" : "",
    inviteCode,
  });
  const title = String(targetSnapshot.pageTitle || targetSnapshot.displayName || "家长转交课程").trim() || "家长转交课程";

  return {
    order_base_info: {
      acceptorId: ownerUserId,
      acceptorOpenid: ownerOpenid,
      publisher_Id: ownerUserId,
      publisher_openid: ownerOpenid,
      create_time: now.toISOString(),
      createdAt: now,
      updatedAt: now,
    },
    child_profile: {
      nickname: firstChild.nickname || "",
      age: firstChild.age || "",
      gender: firstChild.gender || "",
      height: firstChild.height || "",
      weight: firstChild.weight || "",
    },
    child_profiles: childProfiles,
    teaching_record: {
      category: "家长转交",
      title,
      description: description,
      course_plan: "本单由小程序B家长端提交后直接进入小程序A，后续由教练继续跟进。",
    },
    course_config: {
      class_count: classCount,
      frequency,
      course_size_mode: "1对1",
    },
    coach_private: {
      price_interval: "",
      coach_private_note: "本单由 twowaybinding_1_DLforC 直接导入",
    },
    course_basic_info: {
      safety_confirmed: false,
      location,
      contact: phone,
      latitude: typeof event.latitude === "undefined" ? null : event.latitude,
      longitude: typeof event.longitude === "undefined" ? null : event.longitude,
    },
    course_flow_info: {
      allow_transfer_to_other_coach: false,
      publish_type: "发布看看",
      publish_state: "bridged_from_b",
      // 修复：桥接课程默认 fulfill_state 改为从 B 侧传来的 normalizedFulfillState（兜底 editing），
      // 不再硬写 pending，确保 A 端 publish.js / progress.js 的阶段权限判断正确落在 editing/awaiting。
      fulfill_state: normalizedFulfillState,
      // 新增（2026-10-09 · 课程流转 T4）：桥接建单补一条起点记录，否则这单在 owner 的日志链上「无始」。
      // 纯新增字段，不改动上面任何现有赋值。
      state_transition_log: [
        {
          from: "",
          to: normalizedFulfillState,
          at: now,
          actor: { role: ACTOR_ROLE.SYSTEM, userId: "", openid: "" },
          role: ACTOR_ROLE.SYSTEM,
          reason: "created:twowaybinding_from_b",
        },
      ],
      progress_total: classCount,
      progress_done: 0,
      schedule: buildSchedule(classCount),
      history_sync: null,
    },
    share_visibility: {
      entry_logs: [],
    },
    order_org_info: orderOrgInfo,
    other_info: {
      userInfo: {
        nickName: String(event.parentName || "家长提交").trim() || "家长提交",
        avatarUrl: "",
      },
      publisherInfo: {
        nickName: String(event.parentName || "家长提交").trim() || "家长提交",
        avatarUrl: "",
      },
      usertoken: "",
      group_rules: "",
      imported_parent_name: String(event.parentName || "").trim(),
      imported_phone: phone,
      imported_parent_course_code: parentCourseCode,
      imported_target_snapshot: targetSnapshot,
      imported_from_env: envVersion,
    },
    orgId: orderOrgInfo.orgId || "",
    orgName: orderOrgInfo.orgName || "",
    orgMemberRole: orderOrgInfo.memberRole || "",
    source: SOURCE_FROM_B_PARENT,
    inviteCode,
    from_b_form_id: String(event.from_b_form_id || "").trim(),
    from_b_course_id: String(event.from_b_course_id || "").trim(),
    from_b_openid: String(event.from_b_openid || "").trim(),
    // 新增：情况1 twowaybinding_1_DLforC 路径也统一写三份课程码，
    // 保证 A 管理列表 (joinCode)、协作查询老链路 (courseCode)、B 家长展示 (parent_course_code) 读取完全一致。
    joinCode: parentCourseCode,
    courseCode: parentCourseCode,
    parent_course_code: parentCourseCode,
    // 新增（2026-09-16）：机构新码制标记 —— 记录本单课程码归属的机构邀请码（大写标准化）。
    // 仅使用「机构代码 + 序号」新码制时写入；序号生成按该字段计数（该机构第 N 个用户从 0001 叠加），
    // 随机码兜底单此字段为空、不参与计数。
    m_code_org_invite: normalizeInviteCode(event.m_code_org_invite || ""),
    imported_target_snapshot: targetSnapshot,
    createdAt: now,
    updatedAt: now,
  };
}

// 兼容旧订单：如果之前已经导入过，但当时还没有按 M 码规范生成 B 前缀 8 位码，
// 这里补生成一次并回写 A 侧订单三份字段，保证新老接口读取一致。
async function ensureParentCourseCodeOnOrder(orderCollection = "", orderDoc = {}) {
  const orderId = String(orderDoc && orderDoc._id || "").trim();
  if (!orderCollection || !orderId) {
    return "";
  }

  // 新增：从老订单兼容字段拼一个当前在用的码；joinCode/courseCode/parent_course_code 任一有值即可复用。
  // 修复（2026-09-16）：避免直接 .toUpperCase() 破坏新码制末尾小写 b 后缀。
  // 先用旧 M 码正则判断是否为旧 M 码（B + 7 位大写字符集），是则保持大写；
  // 否则用 normalizeParentCourseCode 保留新码制小写 b 后缀，
  // 避免已存的 "SZDX001b" 被误转大写 B 后判定为非法码、再被重新生成覆盖。
  const rawExistedCode = String(
    orderDoc.parent_course_code
    || orderDoc.courseCode
    || orderDoc.joinCode
    || (((orderDoc.other_info || {}).imported_parent_course_code))
    || ""
  ).trim();
  const upperExistedCode = rawExistedCode.toUpperCase();
  const isLegacyMCode = /^B[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$/.test(upperExistedCode);
  const existedCode = isLegacyMCode ? upperExistedCode : normalizeParentCourseCode(rawExistedCode);

  // 新增：如果现有码已经符合 M 码规范（B 前缀 + 7 位合法字符），就直接返回，不再改历史值。
  const isValidMCode = /^B[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$/.test(existedCode);
  if (isValidMCode) {
    return existedCode;
  }

  // 修复（2026-09-16）：如果现有码已是新码制（1-4 位字母 + 数字序号 + 末位小写 b 后缀），
  // 也直接返回，不再重新生成覆盖原码，避免破坏已绑定的家长课程码。
  const isValidNewOrgCode = /^[A-Z]{1,4}\d+b$/.test(existedCode);
  if (isValidNewOrgCode) {
    return existedCode;
  }

  // 新增：老订单没有 M 码 → 生成一条新的 B 前缀码并统一写 joinCode/courseCode/parent_course_code，
  // 让 A 管理列表、协作查询、B 家长展示都能走新规范。
  const nextParentCourseCode = await ensureUniqueParentCourseCode(orderCollection);
  if (!nextParentCourseCode) {
    return existedCode;
  }

  await db.collection(orderCollection).doc(orderId).update({
    data: {
      parent_course_code: nextParentCourseCode,
      courseCode: nextParentCourseCode,
      joinCode: nextParentCourseCode,
      "other_info.imported_parent_course_code": nextParentCourseCode,
      updatedAt: new Date(),
    },
  });

  return nextParentCourseCode;
}

function tryParseJsonText(text = "") {
  const safeText = String(text || "").trim();
  if (!safeText) {
    return {};
  }

  try {
    return JSON.parse(safeText);
  } catch (error) {
    return {};
  }
}

function collectRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", reject);
  });
}

function buildHttpEvent(req, rawBody = "") {
  const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
  const queryObject = Object.fromEntries(requestUrl.searchParams.entries());
  const bodyObject = tryParseJsonText(rawBody);

  return {
    ...queryObject,
    ...(bodyObject && typeof bodyObject === "object" && !Array.isArray(bodyObject) ? bodyObject : {}),
    rawBody,
    httpMethod: String(req.method || "GET").toUpperCase(),
    requestPath: requestUrl.pathname,
    headers: req.headers || {},
  };
}

function writeJson(res, statusCode = 200, data = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(data));
}

async function handleMain(event = {}, context = {}) {
  const action = String(event.action || "").trim();
  const envVersion = String(event.envVersion || "develop").trim() || "develop";

  console.log("[twowaybinding_1_DLforC][INFO] main.start", {
    action,
    envVersion,
    hasContext: !!context,
    event,
  });

  try {
    if (action === ACTION_RESOLVE_INVITE) {
      return await resolveInviteOnA(event, envVersion);
    }

    if (action !== ACTION_SYNC_PARENT_BOOKING_TO_A) {
      return {
        success: false,
        code: 404,
        message: "不支持的操作类型",
      };
    }

    const phone = normalizePhone(event.contact || event.phone || "");
    const location = String(event.location || "").trim();
    if (!isValidPhone(phone)) {
      return {
        success: false,
        code: 1,
        message: "请填写正确的11位手机号",
      };
    }

    if (!location) {
      return {
        success: false,
        code: 1,
        message: "缺少上课地点",
      };
    }

    // 识别码改为必填：必须确保订单归属到特定教练或机构，避免入库后成为无主订单，A侧无人处理。
    const inviteCode = normalizeInviteCode(event.inviteCode);
    if (!inviteCode) {
      return {
        success: false,
        code: 1,
        message: "请先填写识别码",
      };
    }

    const existingOrder = await findExistingImportedOrder(event.from_b_form_id, envVersion);
    if (existingOrder) {
      const orderCollection = getCollectionName(ORDER_COLLECTION_BASE, envVersion);
      const parentCourseCode = await ensureParentCourseCodeOnOrder(orderCollection, existingOrder);
      return {
        success: true,
        code: 0,
        message: "订单已存在，直接返回已有记录",
        orderId: existingOrder._id,
        a_order_id: existingOrder._id,
        // 新增：B 侧抽取兼容 9 级位置；这里同时传顶层三份 + data 嵌套，
        // 保证旧版 / 新版 B 侧桥接结果解析都能拿到家长 M 码。
        parent_course_code: parentCourseCode,
        joinCode: parentCourseCode,
        courseCode: parentCourseCode,
        data: {
          parent_course_code: parentCourseCode,
          joinCode: parentCourseCode,
          courseCode: parentCourseCode,
        },
      };
    }

    // 调用时复用已经规范化的 inviteCode，避免重复处理；同时加上识别码有效性二次校验，
    // 保证入库的订单一定能正确归属到对应的机构或自由教练名下，不产生"孤儿订单"。
    const organizationDoc = await getOrganizationDocByInviteCode(inviteCode, envVersion);
    if (!organizationDoc) {
      return {
        success: false,
        code: 1,
        message: "识别码对应的机构或教练不存在",
      };
    }
    const orderCollection = getCollectionName(ORDER_COLLECTION_BASE, envVersion);
    // 新增：情况1 twowaybinding_1_DLforC 先拿到唯一的 B 前缀 M 码，再一次性插入订单；
    // 避免原实现的「插单后再反写」造成的 joinCode/courseCode 空窗期。
    // 调整（2026-09-16）：机构约课改用新码制「机构代码前 4 位 + 4 位序号（从 0001 叠加）」——
    // 机构代码取机构文档 organization_basic.invitation_code（超出 4 位取前 4 位，不足右侧补 0），
    // 本机构第一个用户 0001、第二个用户 0002，依次叠加；新码制失败/冲突时退回原 B 前缀随机码，建单永不阻塞。
    const organizationBasicForCode = (organizationDoc && organizationDoc.organization_basic) || {};
    const orgInvitationCode = normalizeInviteCode(organizationBasicForCode.invitation_code || "");
    const orgSequenceCode = orgInvitationCode
      ? await generateOrgSequenceParentCourseCode(orderCollection, orgInvitationCode)
      : "";
    const parentCourseCode = orgSequenceCode || (await ensureUniqueParentCourseCode(orderCollection));
    const orderData = buildImportedOrder({
      ...event,
      parent_course_code: parentCourseCode,
      joinCode: parentCourseCode,
      courseCode: parentCourseCode,
      // 新增（2026-09-16）：仅当本单实际使用机构新码制时才传标记，随机码兜底单不传，避免序号计数被污染
      m_code_org_invite: orgSequenceCode ? orgInvitationCode : "",
    }, organizationDoc, envVersion);
    const addRes = await db.collection(orderCollection).add({
      data: orderData,
    });

    console.log("[twowaybinding_1_DLforC][INFO] main.success", {
      action,
      envVersion,
      orderId: addRes._id,
      inviteCode,
      parentCourseCode,
    });

    return {
      success: true,
      code: 0,
      message: "B 侧订单已通过 twowaybinding_1_DLforC 直接入库 A",
      orderId: addRes._id,
      a_order_id: addRes._id,
      // 新增：返回和大云函数一致的字段位置，B 侧无需区分走的是哪条桥链路
      parent_course_code: parentCourseCode,
      joinCode: parentCourseCode,
      courseCode: parentCourseCode,
      data: {
        parent_course_code: parentCourseCode,
        joinCode: parentCourseCode,
        courseCode: parentCourseCode,
      },
    };
  } catch (error) {
    console.error("[twowaybinding_1_DLforC][ERROR] main.fail", {
      action,
      message: error && (error.message || error.errMsg) || String(error),
      stack: error && error.stack || "",
    });
    return {
      success: false,
      code: 500,
      message: "twowaybinding_1_DLforC 执行失败",
      errorMessage: error && (error.message || error.errMsg) || String(error),
    };
  }
}

// 兼容保留普通云函数调用方式，避免已有调用方在本地调试时直接失效。
exports.main = handleMain;

// HTTP 云函数模式下，直接在 9000 端口起一个最小服务，把请求转给现有业务函数。
if (require.main === module) {
  const port = Number(process.env.PORT || 9000) || 9000;

  const server = http.createServer(async (req, res) => {
    try {
      const method = String(req.method || "GET").toUpperCase();
      const requestUrl = new URL(req.url || "/", "http://127.0.0.1");

      // HTTP 请求一进来就先记日志，避免探活请求被误以为“没有触发函数”。
      console.log("[twowaybinding_1_DLforC][INFO] http.request", {
        method,
        path: requestUrl.pathname,
        search: requestUrl.search || "",
      });

      if (method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "content-type, authorization",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        });
        res.end();
        return;
      }

      // GET 根路径且没有业务参数时，才返回启动探活信息；
      // 如果 GET 已经带了 query（例如 action=syncParentBookingToA），就继续走下面的业务逻辑。
      if (
        requestUrl.pathname === "/health" ||
        (requestUrl.pathname === "/" && method === "GET" && !requestUrl.search)
      ) {
        // 探活分支单独留痕，方便区分“只是探活”还是“真正业务调用”。
        console.log("[twowaybinding_1_DLforC][INFO] http.health", {
          method,
          path: requestUrl.pathname,
        });
        writeJson(res, 200, {
          success: true,
          code: 0,
          message: "twowaybinding_1_DLforC HTTP 云函数已启动",
        });
        return;
      }

      const rawBody = method === "POST" ? await collectRequestBody(req) : "";
      const event = buildHttpEvent(req, rawBody);
      const result = await handleMain(event, {});
      writeJson(res, 200, result);
    } catch (error) {
      console.error("[twowaybinding_1_DLforC][ERROR] http.fail", {
        message: error && (error.message || error.errMsg) || String(error),
        stack: error && error.stack || "",
      });
      writeJson(res, 500, {
        success: false,
        code: 500,
        message: "twowaybinding_1_DLforC HTTP 服务执行失败",
        errorMessage: error && (error.message || error.errMsg) || String(error),
      });
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log("[twowaybinding_1_DLforC][INFO] http.listen", {
      port,
    });
  });
}
