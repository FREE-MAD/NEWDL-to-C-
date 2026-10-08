// pages/task/publish/publish_pdd/publish_pdd.js
// ============================================================
// 拆分说明（2026-09-20）：publish 页面按表单提交职责拆分为三个独立组件：
//   - components/form-submit/publish_classcreate  （创建班课程 tab）
//   - components/form-submit/publish_dailysummary （每日总结 tab）
//   - components/form-submit/publish_classoff     （结课 tab）
// 本页面保留为「壳」：负责顶部 Tab 切换、流转 tab（说明 Banner/协作码/接取码/权限卡）、
// 课节管理弹窗、订单详情拉取与权限计算，并通过 properties 把数据下发给三个组件，
// 通过 triggerEvent 接收组件回传事件（发布完成/结课/打开弹窗等）。
// ============================================================
const app = getApp();
const { isCourseCreatorRole, BIZ_ROLE_ORG_ADMIN } = require('../../../utils/bizRole');

// 旧课节状态文案映射保留注释，不删除；当前链路已不再依赖“开始上课/下课”状态推进
// const LESSON_STATUS_TEXT_MAP = {
//   PENDING: '待上课',
//   COACH_READY: '待确认',
//   PARENT_CONFIRMED: '上课中',
//   COMPLETED_BY_COACH: '已下课',
//   COMPLETED_BY_PARENT: '已下课',
//   DONE: '已完成'
// };

Page({
  bannerBoxTimer: null,

  data: {
    statusBarHeight: 0,
    topSafe: 0,
    selectedTab: 'create',
    orderId: '',
    isEditMode: false,
    // order 整体下发给 classcreate 组件（其 observer 调用 applyOrderToForm 回填表单）
    order: {
      title: '',
      category: '',
      description: '',
      location: '',
      price_interval: '',
      schedule: []
    },
    // schedule / displaySchedule 下发给 dailysummary 组件
    schedule: [],
    displaySchedule: [],

    showCover: false,

    // 教练接取码相关展示字段
    pickupCourseCode: '',
    pickupFullCode: '',
    assignedCoachName: '',
    assignedCoachAt: '',
    stateHistory: [],
    currentStateSuffix: '',
    displayPickupCode: '',

    flowProgressStep: 1,
    pageAccessMode: 'manager',
    pageAccessLabel: '创建者',
    pagePermissionRows: [],
    canViewCreateTab: true,
    canViewManageTab: false,
    canViewFlowTab: false,
    canViewSummaryTab: false,
    canViewCloseTab: false,
    canEditCourseInfo: true,
    canDeleteCourse: true,
    canOperatePickupCode: false,
    canAdjustLessonPlan: false,
    canWriteSummary: false,
    canCloseCourse: false,
    hasAssignedCoach: false,
    explicitFulfillState: 'editing',
    courseInfoReady: false,
    hasGeneratedPickupCode: false,
    confirmPublishLoading: false,
    canMarkCourseInfoReady: false,
    canGeneratePickupCode: false,
    canResetPickupCode: false,
    // 【2026-09-21 新流程·接取需管理确认】绑定申请相关初始字段
    // coachBindingRequests：从 order 顶层/ course_flow_info.coach_binding_requests 读取的申请列表；
    // hasPendingCoachRequest / pendingCoachRequestCount：派生展示字段，控制流转 tab 卡片是否渲染；
    // myPendingRequest：当前用户在 pending 列表里的那条（教练视角看「待确认」状态用）；
    // canConfirmCoachBinding / canRejectCoachBinding：管理者在 awaiting 且有 pending 时为 true。
    coachBindingRequests: [],
    pendingCoachBindingRequests: [],
    hasPendingCoachRequest: false,
    pendingCoachRequestCount: 0,
    myPendingRequest: null,
    canConfirmCoachBinding: false,
    canRejectCoachBinding: false,
    // 操作中锁：避免重复点击确认/拒绝按钮导致并发写入
    coachBindingActionLoading: false,

    // 协作码相关（流转 tab 使用）
    collaborationCode: '',
    collaborationLoading: false,
    collaborationMatchedOrderId: '',
    collaborationParentName: '',
    collaborationChildCount: 0,
    collaborationLocationText: '',
    collaborationContactText: '',
    collaborationCardLocked: false,
    // 协作导入的表单数据：下发给 classcreate 组件，由其 observer 合并到内部 form
    collaborationFormData: null,
    // 协作导入的 B 端追踪字段：下发给 classcreate 组件，发布时透传到新订单
    collaborationTrace: {
      collaborationCode: '',
      collaborationMatchedOrderId: '',
      collaborationOriginalFromBCourseId: '',
      collaborationOriginalFromBFormId: '',
      collaborationOriginalFromBOpenid: '',
      collaborationOriginalSource: '',
      collaborationOriginalBridgeStatus: '',
      collaborationOriginalParentCourseCode: '',
      collaborationOriginalMatchedCourseCode: ''
    },

    isSubmitting: false,
    showSyncModal: false,
    showSetTotalModal: false,
    showBannerBoxExpanded: true,
    setTotalLessonsInput: '1',
    syncTotalLessonsInput: '1',
    syncHistoryCountInput: '0',
    lessonPlanLocked: false,
    lessonPlanLockText: '',
    // 结课初始值：下发给 classoff 组件
    closeSummaryInput: '',
    closeCoachNoteInput: ''
  },

  onLoad(options) {
    // 新增：用官方推荐的 wx.getWindowInfo 取代已弃用的 wx.getSystemInfoSync，
    // 只取需要的状态栏高度（statusBarHeight）做安全区适配，避免再打 deprecated 警告。
    let statusBarHeight = 20;
    try {
      if (typeof wx.getWindowInfo === 'function') {
        const windowInfo = wx.getWindowInfo();
        if (windowInfo && typeof windowInfo.statusBarHeight === 'number') {
          statusBarHeight = windowInfo.statusBarHeight;
        }
      } else if (typeof wx.getSystemInfoSync === 'function') {
        const info = wx.getSystemInfoSync();
        if (info && typeof info.statusBarHeight === 'number') {
          statusBarHeight = info.statusBarHeight;
        }
      }
    } catch (err) {
      console.warn('[publish] onLoad 获取 statusBarHeight 异常，使用默认值：', err);
    }
    const h = statusBarHeight + 40;
    const targetOrderId = options.id || options.taskId || '';
    const selectedTab = options.tab || 'create';
    this.setData({
      statusBarHeight,
      topSafe: h,
      selectedTab: targetOrderId ? selectedTab : 'create'
    });

    if (!targetOrderId && !this.hasCoachCreatePermission()) {
      if (app.resolveUserRoleByBusiness) {
        wx.showLoading({ title: '识别身份中...' });
        app.resolveUserRoleByBusiness(true).then(nextRole => {
          wx.hideLoading();
          if (nextRole === 'C') {
            return;
          }
          wx.showToast({ title: '仅自由教练或机构管理层可创建课程', icon: 'none' });
          setTimeout(() => { wx.switchTab({ url: '/pages/index/index' }); }, 600);
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '仅自由教练或机构管理层可创建课程', icon: 'none' });
          setTimeout(() => { wx.switchTab({ url: '/pages/index/index' }); }, 600);
        });
        return;
      }
      wx.showToast({ title: '仅自由教练或机构管理层可创建课程', icon: 'none' });
      setTimeout(() => { wx.switchTab({ url: '/pages/index/index' }); }, 600);
      return;
    }

    if (!targetOrderId && (selectedTab === 'manage' || selectedTab === 'summary' || selectedTab === 'close')) {
      wx.showToast({ title: '请先进入已有班级', icon: 'none' });
    }

    if (targetOrderId) {
      this.setData({ orderId: targetOrderId, isEditMode: true });
      this.fetchOrderDetails(targetOrderId);
    }
  },

  onShow() {
    this.refreshBannerBoxCollapse();
    // 从详情页返回时刷新订单数据，保证课节/总结最新
    if (this.data.orderId) {
      this.fetchOrderDetails(this.data.orderId);
    }
  },

  onHide() {
    this.clearBannerBoxTimer();
  },

  onUnload() {
    this.clearBannerBoxTimer();
  },

  hasCoachCreatePermission() {
    const businessIdentity = app.getBusinessIdentity ? app.getBusinessIdentity() : null;
    if (businessIdentity) {
      return isCourseCreatorRole(businessIdentity.bizRole);
    }
    const appRole = app.globalData.userRole || wx.getStorageSync('userRole') || 'V';
    return appRole === 'C';
  },

  buildPagePermissionRows(accessState = {}) {
    const stageIsManagerialEditable = !!accessState.stageIsManagerialEditable;
    const stageIsInProgress = !!accessState.stageIsInProgress;
    const courseInfoReady = !!accessState.courseInfoReady;
    // 【2026-09-21 新流程·接取需管理确认】从 accessState 读出申请相关派生字段，
    // 用于给管理者多挂一行提示、给申请中的教练单独走一条分支展示「待确认」状态。
    const hasPendingCoachRequest = !!accessState.hasPendingCoachRequest;
    const pendingCoachRequestCount = Number(accessState.pendingCoachRequestCount) || 0;
    const myPendingRequest = accessState.myPendingRequest;
    if (accessState.pageAccessMode === 'executor') {
      return [
        { label: '当前身份', value: '执行教练（本人接取）' },
        { label: '可以操作', value: '查看资料、课节；填写每日总结；提交结课。' },
        { label: '不可操作', value: '改资料/接取码/课表、删课均不可；课程资料接取后锁定为只读。' }
      ];
    }
    // 【2026-09-21 新流程】申请接取中的教练（非已接取、非管理者、当前用户在 pending 列表）
    // 走单独分支，提示等待管理者在流转 tab 卡片确认；其他访客仍走原 readonly 分支。
    if (accessState.pageAccessMode === 'readonly' && myPendingRequest) {
      return [
        { label: '当前身份', value: '申请接取中的教练' },
        { label: '当前阶段', value: '【待管理者确认】你的接取申请已提交' },
        { label: '可以操作', value: '查看资料、课节；等待管理者在「流转」tab 确认。' },
        { label: '不可操作', value: '改资料/接取码/课表/总结、删课、结课均不可；确认前不能填写每日总结。' }
      ];
    }
    if (accessState.pageAccessMode === 'readonly') {
      return [
        { label: '当前身份', value: '只读查看者' },
        { label: '可以操作', value: '查看资料、课节、总结。' },
        { label: '不可操作', value: '改资料/接取码/课表/总结、删课、结课均不可。' }
      ];
    }
    if (stageIsManagerialEditable && !courseInfoReady) {
      return [
        { label: '当前身份', value: '课程发布者 / 管理层' },
        { label: '当前阶段', value: '【待编辑】尚未生成接取码' },
        { label: '可以操作', value: '编辑课程资料；课节管理（总课时/半途接入）；点击「完成创建，允许接单」生成接取码；未接取前可删课。' },
        { label: '不可操作', value: '生成接取码后 pl 码锁定不可改；删课仅待编辑阶段可操作。' }
      ];
    }
    if (stageIsManagerialEditable && courseInfoReady) {
      // 【2026-09-21 新流程】awaiting 且有 pending 申请时，多挂一行提示，
      // 引导管理者去「流转」tab 下方的绑定申请卡片操作确认/拒绝。
      const rows = [
        { label: '当前身份', value: '课程发布者 / 管理层' },
        { label: '当前阶段', value: accessState.stageIsAwaiting ? '【待接取】接取码已生成' : '【接取码已生成】' },
        { label: '可以操作', value: '编辑课程资料；课节管理；查看/复制接取码；重置接取码；未接取前可删课。' },
        { label: '不可操作', value: 'pl 码/接取码不可手动修改；进行中后资料与课节锁定。' }
      ];
      if (accessState.stageIsAwaiting && hasPendingCoachRequest) {
        rows.push({ label: '接取申请', value: `有 ${pendingCoachRequestCount} 个教练申请待确认，可在「流转」tab 下方卡片确认/拒绝。` });
      }
      return rows;
    }
    if (stageIsInProgress) {
      return [
        { label: '当前身份', value: '课程发布者 / 管理层' },
        { label: '当前阶段', value: '【进行中】管理者不可操作' },
        { label: '可以操作', value: '查看资料、课节、总结、结课信息（只读）。' },
        { label: '不可操作', value: '改资料/课表/接取码、删课均不可；每日总结与结课由执行教练填写/提交。' }
      ];
    }
    return [
      { label: '当前身份', value: '课程发布者 / 管理层' },
      { label: '当前阶段', value: accessState.hasAssignedCoach ? '【教练已接取】只读' : '【已完成/已关闭】只读' },
      { label: '可以操作', value: '查看资料、课节、总结、结课信息（只读）。' },
      { label: '不可操作', value: '改资料/课表/接取码、删课均不可；每日总结与结课由执行教练填写/提交。' }
    ];
  },

  resolveFlowProgressStep(assignedCoachName, infoReady, fulfillState) {
    // 【2026-09-21 新流程·接取需管理确认】语义调整说明（保持 1/2/3 三步视觉不变）：
    // step 2「等待教练接单」现在覆盖两种微状态：(a) awaiting 且无 pending 申请（教练还没来）；
    // (b) awaiting 且有 pending 申请（管理挑人中）。两种都返回 2，让进度条停在「等待教练接单」节点；
    // 中间态 (b) 的细节由流转 tab 下方的「绑定申请卡片」单独承载，避免改进度条布局加第 4 步带来的 CSS 风险。
    // 若未来要把 (b) 拆成独立第 4 步，把 hasPendingCoachRequest 作为第 5 个参数传进来，新增 return 4 即可。
    const coachTaken = String(assignedCoachName || '').trim() !== '';
    if (coachTaken || fulfillState === 'in_progress') return 3;
    if (infoReady || fulfillState === 'awaiting') return 2;
    return 1;
  },

  buildPageAccessState(orderData = {}) {
    const myOpenid = app.globalData.openid || wx.getStorageSync('openid') || '';
    const myToken = app.globalData.token || wx.getStorageSync('token') || '';
    const publisherOpenid = String(orderData.publisher_openid || '').trim();
    const publisherId = String(orderData.publisher_Id || '').trim();
    const assignedCoachToken = String(orderData.assignedCoachToken || orderData.assigned_coach_token || '').trim();
    const assignedCoachOpenid = String(orderData.assignedCoachOpenid || orderData.assigned_coach_openid || '').trim();
    const hasAssignedCoach = !!(assignedCoachToken || assignedCoachOpenid);
    const isOwner =
      (publisherOpenid && myOpenid && publisherOpenid === myOpenid)
      || (publisherId && myToken && publisherId === myToken);
    const isAssignedCoach =
      (assignedCoachToken && myToken && assignedCoachToken === myToken)
      || (assignedCoachOpenid && myOpenid && assignedCoachOpenid === myOpenid);
    const businessIdentity = app.getBusinessIdentity ? app.getBusinessIdentity() : null;
    const myBizRole = String(((businessIdentity && businessIdentity.bizRole) || app.globalData.bizRole || wx.getStorageSync('bizRole') || '')).trim();
    const myOrgProfile = (businessIdentity && businessIdentity.organizationProfile) || app.globalData.organizationProfile || wx.getStorageSync('organizationProfile') || {};
    const myOrgId = String((myOrgProfile && myOrgProfile.orgId) || '').trim();
    const orderOrgInfo = orderData.order_org_info || {};
    const orderOrgId = String(orderOrgInfo.orgId || orderData.orgId || '').trim();
    const isOrgAdminOfThisCourse = myBizRole === BIZ_ROLE_ORG_ADMIN && !!myOrgId && !!orderOrgId && myOrgId === orderOrgId;
    const isManagerialUser = isOwner || isOrgAdminOfThisCourse;
    const courseFlow = orderData.course_flow_info || {};
    const explicitFulfillState = String(courseFlow.fulfill_state || orderData.fulfill_state || orderData.status || 'editing').trim();
    const stageIsEditing = explicitFulfillState === 'editing';
    const stageIsAwaiting = explicitFulfillState === 'awaiting';
    const stageIsInProgress = explicitFulfillState === 'in_progress';
    const courseInfoReady = !!(orderData.course_info_ready_at || courseFlow.course_info_ready_at);
    const stageIsManagerialEditable = (stageIsEditing || stageIsAwaiting) && isManagerialUser;
    const canEditCourseInfo = (stageIsEditing || stageIsAwaiting) && isManagerialUser;
    const canDeleteCourse = stageIsEditing && isOwner && !hasAssignedCoach;
    const canAdjustLessonPlan = (stageIsEditing || stageIsAwaiting) && isManagerialUser;
    const canMarkCourseInfoReady = stageIsEditing && isManagerialUser && !courseInfoReady;
    const canGeneratePickupCode = stageIsEditing && isManagerialUser;
    const canResetPickupCode = stageIsManagerialEditable;
    const canOperatePickupCode = (canMarkCourseInfoReady || canGeneratePickupCode || canResetPickupCode);
    // 【2026-09-21 权限口径调整】以「教练是否已接取」为分界线：
    // 1) editing / awaiting（还没人接取）：课程尚未开课，「每日总结」与「结课」对所有角色都不开放；
    // 2) 教练接取后（已写 assignedCoach* 或已进入 in_progress）：两个 tab 对所有可访问该课程的角色开放「可读」；
    //    写入权只给执行教练本人（isAssignedCoach），管理层 / 机构 admin 只读不可写。
    const coachTaken = hasAssignedCoach || stageIsInProgress;
    const canWriteSummary = !!coachTaken && !!isAssignedCoach;
    const canCloseCourse = !!coachTaken && !!isAssignedCoach;
    // 【2026-09-21 新流程·接取需管理确认】读取 coach_binding_requests[]（顶层优先，回退 course_flow_info 内层）
    // pendingCount 决定是否在流转 tab 渲染「绑定申请卡片」+ 是否给管理者开放确认/拒绝按钮。
    const rawBindingRequests = Array.isArray(orderData.coach_binding_requests)
      ? orderData.coach_binding_requests
      : (Array.isArray(courseFlow.coach_binding_requests) ? courseFlow.coach_binding_requests : []);
    const coachBindingRequests = Array.isArray(rawBindingRequests) ? rawBindingRequests : [];
    const pendingCoachBindingRequests = coachBindingRequests.filter((r) =>
      r && String(r.status || '').toLowerCase() === 'pending'
    ).map((r) => {
      // 【2026-09-21 新流程】给每个 pending 申请挂一个 requestedAtText 字符串，
      // wxml 不能直接渲染 Date 对象，这里统一用 formatTime 转 "MM-DD HH:mm"；
      // 同时挂 coachNameText 兜底空昵称，避免 wxml 写一堆 wx:if 判断。
      const reqCopy = { ...r }
      try {
        reqCopy.requestedAtText = this.formatTime(r.requestedAt)
      } catch (_) {
        reqCopy.requestedAtText = ''
      }
      const rawName = String((r && (r.coachName || r.coachNickname)) || '').trim()
      reqCopy.coachNameText = rawName || '未填写昵称'
      return reqCopy
    });
    const hasPendingCoachRequest = pendingCoachBindingRequests.length > 0;
    const pendingCoachRequestCount = pendingCoachBindingRequests.length;
    // 当前用户是否在 pending 申请列表里（教练视角，用于「待确认」状态展示）
    // 匹配口径：coachOpenid 或 coachUserId 任一命中当前用户的 openid / token
    const myPendingRequest = pendingCoachBindingRequests.find((r) => {
      const rOpenid = String((r && r.coachOpenid) || '').trim()
      const rUserId = String((r && r.coachUserId) || '').trim()
      if (rOpenid && myOpenid && rOpenid === myOpenid) return true
      if (rUserId && myToken && rUserId === myToken) return true
      return false
    }) || null
    // 管理者 + 待接取态 + 有 pending 申请 → 可以确认/拒绝；其他情况一律禁止（进行中/已结课都不再处理申请）
    const canConfirmCoachBinding = !!isManagerialUser && !!stageIsAwaiting && hasPendingCoachRequest;
    const canRejectCoachBinding = !!isManagerialUser && !!stageIsAwaiting && hasPendingCoachRequest;
    const pageAccessMode = isManagerialUser ? 'manager' : (isAssignedCoach ? 'executor' : 'readonly');
    let pageAccessLabel;
    if (pageAccessMode === 'executor') {
      pageAccessLabel = stageIsInProgress ? '执行教练操作台（填写每日总结）' : '执行教练操作台（暂未开始上课）';
    } else if (pageAccessMode === 'readonly') {
      pageAccessLabel = '只读查看';
    } else if (stageIsInProgress) {
      pageAccessLabel = '管理层只读查看台（进行中不可编辑）';
    } else if (stageIsAwaiting && hasPendingCoachRequest) {
      // 【2026-09-21 新流程】awaiting 态下若有 pending 申请，label 单独区分，提示管理者去挑人确认。
      pageAccessLabel = `管理层操作台（待接取，有 ${pendingCoachRequestCount} 个教练申请待确认）`;
    } else if (stageIsAwaiting) {
      pageAccessLabel = '管理层操作台（待接取，资料可改）';
    } else if (courseInfoReady) {
      pageAccessLabel = '管理层操作台（资料已确认，可生成接取码）';
    } else {
      pageAccessLabel = '管理层操作台（待编辑）';
    }
    const accessState = {
      pageAccessMode, pageAccessLabel, isOwner, isOrgAdminOfThisCourse, isAssignedCoach,
      hasAssignedCoach, stageIsEditing, stageIsAwaiting, stageIsInProgress, stageIsManagerialEditable,
      explicitFulfillState, courseInfoReady,
      // 创建班课程 tab：待编辑/待接取阶段仅管理层可进（可写）；
      // 教练接取后对所有角色开放，但一律只读（canEditCourseInfo / canAdjustLessonPlan 已随阶段锁死为 false）。
      canViewCreateTab: stageIsManagerialEditable || coachTaken,
      canViewManageTab: true,
      canViewFlowTab: !!(orderData && orderData._id),
      // 每日总结 / 结课：教练接取后才开放；未接取（editing / awaiting）对所有角色都不开放。
      canViewSummaryTab: !!coachTaken,
      canViewCloseTab: !!coachTaken,
      canEditCourseInfo, canDeleteCourse, canOperatePickupCode,
      canMarkCourseInfoReady, canGeneratePickupCode, canResetPickupCode,
      canAdjustLessonPlan, canWriteSummary, canCloseCourse,
      // 【2026-09-21 新流程】coach_binding_requests 相关派生字段
      coachBindingRequests, pendingCoachBindingRequests,
      hasPendingCoachRequest, pendingCoachRequestCount,
      myPendingRequest,
      canConfirmCoachBinding, canRejectCoachBinding
    };
    return { ...accessState, pagePermissionRows: this.buildPagePermissionRows(accessState) };
  },

  resolveAccessibleTab(preferredTab = 'create', accessState = {}) {
    const rawTab = String(preferredTab || 'create').trim() || 'create';
    const safeTab = rawTab === 'manage' ? 'flow' : rawTab;
    const allowMap = {
      create: !!accessState.canViewCreateTab,
      flow: !!accessState.canViewFlowTab,
      summary: !!accessState.canViewSummaryTab,
      close: !!accessState.canViewCloseTab
    };
    if (allowMap[safeTab]) return safeTab;
    if (allowMap.flow) return 'flow';
    if (allowMap.summary) return 'summary';
    if (allowMap.create) return 'create';
    if (allowMap.close) return 'close';
    return 'flow';
  },

  getTabDeniedText(tab = '') {
    if (tab === 'create') return '当前角色不能修改课程资料';
    // 【2026-09-21 权限口径调整】结课不再是「发布者专属」：教练接取后由执行教练提交，
    // 管理层 / admin 只读；未接取阶段（editing / awaiting）两 tab 对所有角色都不开放。
    if (tab === 'close') return '教练接取后由执行教练结课，此处只可查看';
    if (tab === 'manage') return '当前角色不能进入课节管理';
    if (tab === 'summary') return '教练接取后才可查看每日总结';
    if (tab === 'flow') return '当前角色不能进入流转页面';
    return '当前角色不能操作该页面';
  },

  redirectToPreviewPage(orderId) {
    if (!orderId) {
      wx.switchTab({ url: '/pages/index/index' });
      return;
    }
    wx.redirectTo({ url: `/pages/task/progress/progress_specialOperation/progress_specialOperation?id=${orderId}` });
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab) return;
    if (!this.data.orderId && tab !== 'create') {
      wx.showToast({ title: '请先发布或进入已有班级', icon: 'none' });
      return;
    }
    if (this.data.orderId) {
      const allowMap = {
        create: !!this.data.canViewCreateTab,
        flow: !!this.data.canViewFlowTab,
        summary: !!this.data.canViewSummaryTab,
        close: !!this.data.canViewCloseTab
      };
      if (!allowMap[tab]) {
        wx.showToast({ title: this.getTabDeniedText(tab), icon: 'none' });
        return;
      }
    }
    this.setData({ selectedTab: tab });
  },

  handleCloseCourseTab() {
    if (!this.data.orderId) {
      wx.showToast({ title: '请先进入已有班级', icon: 'none' });
      return;
    }
    if (!this.data.canViewCloseTab) {
      wx.showToast({ title: this.getTabDeniedText('close'), icon: 'none' });
      return;
    }
    this.setData({ selectedTab: 'close' });
  },

  refreshBannerBoxCollapse() {
    this.clearBannerBoxTimer();
    this.setData({ showBannerBoxExpanded: true });
    this.bannerBoxTimer = setTimeout(() => {
      this.setData({ showBannerBoxExpanded: false });
      this.bannerBoxTimer = null;
    }, 5000);
  },

  toggleBannerBox() {
    const nextExpanded = !this.data.showBannerBoxExpanded;
    this.setData({ showBannerBoxExpanded: nextExpanded });
    if (nextExpanded) {
      this.refreshBannerBoxCollapse();
      return;
    }
    this.clearBannerBoxTimer();
  },

  clearBannerBoxTimer() {
    if (this.bannerBoxTimer) {
      clearTimeout(this.bannerBoxTimer);
      this.bannerBoxTimer = null;
    }
  },

  // ===== 课表展示工具（保留在父页面：fetchOrderDetails 构建 displaySchedule 下发给 summary 组件）=====
  formatTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hour = `${date.getHours()}`.padStart(2, '0');
    const minute = `${date.getMinutes()}`.padStart(2, '0');
    return `${month}-${day} ${hour}:${minute}`;
  },

  buildLessonDisplayMeta(lesson = {}) {
    const hasSummary = !!((lesson.summary || '').trim());
    const hasSummaryDate = !!(lesson.summaryDate || lesson.startedAt || lesson.completedAt);
    const isCompleted = hasSummary && hasSummaryDate;
    return {
      isCompleted,
      statusText: isCompleted ? '已完成' : '待记录',
      displayStatusClass: isCompleted ? 'done' : 'pending'
    };
  },

  buildScheduleView(schedule) {
    return (schedule || [])
      .map(item => ({
        ...item,
        ...this.buildLessonDisplayMeta(item),
        startedAtText: item.startedAt ? this.formatTime(item.startedAt) : '',
        completedAtText: item.completedAt ? this.formatTime(item.completedAt) : ''
      }))
      .sort((a, b) => {
        if (a.isCompleted === b.isCompleted) return (a.lesson || 0) - (b.lesson || 0);
        return a.isCompleted ? 1 : -1;
      });
  },

  getRecordedLessonCount(schedule = []) {
    return (schedule || []).filter(item => this.buildLessonDisplayMeta(item).isCompleted).length;
  },

  buildLessonPlanGuard(orderData) {
    const schedule = Array.isArray((orderData || {}).schedule) ? orderData.schedule : [];
    const historySync = (orderData || {}).history_sync;
    const recordedLessonCount = this.getRecordedLessonCount(schedule);
    const remainingEditableCount = Math.max(0, 3 - recordedLessonCount);
    const lessonPlanLocked = recordedLessonCount >= 3;
    const lessonPlanLockText = lessonPlanLocked
      ? `已记录 ${recordedLessonCount} 节课，触发「三节后锁定」，不再支持修改总课时或半途接入。`
      : (historySync
        ? `半途接入，历史 ${historySync.syncedCount || 0} 节不计锁定；接入后再记录 ${remainingEditableCount} 节将锁定。`
        : `从第 1 节起统计；累计满 3 节课后自动锁定，目前还可记录 ${remainingEditableCount} 节。`);
    return { recordedLessonCount, lessonPlanLocked, lessonPlanLockText };
  },

  buildDisplaySchedule(schedule, orderData) {
    const list = [];
    const historyCount = (((orderData || {}).history_sync || {}).syncedCount) || 0;
    if (historyCount > 0) {
      list.push({
        isHistorySummary: true,
        actualIndex: -1,
        title: `0-${historyCount}`,
        statusText: '已完成',
        displayStatusClass: 'done'
      });
    }
    (schedule || []).forEach((item, index) => {
      list.push({ ...item, actualIndex: index, isHistorySummary: false });
    });
    return list;
  },

  // 多孩子数据归一化（父页面保留：fetchOrderDetails 统计孩子数量、协作导入时使用）
  normalizeChildProfiles(childProfiles = []) {
    const safeList = Array.isArray(childProfiles) ? childProfiles : [];
    const normalizedList = safeList.map(item => ({
      nickname: String((item || {}).nickname || '').trim(),
      age: String((item || {}).age || '').trim(),
      gender: String((item || {}).gender || '').trim(),
      height: String((item || {}).height || '').trim(),
      weight: String((item || {}).weight || '').trim()
    }));
    return normalizedList.filter(item =>
      item.nickname || item.age || item.gender || item.height || item.weight
    );
  },

  fetchOrderDetails(orderId) {
    wx.showLoading({ title: '加载中' });
    return wx.cloud.callFunction({
      name: 'NEWDL_execution_order',
      data: {
        action: 'get_oneorder',
        orderId,
        envVersion: app.globalData.miniEnvVersion || 'develop'
      }
    }).then(res => {
      wx.hideLoading();
      const result = res.result || {};
      if (result.code !== 0 || !result.data) {
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' });
        return;
      }

      const orderData = result.data || {};
      const accessState = this.buildPageAccessState(orderData);

      // 【2026-09-21 新流程·接取需管理确认】提交过绑定申请的教练同样允许进页面：
      // 否则申请中的教练会被这里弹走，流转 tab 里「你的接取申请已提交」卡片永远渲染不到。
      if (!accessState.isOwner && !accessState.isAssignedCoach && !accessState.isOrgAdminOfThisCourse && !accessState.myPendingRequest) {
        wx.showToast({ title: '仅发布者/机构管理层/执行教练可操作', icon: 'none' });
        setTimeout(() => { this.redirectToPreviewPage(orderId); }, 600);
        return;
      }

      if (app.saveUserIdentity) {
        app.saveUserIdentity({ userRole: 'C', needChooseRole: false });
      }

      const schedule = this.buildScheduleView(orderData.schedule || []);
      const displaySchedule = this.buildDisplaySchedule(schedule, orderData);
      const historyCount = (((orderData || {}).history_sync || {}).syncedCount) || 0;
      const lessonPlanGuard = this.buildLessonPlanGuard(orderData);
      // 【2026-09-21】回填展示保留库里原始大小写（机构码末位小写 b），不再统一转大写
      const existingCourseCode = this.sanitizeCollaborationCode(
        orderData.joinCode || orderData.courseCode || orderData.parent_course_code || orderData.from_b_course_id || ''
      );
      const otherInfo = orderData.other_info || {};
      const childProfiles = this.normalizeChildProfiles(
        (Array.isArray(orderData.child_profiles) && orderData.child_profiles.length)
          ? orderData.child_profiles
          : [{
              nickname: orderData.child_nickname || ((orderData.child_profile || {}).nickname) || '',
              age: orderData.child_age || ((orderData.child_profile || {}).age) || '',
              gender: orderData.child_gender || ((orderData.child_profile || {}).gender) || '',
              height: orderData.child_height || ((orderData.child_profile || {}).height) || '',
              weight: orderData.child_weight || ((orderData.child_profile || {}).weight) || ''
            }]
      );
      const safeParentName = String(otherInfo.imported_parent_name || ((otherInfo.publisherInfo || {}).nickName) || '').trim();
      const safeLocation = String(orderData.location || ((orderData.course_basic || {}).location) || '').trim();
      const safeContact = String(otherInfo.imported_phone || orderData.contact || ((orderData.course_basic || {}).contact) || '').trim();
      // 【2026-09-21】接取码展示同样保留原始大小写，避免拼出 SZDX001Bpl；
      // 兜底值 existingCourseCode 已是 sanitize 后的原样值，不会再把大写带进来。
      const pickupCourseCode = this.sanitizeCollaborationCode(
        orderData.joinCode || orderData.courseCode || existingCourseCode || ''
      );
      const pickupFullCode = String(orderData.pickupFullCode || orderData.pickup_full_code || '').trim();
      const stateHistory = Array.isArray(orderData.state_history) ? orderData.state_history : [];
      const currentStateSuffix = stateHistory.length
        ? String(stateHistory[stateHistory.length - 1] || '').toLowerCase()
        : String(orderData.currentStateSuffix || '').toLowerCase();
      const displayPickupCode = (pickupCourseCode.length === 8 && currentStateSuffix)
        ? `${pickupCourseCode}${currentStateSuffix}`
        : pickupFullCode;
      const assignedCoachName = String(orderData.assignedCoachName || orderData.assigned_coach_name || '').trim();
      const rawAssignedAt = orderData.assignedCoachAt;
      const assignedCoachAt = rawAssignedAt ? ((new Date(rawAssignedAt)).toLocaleString()) : '';
      const rawInfoReadyAt = orderData.course_info_ready_at || (((orderData.course_flow_info || {}).course_info_ready_at) || null);
      const selectedTab = this.resolveAccessibleTab(this.data.selectedTab, accessState);

      this.setData({
        orderId, isEditMode: true, selectedTab, order: orderData, schedule, displaySchedule,
        setTotalLessonsInput: `${orderData.progress_total || 1}`,
        syncTotalLessonsInput: `${orderData.progress_total || 1}`,
        syncHistoryCountInput: `${historyCount || 0}`,
        closeSummaryInput: (((orderData || {}).course_flow_info || {}).close_summary) || '',
        closeCoachNoteInput: (((orderData || {}).course_flow_info || {}).close_coach_note) || '',
        collaborationCode: existingCourseCode,
        collaborationMatchedOrderId: (orderData.from_b_course_id || orderData.bridge_status) ? (orderData._id || orderId) : '',
        collaborationParentName: safeParentName,
        collaborationChildCount: childProfiles.length,
        collaborationLocationText: safeLocation,
        collaborationContactText: safeContact,
        collaborationCardLocked: true,
        pickupCourseCode, pickupFullCode, stateHistory, currentStateSuffix, displayPickupCode,
        assignedCoachName, assignedCoachAt,
        flowProgressStep: this.resolveFlowProgressStep(assignedCoachName, !!rawInfoReadyAt, accessState.explicitFulfillState),
        pageAccessMode: accessState.pageAccessMode,
        pageAccessLabel: accessState.pageAccessLabel,
        pagePermissionRows: accessState.pagePermissionRows,
        canViewCreateTab: accessState.canViewCreateTab,
        canViewManageTab: accessState.canViewManageTab,
        canViewFlowTab: accessState.canViewFlowTab,
        canViewSummaryTab: accessState.canViewSummaryTab,
        canViewCloseTab: accessState.canViewCloseTab,
        canEditCourseInfo: accessState.canEditCourseInfo,
        canDeleteCourse: accessState.canDeleteCourse,
        canOperatePickupCode: accessState.canOperatePickupCode,
        canMarkCourseInfoReady: accessState.canMarkCourseInfoReady,
        canGeneratePickupCode: accessState.canGeneratePickupCode,
        canResetPickupCode: accessState.canResetPickupCode,
        canAdjustLessonPlan: accessState.canAdjustLessonPlan,
        canWriteSummary: accessState.canWriteSummary,
        canCloseCourse: accessState.canCloseCourse,
        hasAssignedCoach: accessState.hasAssignedCoach,
        explicitFulfillState: accessState.explicitFulfillState,
        courseInfoReady: accessState.courseInfoReady,
        // 【2026-09-21 新流程·接取需管理确认】旧判定是 !!(stateHistory.length || pickupFullCode)：
        // 那是旧码制「发布即写 state_history=['pl']」时代的写法。新流程 publish 不再写 state_history，
        // 但反过来只要有别的后缀残留（历史数据、其他流程写入）也会误判成「已生成」，
        // 导致 classcreate 的「完成创建，允许接单」按钮错误显示成「已完成创建」而点不动。
        // 改为只认真正的 pl 信号：有 pickup_full_code，或当前后缀就是 pl。
        hasGeneratedPickupCode: !!(pickupFullCode || currentStateSuffix === 'pl'),
        // 【2026-09-21 新流程·接取需管理确认】把申请相关派生字段同步到 data，
        // 供流转 tab 的绑定申请卡片渲染使用（pendingCoachBindingRequests 用于 wx:for 列表）。
        coachBindingRequests: accessState.coachBindingRequests || [],
        pendingCoachBindingRequests: accessState.pendingCoachBindingRequests || [],
        hasPendingCoachRequest: !!accessState.hasPendingCoachRequest,
        pendingCoachRequestCount: Number(accessState.pendingCoachRequestCount) || 0,
        myPendingRequest: accessState.myPendingRequest || null,
        canConfirmCoachBinding: !!accessState.canConfirmCoachBinding,
        canRejectCoachBinding: !!accessState.canRejectCoachBinding,
        coachBindingActionLoading: false,
        ...lessonPlanGuard
      });

      // 表单回填 / 总结编辑器同步由各组件的 observers 自动完成：
      // - classcreate 监听 order 变化 → applyOrderToForm
      // - dailysummary 监听 schedule 变化 → syncSummaryEditor / syncSelectedLesson
    }).catch(err => {
      wx.hideLoading();
      console.error('[publish] [fetchOrderDetails] 加载失败:', err);
      wx.showToast({ title: '网络错误', icon: 'none' });
    });
  },

  // ===== 协作码相关（流转 tab）=====
  // 【2026-09-21】大小写口径拆成两个函数，避免「展示/透传」被输入侧的转大写污染：
  // - sanitizeCollaborationCode：只去空白，保留数据库原始大小写。
  //   机构新码是「主体大写 + 末位小写 b」（如 SZDX001b），回填展示与 B 端追踪透传必须用它，
  //   否则界面显示成 SZDX001B，与库里真实值对不上，人工核对、复制给教练都会拿到错码。
  // - normalizeCollaborationCode：额外 toUpperCase，只用于「人工输入 → 提交查询」口径。
  //   后端 buildCourseCodeVariants 已覆盖原值/去空格/全大写/全小写/末位小写 b 五种变体，
  //   大写入参照样命中库里的 SZDX001b，所以输入侧继续转大写没有匹配风险。
  sanitizeCollaborationCode(rawValue = '') {
    return String(rawValue || '').replace(/\s+/g, '').trim();
  },
  normalizeCollaborationCode(rawValue = '') {
    return String(rawValue || '').replace(/\s+/g, '').trim().toUpperCase();
  },

  handleCollaborationCodeInput(e) {
    if (this.data.collaborationCardLocked) return;
    this.setData({ collaborationCode: this.normalizeCollaborationCode((e.detail || {}).value || '') });
  },

  // 协作信息回填：构建表单数据与 B 端追踪字段，通过 properties 下发给 classcreate 组件
  applyCollaborativeOrderToForm(order = {}) {
    const courseBasic = order.course_basic || {};
    const otherInfo = order.other_info || {};
    const publisherInfo = otherInfo.publisherInfo || {};
    const childProfiles = this.normalizeChildProfiles(
      (Array.isArray(order.child_profiles) && order.child_profiles.length)
        ? order.child_profiles
        : [{ nickname: order.child_nickname || '', age: order.child_age || '', gender: order.child_gender || '', height: order.child_height || '', weight: order.child_weight || '' }]
    );
    const safeLocation = String(order.location || courseBasic.location || '').trim();
    const safeContact = String(otherInfo.imported_phone || order.contact || courseBasic.contact || '').trim();
    const safeParentName = String(otherInfo.imported_parent_name || publisherInfo.nickName || '').trim();
    // 【2026-09-21】协作码展示与透传保留库里原始大小写，避免 SZDX001b 被显示成 SZDX001B
    const mCodeCandidates = [order.joinCode, order.courseCode, order.parent_course_code, this.data.collaborationCode]
      .map(item => this.sanitizeCollaborationCode(item)).filter(Boolean);
    const safeCourseCode = mCodeCandidates[0] || this.sanitizeCollaborationCode(order.from_b_course_id || '');
    const safeFromBCourseId = String(order.from_b_course_id || '').trim();
    const safeFromBFormId = String(order.from_b_form_id || otherInfo.from_b_form_id || ((otherInfo.imported_target_snapshot || {}).formId) || '').trim();
    const safeFromBOpenid = String(order.from_b_openid || otherInfo.from_b_openid || ((otherInfo.imported_target_snapshot || {}).fromOpenid) || '').trim();
    const safeBridgeSource = String(order.source || otherInfo.source || '').trim() || 'bridged_from_b';
    const safeBridgeStatus = String(order.bridge_status || '').trim();
    const importTagLine = '悦动邻 - 家长约课登记导入';
    const importedDescription = String(order.description || '').trim();
    const nextDescription = importedDescription ? `${importTagLine}\n${importedDescription}` : importTagLine;

    // 构建下发给 classcreate 组件的表单数据（组件 observer 合并到内部 form）
    const collaborationFormData = {
      title: '',
      sub_plan_name: '',
      course_plan: String(order.course_plan || '').trim(),
      frequency: String(order.frequency || '').trim(),
      category: String(order.category || '家长转交').trim(),
      description: nextDescription,
      location: safeLocation,
      contact: safeContact,
      course_size_mode: String(order.course_size_mode || '1对1').trim() || '1对1',
      child_profiles: childProfiles,
      latitude: order.latitude,
      longitude: order.longitude,
      coach_private_note: '',
      price_interval: '',
      allow_transfer_to_other_coach: false
    };

    // 构建下发给 classcreate 组件的 B 端追踪字段
    const collaborationTrace = {
      collaborationCode: safeCourseCode,
      collaborationMatchedOrderId: String(order._id || '').trim(),
      collaborationOriginalFromBCourseId: safeFromBCourseId,
      collaborationOriginalFromBFormId: safeFromBFormId,
      collaborationOriginalFromBOpenid: safeFromBOpenid,
      collaborationOriginalSource: safeBridgeSource,
      collaborationOriginalBridgeStatus: safeBridgeStatus,
      // 【2026-09-21】这两个是「原始值」追踪字段，必须保留库里原始大小写，供后续按码溯源
      collaborationOriginalParentCourseCode: this.sanitizeCollaborationCode(order.parent_course_code || ''),
      collaborationOriginalMatchedCourseCode: this.sanitizeCollaborationCode(order.courseCode || order.joinCode || '')
    };

    this.setData({
      collaborationFormData,
      collaborationTrace,
      collaborationCode: safeCourseCode,
      collaborationMatchedOrderId: String(order._id || '').trim(),
      collaborationParentName: safeParentName,
      collaborationChildCount: childProfiles.length,
      collaborationLocationText: safeLocation,
      collaborationContactText: safeContact
    });
  },

  async pullCollaborativeOrder() {
    if (this.data.collaborationLoading) return;
    if (this.data.collaborationCardLocked) {
      wx.showToast({ title: this.data.orderId ? '已有课程，协作码锁定' : '协作码已导入，不可再次拉取', icon: 'none' });
      return;
    }
    if (this.data.orderId) {
      wx.showToast({ title: '已有课程时不能重新拉取', icon: 'none' });
      return;
    }
    const courseCode = this.normalizeCollaborationCode(this.data.collaborationCode);
    if (!courseCode) {
      wx.showToast({ title: '请先输入课程码', icon: 'none' });
      return;
    }
    this.setData({
      collaborationCode: courseCode, collaborationLoading: true,
      collaborationMatchedOrderId: '', collaborationParentName: '',
      collaborationChildCount: 0, collaborationLocationText: '', collaborationContactText: ''
    });
    wx.showLoading({ title: '拉取中...' });

    const appInstance = getApp() || {};
    const appGlobal = (appInstance && appInstance.globalData) ? appInstance.globalData : {};
    const miniEnvVersion = appGlobal.miniEnvVersion
      || (wx.getAccountInfoSync && (() => { try { return (wx.getAccountInfoSync().miniProgram || {}).envVersion; } catch (_) { return ''; } })())
      || 'develop';
    const CLOUD_CALL_TIMEOUT_MS = 15000;
    const callCloudOrderOnce = async (attemptTag) => {
      const callPromise = (async () => {
        const res = await wx.cloud.callFunction({
          name: 'NEWDL_execution_order',
          data: { action: 'get_order_by_course_code', courseCode, envVersion: miniEnvVersion }
        });
        return res;
      })();
      const timeoutPromise = new Promise((_resolve, reject) => {
        setTimeout(() => { reject(new Error(`cloud timeout ${CLOUD_CALL_TIMEOUT_MS}ms`)); }, CLOUD_CALL_TIMEOUT_MS);
      });
      const res = await Promise.race([callPromise, timeoutPromise]);
      let result = res && res.result;
      if (result && typeof result === 'object' && typeof result.result === 'object' && typeof result.code !== 'number') {
        result = result.result;
      }
      if (result && typeof result === 'object') {
        if (typeof result.data === 'object' && typeof result.code !== 'number') result = { ...result, ...result.data };
        if (typeof result.body === 'string' && result.body.trim().charAt(0) === '{') {
          try { const bodyObj = JSON.parse(result.body); if (bodyObj && typeof bodyObj === 'object') result = { ...result, ...bodyObj }; } catch (err) { console.warn(`[publish] [pullCollaborativeOrder][${attemptTag}] HTTP body JSON parse fail:`, err); }
        }
        if (typeof result.body === 'object' && result.body && typeof result.code !== 'number') result = { ...result, ...result.body };
      }
      result = result || {};
      return { res, result };
    };

    try {
      let firstPair = await callCloudOrderOnce('attempt-1');
      let { res, result } = firstPair;
      const isUnhandledUnknownAction = (result.code === 404 && result.msg === '未知操作' && !(result.debug && Object.keys(result.debug).length));
      if (isUnhandledUnknownAction) {
        wx.showToast({ title: '云端预热中，重试一次', icon: 'none' });
        await new Promise(resolve => setTimeout(resolve, 500));
        const secondPair = await callCloudOrderOnce('attempt-2');
        res = secondPair.res; result = secondPair.result;
      }

      if (result.code !== 0 || !result.data) {
        const debug = result.debug || {};
        if (result.code === 404 && result.msg === '未知操作') {
          const receivedAction = debug.receivedAction;
          const parsed = debug.parsed || {};
          const supportedActions = debug.supportedActions;
          const actionDiagnostic = debug.actionDiagnostic || {};
          const hasDebugPayload = Boolean(debug && Object.keys(debug).length);
          const hasBuildId = Boolean(debug.buildId);
          console.error('[publish] [pullCollaborativeOrder] 云函数返回 未知操作:', { sentAction: 'get_order_by_course_code', receivedAction, supportedActions, parsed, actionDiagnostic, buildId: debug.buildId, hasDebugPayload, rawResult: result, rawCallFunctionRes: res });
          const contentLines = [];
          if (!hasDebugPayload || !hasBuildId) {
            contentLines.push('云端版本未同步(缺get_order_by_course_code等action)，请重新上传 NEWDL_execution_order');
            contentLines.push('提示：入口文件 cloudfunctions/NEW_DL_fun/NEWDL_execution_order/index.js 已改为 require(\'./dev_index.js\')，重新上传部署后生效。');
            wx.showModal({ title: '协作查询入口异常', content: contentLines.join('\n'), showCancel: false });
            return;
          }
          if (debug.buildId) contentLines.push(`云端版本：${debug.buildId}`);
          contentLines.push(`服务端动作：${receivedAction || '<空>'}`);
          if (actionDiagnostic && actionDiagnostic.hex) contentLines.push(`动作字符：hex=${actionDiagnostic.hex} len=${actionDiagnostic.length}`);
          if (parsed && parsed.actionSource) {
            contentLines.push(`解析来源：${parsed.actionSource}`);
            if (parsed.httpMethod || parsed.path) contentLines.push(`请求：${parsed.httpMethod || '-'} ${parsed.path || '-'}`);
          }
          if (Array.isArray(supportedActions) && supportedActions.length) contentLines.push(`支持动作前6项：${supportedActions.slice(0, 6).join('、')}`);
          if (debug.errorName) contentLines.push(`服务端异常: ${debug.errorName} - ${result.msg || ''}`);
          wx.showModal({ title: '协作查询入口异常', content: contentLines.join('\n'), showCancel: false });
          return;
        }
        if (result.code === 400) {
          const parsed = (debug && debug.parsed) ? debug.parsed : {};
          const detail = parsed.actionSource ? `来源：${parsed.actionSource}` : '';
          wx.showModal({ title: '云函数缺少 action', content: `${result.msg || '缺少动作参数'}${detail ? '；' + detail : ''}。请检查云函数版本与传参。`, showCancel: false });
          return;
        }
        if (result.code === 404) {
          wx.showToast({ title: result.msg || '未找到对应课程码', icon: 'none' });
          return;
        }
        wx.showToast({ title: result.msg || '未找到协作信息', icon: 'none' });
        return;
      }

      this.applyCollaborativeOrderToForm(result.data || {});
      this.setData({ collaborationCardLocked: true });
      wx.showToast({ title: '协作信息已带入', icon: 'success' });
    } catch (error) {
      console.error('[publish] [pullCollaborativeOrder] 拉取失败:', error);
      wx.showToast({ title: '拉取失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ collaborationLoading: false });
    }
  },

  goCollaborationQuickProgress() {
    const target = '/pages/task/progress/progress';
    const tryNavigate = (fallbackReason) => {
      console.info(`[publish] [goCollaborationQuickProgress] switchTab 失败，原因: ${fallbackReason}；降级 navigateTo`);
      wx.navigateTo({
        url: target,
        fail(err) {
          console.warn('[publish] [goCollaborationQuickProgress] navigateTo 也失败，降级 redirectTo:', err);
          wx.redirectTo({
            url: target,
            fail(lastErr) {
              console.error('[publish] [goCollaborationQuickProgress] 全部跳转方式失败:', lastErr);
              wx.showToast({ title: '跳转失败，请手动切到课程管理Tab', icon: 'none' });
            }
          });
        }
      });
    };
    try {
      wx.switchTab({ url: target, fail(err) { tryNavigate((err && err.errMsg) || 'switchTab reject'); } });
    } catch (error) {
      tryNavigate(`sync switchTab throw: ${error && error.message ? error.message : error}`);
    }
  },

  // ===== 课节管理弹窗（父页面保留：弹窗 UI 在父页面，classcreate 组件通过事件通知打开）=====
  openSetTotalModal() {
    if (!this.data.orderId) { wx.showToast({ title: '请先发布课程', icon: 'none' }); return; }
    if (!this.data.canAdjustLessonPlan) {
      const inProgress = this.data.explicitFulfillState === 'in_progress';
      const infoReady = !!this.data.courseInfoReady;
      const msg = inProgress ? '进行中不可改总课时/课表。' : (infoReady ? '已确认「允许教练接单」，课节结构不可修改。' : '仅创建者在「待编辑」且未确认接单前可设总课时。');
      wx.showToast({ title: msg, icon: 'none' }); return;
    }
    if (this.data.lessonPlanLocked) { wx.showToast({ title: '已记录满3节课，不能再修改', icon: 'none' }); return; }
    this.setData({ showSetTotalModal: true, setTotalLessonsInput: `${this.data.order.progress_total || 1}` });
  },

  openSyncModal() {
    if (!this.data.orderId) { wx.showToast({ title: '请先发布课程', icon: 'none' }); return; }
    if (!this.data.canAdjustLessonPlan) {
      const inProgress = this.data.explicitFulfillState === 'in_progress';
      const infoReady = !!this.data.courseInfoReady;
      const msg = inProgress ? '进行中不可做半途接入。' : (infoReady ? '已确认「允许教练接单」，课节结构不可修改。' : '仅创建者在「待编辑」且未确认接单前可调课表。');
      wx.showToast({ title: msg, icon: 'none' }); return;
    }
    if (this.data.lessonPlanLocked) { wx.showToast({ title: '已记录满3节课，不能再修改', icon: 'none' }); return; }
    const historyCount = (((this.data.order || {}).history_sync || {}).syncedCount) || (this.data.order.progress_done || 0);
    this.setData({ showSyncModal: true, syncTotalLessonsInput: `${this.data.order.progress_total || 1}`, syncHistoryCountInput: `${historyCount || 0}` });
  },

  closeSyncModal() { this.setData({ showSyncModal: false }); },
  closeSetTotalModal() { this.setData({ showSetTotalModal: false }); },

  handleSetTotalLessonsInput(e) { this.setData({ setTotalLessonsInput: e.detail.value }); },
  handleSyncTotalLessonsInput(e) { this.setData({ syncTotalLessonsInput: e.detail.value }); },
  handleSyncHistoryCountInput(e) { this.setData({ syncHistoryCountInput: e.detail.value }); },

  async submitSetTotalLessons() {
    if (this.data.lessonPlanLocked) { wx.showToast({ title: '已记录满3节课，不能再修改', icon: 'none' }); return; }
    const totalLessons = parseInt(this.data.setTotalLessonsInput, 10);
    if (!totalLessons || totalLessons < 1) { wx.showToast({ title: '总课时至少为1', icon: 'none' }); return; }
    wx.showLoading({ title: '保存中' });
    try {
      const token = wx.getStorageSync('token');
      const result = await wx.cloud.callFunction({
        name: 'NEWDL_execution_order',
        data: { action: 'sync_lesson_progress', orderId: this.data.orderId, userId: token, totalLessons, historyCount: 0, envVersion: app.globalData.miniEnvVersion || 'develop' }
      });
      wx.hideLoading();
      if (result.result.code === 0) {
        wx.showToast({ title: '课表已生成', icon: 'success' });
        this.closeSetTotalModal();
        this.fetchOrderDetails(this.data.orderId);
        return;
      }
      wx.showToast({ title: result.result.msg || '保存失败', icon: 'none' });
    } catch (error) {
      wx.hideLoading();
      console.error('[publish] [submitSetTotalLessons] 失败:', error);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  async submitSyncLessonProgress() {
    if (this.data.lessonPlanLocked) { wx.showToast({ title: '已记录满3节课，不能再修改', icon: 'none' }); return; }
    const totalLessons = parseInt(this.data.syncTotalLessonsInput, 10);
    const historyCount = parseInt(this.data.syncHistoryCountInput, 10);
    if (!totalLessons || totalLessons < 1) { wx.showToast({ title: '总课时至少为1', icon: 'none' }); return; }
    if (Number.isNaN(historyCount) || historyCount < 0 || historyCount >= totalLessons) { wx.showToast({ title: '已完成课次不合法', icon: 'none' }); return; }
    wx.showLoading({ title: '保存中' });
    try {
      const token = wx.getStorageSync('token');
      const result = await wx.cloud.callFunction({
        name: 'NEWDL_execution_order',
        data: { action: 'sync_lesson_progress', orderId: this.data.orderId, userId: token, totalLessons, historyCount, envVersion: app.globalData.miniEnvVersion || 'develop' }
      });
      wx.hideLoading();
      if (result.result.code === 0) {
        wx.showToast({ title: '补录成功', icon: 'success' });
        this.closeSyncModal();
        this.fetchOrderDetails(this.data.orderId);
        return;
      }
      wx.showToast({ title: result.result.msg || '补录失败', icon: 'none' });
    } catch (error) {
      wx.hideLoading();
      console.error('[publish] [submitSyncLessonProgress] 失败:', error);
      wx.showToast({ title: '补录失败', icon: 'none' });
    }
  },

  handleLessonAction() {
    // 旧课节状态推进入口保留注释，不删除；当前页面不再允许通过前端触发开始上课/下课
    wx.showToast({ title: '课节状态推进已下线', icon: 'none' });
  },

  handleToProgressDisplay() {
    if (!this.data.orderId) return;
    wx.navigateTo({ url: `/pages/task/progress/progress_specialOperation/progress_specialOperation?id=${this.data.orderId}` });
  },

  onCopyPickupFullCode() {
    if (!this.data.canOperatePickupCode) {
      const inProgress = this.data.explicitFulfillState === 'in_progress';
      const msg = inProgress ? '进行中接取码仅可查看。' : '仅创建者在「待编辑/待接取」可复制/重置接取码。';
      wx.showToast({ title: msg, icon: 'none' }); return;
    }
    const targetId = this.data.orderId || '';
    // 修正（2026-09-21）：这里原来只读 pickupFullCode 且硬校验 12 位，
    // 但新码制下云函数 confirm_generate_pickup_code 写库的是 10 位「8 位课程码 + 状态后缀 pl/ip/dl」，
    // 并已把旧的 pickup_confirm_code（4 位确认码）清空，12 位码在新流程里根本不再产生，
    // 于是点「复制完整接取码」必然命中 length !== 12 报「接取码数据不完整」。
    // 改为与 wxml 展示口径一致：优先取 displayPickupCode（课程码 + 当前状态后缀），
    // 拿不到再退回 pickupFullCode；长度接受 10 位新码 / 12 位历史旧码两种。
    const fullCode = String(this.data.displayPickupCode || this.data.pickupFullCode || '').trim();
    if (!targetId) { wx.showToast({ title: '课程创建后才有接取码', icon: 'none' }); return; }
    if (fullCode.length !== 10 && fullCode.length !== 12) {
      wx.showToast({ title: '接取码数据不完整，请下拉刷新重试', icon: 'none' }); return;
    }
    wx.setClipboardData({
      data: fullCode,
      success: () => { wx.showToast({ title: `${fullCode.length} 位接取码已复制`, icon: 'success' }); },
      fail: () => { wx.showToast({ title: '复制失败，请手动抄写', icon: 'none' }); }
    });
  },

  // ===== 组件事件处理器（三个表单组件通过 triggerEvent 通知父页面）=====
  // classcreate: 发布成功后由组件内部 redirectTo，父页面无需额外处理；保留占位以便扩展
  onCreateSubmitted(e) {
    console.log('[publish] classcreate submitted:', e.detail);
  },

  // classcreate: 「完成创建，允许接单」成功 → 刷新订单详情
  onPublishReady(e) {
    const orderId = (e.detail && e.detail.orderId) || this.data.orderId;
    if (orderId) this.fetchOrderDetails(orderId);
  },

  // classcreate: confirmPublishLoading 状态同步
  onConfirmPublishLoading(e) {
    this.setData({ confirmPublishLoading: !!(e.detail && e.detail.loading) });
  },

  // classcreate: 删除课程成功 → 父页面返回
  onCourseDeleted() {
    wx.navigateBack();
  },

  // classcreate: 打开「设置总课时」弹窗
  onOpenSetTotalModal() {
    this.openSetTotalModal();
  },

  // classcreate: 打开「半途接入」弹窗
  onOpenSyncModal() {
    this.openSyncModal();
  },

  // dailysummary: 每日总结保存成功 → 刷新课表（组件内部已跳转详情页，此处兜底刷新）
  onSummarySaved() {
    if (this.data.orderId) this.fetchOrderDetails(this.data.orderId);
  },

  // classoff: 结课成功 → 刷新订单详情
  onCourseClosed(e) {
    const orderId = (e.detail && e.detail.orderId) || this.data.orderId;
    if (orderId) this.fetchOrderDetails(orderId);
  },

  onPullDownRefresh() {
    if (this.data.orderId) {
      this.fetchOrderDetails(this.data.orderId).finally(() => { wx.stopPullDownRefresh(); });
      return;
    }
    wx.stopPullDownRefresh();
  },

  // ===== 绑定申请卡片相关（流转 tab · 管理者操作）=====
  // 【2026-09-21 新流程·接取需管理确认】这两个方法对应 wxml 卡片上的「确认 / 拒绝」按钮，
  // 调云函数 confirm_coach_binding / reject_coach_binding，成功后刷新订单详情；
  // coachBindingActionLoading 是并发锁，避免用户连点导致多次写入。
  async handleConfirmBinding(e) {
    if (this.data.coachBindingActionLoading) return;
    if (!this.data.canConfirmCoachBinding) {
      wx.showToast({ title: '当前阶段不能确认申请', icon: 'none' });
      return;
    }
    const requestId = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.requestId) || '').trim();
    if (!requestId) {
      wx.showToast({ title: '申请参数缺失，请下拉刷新后重试', icon: 'none' });
      return;
    }
    const orderId = this.data.orderId;
    if (!orderId) {
      wx.showToast({ title: '课程参数缺失', icon: 'none' });
      return;
    }
    const token = wx.getStorageSync('token') || (app.globalData && app.globalData.token) || '';
    const openid = (app.globalData && app.globalData.openid) || wx.getStorageSync('openid') || '';
    this.setData({ coachBindingActionLoading: true });
    wx.showLoading({ title: '确认中' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'NEWDL_execution_order',
        data: {
          action: 'confirm_coach_binding',
          orderId,
          requestId,
          // 【2026-09-21 修正】后端 openid 取 wxContext.OPENID、userId 只取 event.userId（dev:1264-1266），
          // 只传 operatorUserId 会让服务端拿不到 userId：isPublisher 的 userId 兜底分支失效、
          // decidedByUserId 写空、机构建课（只有 publisher_Id 无 openid）时直接 403。这里补 userId 对齐口径。
          operatorOpenid: openid,
          operatorUserId: token,
          userId: token,
          envVersion: (app.globalData && app.globalData.miniEnvVersion) || 'develop'
        }
      });
      wx.hideLoading();
      const result = (res && res.result) || {};
      if (result.code === 0) {
        wx.showToast({ title: result.msg || '已确认接取申请', icon: 'success' });
        this.fetchOrderDetails(orderId);
        return;
      }
      wx.showToast({ title: result.msg || '确认失败', icon: 'none' });
    } catch (error) {
      wx.hideLoading();
      console.error('[publish] [handleConfirmBinding] 失败:', error);
      wx.showToast({ title: '确认失败', icon: 'none' });
    } finally {
      this.setData({ coachBindingActionLoading: false });
    }
  },

  async handleRejectBinding(e) {
    if (this.data.coachBindingActionLoading) return;
    if (!this.data.canRejectCoachBinding) {
      wx.showToast({ title: '当前阶段不能拒绝申请', icon: 'none' });
      return;
    }
    const requestId = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.requestId) || '').trim();
    if (!requestId) {
      wx.showToast({ title: '申请参数缺失，请下拉刷新后重试', icon: 'none' });
      return;
    }
    const orderId = this.data.orderId;
    if (!orderId) {
      wx.showToast({ title: '课程参数缺失', icon: 'none' });
      return;
    }
    // 拒绝需要理由（云函数会校验）；用 modal 弹一个简短输入，避免空 reason 被服务端拒绝。
    let reason = '';
    try {
      const modalRes = await new Promise(resolve => {
        wx.showModal({
          title: '拒绝接取申请',
          content: '请填写拒绝理由（必填）',
          editable: true,
          placeholderText: '如：时段冲突 / 已另选他人',
          success: resolve,
          fail: resolve
        });
      });
      if (!modalRes || !modalRes.confirm) {
        return;
      }
      reason = String((modalRes.content || '').trim());
      if (!reason) {
        wx.showToast({ title: '请填写拒绝理由', icon: 'none' });
        return;
      }
    } catch (_) {
      return;
    }
    const token = wx.getStorageSync('token') || (app.globalData && app.globalData.token) || '';
    const openid = (app.globalData && app.globalData.openid) || wx.getStorageSync('openid') || '';
    this.setData({ coachBindingActionLoading: true });
    wx.showLoading({ title: '提交中' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'NEWDL_execution_order',
        data: {
          action: 'reject_coach_binding',
          orderId,
          requestId,
          // 【2026-09-21 修正】同 confirm：补 userId，服务端才拿得到操作者 userId。
          operatorOpenid: openid,
          operatorUserId: token,
          userId: token,
          reason,
          envVersion: (app.globalData && app.globalData.miniEnvVersion) || 'develop'
        }
      });
      wx.hideLoading();
      const result = (res && res.result) || {};
      if (result.code === 0) {
        wx.showToast({ title: result.msg || '已拒绝该申请', icon: 'success' });
        this.fetchOrderDetails(orderId);
        return;
      }
      wx.showToast({ title: result.msg || '操作失败', icon: 'none' });
    } catch (error) {
      wx.hideLoading();
      console.error('[publish] [handleRejectBinding] 失败:', error);
      wx.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      this.setData({ coachBindingActionLoading: false });
    }
  }
});
