// pages/task/progress/progress_specialOperation/progress_specialOperation.js
const app = getApp();

// 旧课节状态文案映射保留注释，不删除；当前展示页不再依赖“待上课/上课中/已完成”驱动显示
// const LESSON_STATUS_TEXT_MAP = {
//   PENDING: '待上课',
//   COACH_READY: '待确认',
//   PARENT_CONFIRMED: '上课中',
//   DONE: '已完成'
// };

Page({
  /**
   * 页面的初始数据
   */
  data: {
    statusBarHeight: 0,
    orderId: '',
    order: {
      title: '加载中...',
      category: '',
      description: '',
      location: '',
      price_interval: '',
      schedule: [],
      fulfill_state: ''
    },
    schedule: [],
    displaySchedule: [],
    isCoach: false,
    isOwner: false,
    isShareEntry: false,
    pageMode: 'normal',
    entryFrom: 'normal',
    sharerOpenid: '',
    hasRecordedEnter: false,
    statusText: '加载中...',
    currentStep: 0,
    createdTimeDisplay: '',
    historySyncedCount: 0,
    progressCompletedCount: 0,
    progressPendingCount: 0,
          progressTotalCount: 0,
          isDisplayGuideExpanded: true,
          isSubPlanExpanded: false
  },

  // 新增进入来源整理：先标记是否来自分享，再在分享态里区分分享者本人和普通查看者
  parseEntryOptions(options = {}) {
    const entryFrom = options.from || 'normal';
    const isShareEntry = entryFrom === 'share' || options.shareEntry === '1';

    return {
      entryFrom,
      isShareEntry,
      sharerOpenid: options.shareOpenid || ''
    };
  },

  // 新增页面模式整理：分享进入优先级最高，先分分享者本人，再分普通查看者
  resolvePageMode(myOpenid = '') {
    if (!this.data.isShareEntry) {
      return 'normal';
    }

    if (this.data.sharerOpenid && this.data.sharerOpenid === myOpenid) {
      return 'share_owner';
    }

    return 'share_viewer';
  },

  // 新增分享本人判断：课程分享页只给分享者本人保留“回操作台”分流
  isShareOwnerMode() {
    return this.data.pageMode === 'share_owner' && this.data.isOwner;
  },

  // 新增进入日志：记录 from、pageMode、time、openid，后续方便排查分享链路
  recordEntryLog(extra = {}) {
    if (!this.data.orderId || this.data.hasRecordedEnter) {
      return Promise.resolve();
    }

    this.setData({ hasRecordedEnter: true });

    return wx.cloud.callFunction({
      name: 'NEWDL_execution_order',
      data: {
        action: 'add_entry_log',
        orderId: this.data.orderId,
        from: this.data.entryFrom || 'normal',
        page: 'progress_specialOperation',
        pageMode: this.data.pageMode || 'normal',
        sharerOpenid: this.data.sharerOpenid || '',
        extra,
        envVersion: app.globalData.miniEnvVersion || 'develop'
      }
    }).catch(err => {
      console.error('[progress_specialOperation] [recordEntryLog] 记录失败:', err);
    });
  },

  // 新增分组字段读取：展示页优先读取数据库中的结构化表单
  normalizeOrderView(orderData = {}) {
    const courseTarget = orderData.course_target || {};
    const courseBasic = orderData.course_basic || {};
    const childProfile = orderData.child_profile || {};
    const childProfiles = this.normalizeChildProfiles(
      (Array.isArray(orderData.child_profiles) && orderData.child_profiles.length)
        ? orderData.child_profiles
        : [{
            nickname: childProfile.nickname || orderData.child_nickname || '',
            age: childProfile.age || orderData.child_age || '',
            gender: childProfile.gender || orderData.child_gender || '',
            height: childProfile.height || orderData.child_height || '',
            weight: childProfile.weight || orderData.child_weight || ''
          }]
    );
    const firstChildProfile = childProfiles[0] || {};

    return {
      ...orderData,
      title: courseTarget.title || orderData.title || '',
      category: courseTarget.category || orderData.category || '',
      sub_plan_name: courseTarget.sub_plan_name || orderData.sub_plan_name || '',
      course_plan: courseTarget.course_plan || orderData.course_plan || '',
      description: courseTarget.description || orderData.description || '',
      frequency: courseBasic.frequency || orderData.frequency || '',
      location: courseBasic.location || orderData.location || '',
      contact: courseBasic.contact || orderData.contact || '',
      course_size_mode: courseBasic.course_size_mode || orderData.course_size_mode || '',
      // 新增多孩子展示：家长页优先展示 child_profiles，旧字段继续兼容第一个孩子
      child_profiles: childProfiles,
      child_nickname: firstChildProfile.nickname || '',
      child_age: firstChildProfile.age || '',
      child_gender: firstChildProfile.gender || '',
      child_height: firstChildProfile.height || '',
      child_weight: firstChildProfile.weight || ''
    };
  },

  // 新增多孩子展示收口：把旧单孩子数据也整理成统一数组
  normalizeChildProfiles(childProfiles = []) {
    const safeList = Array.isArray(childProfiles) ? childProfiles : [];
    const normalizedList = safeList.map(item => ({
      nickname: String((item || {}).nickname || '').trim(),
      age: String((item || {}).age || '').trim(),
      gender: String((item || {}).gender || '').trim(),
      height: String((item || {}).height || '').trim(),
      weight: String((item || {}).weight || '').trim()
    }));

    const filteredList = normalizedList.filter(item =>
      item.nickname || item.age || item.gender || item.height || item.weight
    );

    // 新增空资料过滤：孩子信息展示页只保留真实填写过的孩子，没填就保持 0 个
    return filteredList;
  },

  // 新增课节展示状态：统一按“是否已经记录完成”来决定展示状态
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

  // 新增进度展示整理：半途接入时在前面补一个历史汇总框
  buildDisplaySchedule(schedule, orderData = {}) {
    const historyCount = (((orderData || {}).history_sync || {}).syncedCount) || 0;
    const displaySchedule = [];

    if (historyCount > 0) {
      displaySchedule.push({
        isHistorySummary: true,
        actualIndex: -1,
        title: `0-${historyCount}`,
        statusText: '历史已完成',
        displayStatusClass: 'done',
        isCompleted: true
      });
    }

    (schedule || []).forEach((item, index) => {
      displaySchedule.push({
        ...item,
        actualIndex: index,
        isHistorySummary: false
      });
    });

    return displaySchedule;
  },

  // 新增表头计算：让卡片标题区和下面的课节状态使用同一套统计口径
  buildProgressSummary(orderData = {}, schedule = []) {
    const historyCount = Number((((orderData || {}).history_sync || {}).syncedCount) || 0);
    const scheduleCompletedCount = (schedule || []).filter(item => item.isCompleted).length;
    const totalCount = Number((orderData || {}).progress_total || (historyCount + (schedule || []).length) || 0);
    const completedCount = Math.min(historyCount + scheduleCompletedCount, totalCount);
    const pendingCount = Math.max(totalCount - completedCount, 0);

    return {
      historySyncedCount: historyCount,
      progressCompletedCount: completedCount,
      progressPendingCount: pendingCount,
      progressTotalCount: totalCount
    };
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    const { statusBarHeight } = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const entryState = this.parseEntryOptions(options);

    this.setData({
      statusBarHeight,
      ...entryState
    });
         this.startDisplayGuideAutoCollapse();

    if (wx.showShareMenu) {
      wx.showShareMenu({
        menus: ['shareAppMessage']
      });
    }

    if (options.id) {
      this.setData({ orderId: options.id });
      this.fetchOrderDetails(options.id);
      return;
    }

    wx.showToast({
      title: '参数错误',
      icon: 'none'
    });
  },

  onShow() {
    // 新增分享会话失效判断：页面是旧分享页，但本次小程序唤起已经不是分享入口时，立刻退出旧分享态
    if (this.shouldExitSharePreview()) {
      this.redirectAfterShareSessionExpired();
      return;
    }

    this.startDisplayGuideAutoCollapse();
  },

       // 班级展示页说明默认展开 5 秒后自动收起，减少顶部占位
       startDisplayGuideAutoCollapse() {
         this.clearDisplayGuideTimer();
         this.displayGuideTimer = setTimeout(() => {
           this.setData({ isDisplayGuideExpanded: false });
           this.displayGuideTimer = null;
         }, 5000);
       },

       clearDisplayGuideTimer() {
         if (!this.displayGuideTimer) {
           return;
         }

         clearTimeout(this.displayGuideTimer);
         this.displayGuideTimer = null;
       },

       // 新增分享会话判断：分享态只对“本次分享唤起”生效，缓存恢复后要立即失效
       shouldExitSharePreview() {
         if (!this.data.isShareEntry) {
           return false;
         }

         const enterSource = app.globalData.enterSource || 'normal';
         return enterSource !== 'share';
       },

       // 新增分享态退出分流：所属教练和普通查看者都回首页，避免继续停留在旧分享缓存里
       redirectAfterShareSessionExpired() {
         if (this.isShareOwnerMode()) {
           this.openCoachConsole();
           return;
         }

         wx.switchTab({
           url: '/pages/index/index'
         });
       },

       // 新增教练操作台统一跳转：首页已承接教练主入口，因此这里统一回首页
       openCoachConsole() {
         // 新增首页回跳统一：无论是分享页点击返回，还是分享态过期自动退出，都直接回 tab 首页
         wx.switchTab({
           url: '/pages/index/index'
         });
       },

       // 班级展示页说明支持手动展开/收起，避免自动收起后无法再次查看
       toggleDisplayGuide() {
         const nextExpanded = !this.data.isDisplayGuideExpanded;
         this.setData({ isDisplayGuideExpanded: nextExpanded });
         this.clearDisplayGuideTimer();
       },

       // 新增课程重点折叠开关：默认收起，点击后再展开查看当前子计划详情
       toggleSubPlanSection() {
         this.setData({
           isSubPlanExpanded: !this.data.isSubPlanExpanded
         });
       },

  /**
   * 获取订单详情
   */
  fetchOrderDetails(orderId) {
    wx.showLoading({ title: '加载中' });
    const token = wx.getStorageSync('token');
    const myOpenid = app.globalData.openid || wx.getStorageSync('openid') || '';

    return wx.cloud.callFunction({
      name: 'NEWDL_execution_order',
      data: {
        action: 'get_oneorder',
        orderId: orderId,
        envVersion: app.globalData.miniEnvVersion || 'develop'
      }
    }).then(res => {
      wx.hideLoading();
      wx.stopPullDownRefresh();

      if (res.result.code !== 0) {
        wx.showToast({
          title: res.result.msg || '加载失败',
          icon: 'none'
        });
        return;
      }

      const sourceOrderData = res.result.data || {};
      const orderData = this.normalizeOrderView(sourceOrderData);
      const isCoach = orderData.publisher_openid === myOpenid || orderData.publisher_Id === token || orderData.acceptorOpenid === myOpenid || orderData.acceptorId === token;
      const isOwner = orderData.publisher_openid === myOpenid || orderData.publisher_Id === token;
      const pageMode = this.resolvePageMode(myOpenid);
      const schedule = (orderData.schedule || []).map(item => ({
        ...item,
        ...this.buildLessonDisplayMeta(item),
        // 旧状态展示保留注释，不删除；当前展示页统一按“课节记录”理解
        // statusText: LESSON_STATUS_TEXT_MAP[item.status] || item.status || '待处理'
      }));
      const displaySchedule = this.buildDisplaySchedule(schedule, orderData);
      const progressSummary = this.buildProgressSummary(orderData, schedule);

      this.setData({
        order: orderData,
        schedule,
        displaySchedule,
        isCoach,
        isOwner,
        pageMode,
        createdTimeDisplay: this.buildCreatedTimeDisplay(orderData),
        ...progressSummary
      });

      this.updateUIByState(orderData.fulfill_state);
      this.recordEntryLog({
        sourcePage: this.data.entryFrom || 'normal'
      });
    }).catch(err => {
      wx.hideLoading();
      wx.stopPullDownRefresh();
      console.error('[progress_specialOperation] [fetchOrderDetails] 网络错误:', err);
      wx.showToast({
        title: '网络错误',
        icon: 'none'
      });
    });
  },

  /**
   * 构造创建时间展示文案
   */
  buildCreatedTimeDisplay(orderData) {
    try {
      const rawCreatedTime = orderData.createdAt || orderData.create_time;
      const createdDate = rawCreatedTime ? new Date(rawCreatedTime) : null;

      if (!createdDate || Number.isNaN(createdDate.getTime())) {
        return '';
      }

      const month = `${createdDate.getMonth() + 1}`.padStart(2, '0');
      const day = `${createdDate.getDate()}`.padStart(2, '0');
      const hour = `${createdDate.getHours()}`.padStart(2, '0');
      const minute = `${createdDate.getMinutes()}`.padStart(2, '0');

      return `${month}月${day}日 ${hour}:${minute}`;
    } catch (error) {
      return '';
    }
  },

  /**
   * 更新页面状态展示
   */
  updateUIByState(fulfillState) {
    // 旧“发布-上课-完成”流程状态文案保留注释，不删除；现在展示页不再依赖这条链路
    // let statusText = '已发布，等待开始上课';
    // let currentStep = 0;
    //
    // if (fulfillState === 'in_progress') {
    //   statusText = '课程进行中，可继续进入课节详情记录内容';
    //   currentStep = 1;
    // } else if (fulfillState === 'completed' || fulfillState === 'p_completed') {
    //   statusText = '课程已完成';
    //   currentStep = 2;
    // } else if (fulfillState === 'cancelled') {
    //   statusText = '任务已取消';
    //   currentStep = 2;
    // }

    let statusText = '课程信息展示页';
    let currentStep = 0;

    if (fulfillState === 'cancelled' || fulfillState === 'closed') {
      statusText = '当前课程已关闭';
    }

    this.setData({
      statusText,
      currentStep
    });
  },

  /**
   * 跳转到课程详情页
   */
  handleToClassDetail(e) {
    if (Number(e.currentTarget.dataset.history || 0) === 1) {
      return;
    }

    const index = e.currentTarget.dataset.index;
    const lesson = this.data.schedule[index];

    if (!lesson) {
      return;
    }

    const lessonStr = encodeURIComponent(JSON.stringify(lesson));
    const orderId = this.data.orderId;
    const lessonNo = lesson.lesson || (Number(index) + 1);
    const isCoach = this.data.isCoach;
    const isRoleCoach = true;
    const isOwner = this.data.isOwner;
    const pageMode = this.data.pageMode || 'normal';
    const isShareEntry = this.data.isShareEntry ? 1 : 0;
    const entryFrom = this.data.entryFrom || 'normal';
    const sharerOpenid = this.data.sharerOpenid || '';

    wx.navigateTo({
      url: `/pages/task/progress/progress_specialOperation/progress_classdetailed/progress_classdetailed?lesson=${lessonStr}&index=${index}&lessonNo=${lessonNo}&orderId=${orderId}&isCoach=${isCoach}&isRoleCoach=${isRoleCoach}&isOwner=${isOwner}&pageMode=${pageMode}&isShareEntry=${isShareEntry}&from=${entryFrom}&shareOpenid=${sharerOpenid}&sourcePage=progress_specialOperation`
    });
  },

  // 新增教练操作台跳转：所有 C 方操作统一迁移到 publish 页面
  handleGoCoachConsole() {
    if (!this.data.orderId) {
      return;
    }

    if (!this.data.isOwner) {
      wx.showToast({
        title: '仅课程所属教练可操作',
        icon: 'none'
      });
      return;
    }

    // 新增分享本人跳转分流：教练从自己分享页返回时直接替换当前页，避免继续停留在分享态页面栈里
    this.openCoachConsole();
  },

  // 新增分享路径：分享出去后先落分享态，再按分享者本人或普通查看者区分 pageMode
  onShareAppMessage() {
    const shareOpenid = app.globalData.openid || wx.getStorageSync('openid') || '';
    const title = this.data.order.title || '课程进度';

    return {
      title,
      path: `/pages/task/progress/progress_specialOperation/progress_specialOperation?id=${this.data.orderId}&from=share&shareOpenid=${shareOpenid}`
    };
  },

  /**
   * 下拉刷新
   */
  onPullDownRefresh() {
    if (this.data.orderId) {
      this.fetchOrderDetails(this.data.orderId);
      return;
    }

    wx.stopPullDownRefresh();
       },

       onUnload() {
         this.clearDisplayGuideTimer();
       },

       onHide() {
         this.clearDisplayGuideTimer();
  }
})
