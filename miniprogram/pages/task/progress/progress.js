// pages/task/progress/progress.js
const app = getApp()
const {
  BIZ_ROLE_VISITOR,
  BIZ_ROLE_FREE_COACH,
  BIZ_ROLE_ORG_ADMIN,
  BIZ_ROLE_ORG_COACH,
  getBizRoleLabel
} = require('../../../utils/bizRole')

Page({
  flowTipAutoHideTimer: null,

  data: {
    orders: [],
    tasks: [],
    currentTab: 0,
    tabs: [
      { label: '待编辑', status: 'editing' },
      { label: '待接取', status: 'awaiting' },
      { label: '进行中', status: 'in_progress' },
      { label: '已完成', status: 'completed_tab' }
    ],
    showFlowTipCard: true,
    loading: false,
    currentUserRole: '',
    currentUserToken: '',
    bizRole: BIZ_ROLE_VISITOR,
    bizRoleLabel: '访客模式',
    orgName: '',
    flowGuideRows: [],
    viewActionText: '班级展示',
    manageActionText: '班级管理'
  },

  // 新增列表进度计算：和课节详情页保持同一口径，按“总结+日期”判断是否已完成
  buildProgressText(order = {}) {
    const progressStats = this.buildProgressStats(order)

    return `${progressStats.completedCount}/${progressStats.totalCount}`
  },

  // 新增课程进度统计：统一给 Tab 分类和卡片展示复用同一套完成口径，避免一处改了另一处还在走旧规则
  buildProgressStats(order = {}) {
    const schedule = Array.isArray(order.schedule) ? order.schedule : []
    const historyCount = Number((((order || {}).history_sync || {}).syncedCount) || 0)
    const completedScheduleCount = schedule.filter(item => {
      const hasSummary = !!((item.summary || '').trim())
      const hasSummaryDate = !!(item.summaryDate || item.startedAt || item.completedAt)
      return hasSummary && hasSummaryDate
    }).length
    const fallbackTotalCount = historyCount + schedule.length
    const totalCount = Number(order.progress_total || fallbackTotalCount || 0)
    const safeTotalCount = totalCount > 0 ? totalCount : fallbackTotalCount
    const completedCount = Math.min(historyCount + completedScheduleCount, safeTotalCount)

    return {
      schedule,
      historyCount,
      totalCount: safeTotalCount,
      completedCount
    }
  },

  // 新增课程生命周期归类：progress 页的四个 Tab 全部走这里，确保“待编辑 / 待接取 / 进行中 / 已完成”口径一致。
  // 规则：
  // 1) 先看后端显式写入的 fulfill_state（editing / awaiting / in_progress / completed / closed 等），
  //    保证管理层 mark_ready → 生成接取码 → 教练接取 这三个关键节点，Tab 结果 100% 对齐后端动作；
  // 2) 兜底推断（pending 或空的老数据 / 历史单）：
  //    - 没有 12 位 pickup_full_code（管理层还没点「确认生成接取码」） → 保持「待编辑」，
  //      这样 B 家长刚提交桥接过来的课程，哪怕有默认占位的 schedule 数组，也不会错误落入「待接取」；
  //    - 有 pickup_full_code 且没接取教练、没执行记录 → 「待接取」；
  //    - 有接取教练或有执行记录 → 「进行中」。
  // 权限规则（严格按用户最新规则）：
  //  - 「待编辑」Tab + 是管理者（课程创建者本人 / 本机构管理层 org_admin，基于 orgId 归属匹配）→ canManageClass=true，可进入管理态继续补资料/排课节；
  //  - 「待接取」Tab + 管理者 → 同样 canManageClass=true，家长资料不完善时，管理者仍可继续补充，或继续调总课时；
  //  - 「进行中 / 已完成 / 已关闭」任何身份都只能查看详情，canManageClass=false；
  //  - 「待编辑 / 待接取」但非管理者 → 也只能查看，不能进入管理编辑。
  buildOrderLifecycleMeta(order = {}, currentUser = {}) {
    const progressStats = this.buildProgressStats(order)
    const courseFlow = order.course_flow_info || {}
    // 新增：优先读 course_flow_info.fulfill_state（后端同步更新的位置），
    // 没有再退回顶层 fulfill_state，兼容历史上只写了其中一个位置的情况。
    const explicitState = String(
      courseFlow.fulfill_state
      || order.fulfill_state
      || order.status
      || 'pending'
    ).trim()
    const hasAssignedCoach = !!String(
      order.assignedCoachName
      || order.assigned_coach_name
      || order.assignedCoachToken
      || order.assigned_coach_token
      || order.assignedCoachOpenid
      || order.assigned_coach_openid
      || order.assignedCoachAt
      || ''
    ).trim()
    // “待编辑”只看有没有真正排出课节；单独填写总课时还不算进入“待接取”
    const hasLessonPlan = progressStats.schedule.length > 0 || progressStats.historyCount > 0
    const hasLessonRecord = progressStats.historyCount > 0 || progressStats.schedule.some(item => {
      return !!(
        (item.summary || '').trim()
        || item.summaryDate
        || item.startedAt
        || item.completedAt
      )
    })
    // 新增：判断管理层是否已经点「确认生成 12 位接取码」，pickup_full_code 有值才算真正对外发布了接取码。
    const hasGeneratedPickupCode = !!String(
      order.pickup_full_code
      || order.pickupFullCode
      || ''
    ).trim()
    const isClosedClass = explicitState === 'cancelled' || explicitState === 'closed'
    const isCompletedState = explicitState === 'completed' || explicitState === 'p_completed'
    const isAllLessonsCompleted = !!(progressStats.totalCount > 0 && progressStats.completedCount >= progressStats.totalCount)
    // 新增：显式状态映射。只要后端明确写过 editing / awaiting / in_progress，就不再按“有没有排课/接取”重新推断。
    const isExplicitEditing = explicitState === 'editing'
    const isExplicitAwaiting = explicitState === 'awaiting'
    const isExplicitInProgress = explicitState === 'in_progress'
    // 新增：判断当前用户是不是课程的创建者（发布者/管理层本人），
    // 它是「待编辑」+「待接取」两个 Tab 里允许进入管理态的必要条件之一。
    const safeOpenid = String((currentUser && currentUser.openid) || '').trim()
    const safeUserId = String((currentUser && currentUser.userId) || '').trim()
    const publisherOpenid = String(order.publisher_openid || (order.order_base_info || {}).publisherOpenid || '').trim()
    const publisherUserId = String(order.publisher_Id || (order.order_base_info || {}).publisher_Id || '').trim()
    const isOwner =
      (publisherOpenid && safeOpenid && publisherOpenid === safeOpenid)
      || (publisherUserId && safeUserId && publisherUserId === safeUserId)
    // 新增：机构管理层（BIZ_ROLE_ORG_ADMIN）基于 orgId 归属的管理权限判断。
    // 即使不是课程的直接发布者本人，只要当前用户的 bizRole=org_admin 且当前用户的 orgId 与课程的 orgId 一致，
    // 在待编辑/待接取阶段同样拥有 canManageClass，可进入 publish 管理页补资料/调课节（解决“我是管理者但没有权限”的问题）。
    const businessIdentity = app.getBusinessIdentity ? app.getBusinessIdentity() : null;
    const myBizRole = String(((businessIdentity && businessIdentity.bizRole) || app.globalData.bizRole || wx.getStorageSync('bizRole') || '')).trim();
    const myOrgProfile = (businessIdentity && businessIdentity.organizationProfile) || app.globalData.organizationProfile || wx.getStorageSync('organizationProfile') || {};
    const myOrgId = String((myOrgProfile && myOrgProfile.orgId) || '').trim();
    const orderOrgInfo = order.order_org_info || {};
    const orderOrgId = String(
      orderOrgInfo.orgId
      || order.orgId
      || ''
    ).trim();
    const isOrgAdminOfThisCourse = myBizRole === BIZ_ROLE_ORG_ADMIN
      && !!myOrgId
      && !!orderOrgId
      && myOrgId === orderOrgId;
    // 管理者口径：发布者本人 + 本机构管理层（org_admin 且 orgId 匹配）。
    const isManagerialUser = isOwner || isOrgAdminOfThisCourse;
    // 新增：管理层可操作阶段 = 待编辑（editing）+ 待接取（awaiting）+ 管理者（本人/机构管理层）。
    // 只有在这两个阶段 + 是管理者，canManageClass 才为 true，才会显示“进入管理”按钮。
    const managerialEditable = (isExplicitEditing || isExplicitAwaiting) && !!isManagerialUser;
    // 兜底口径下的管理权限：同样认可机构管理层（不只是本人）
    const managerialFallback = !!isManagerialUser;

    const commonProgress = `${progressStats.completedCount}/${progressStats.totalCount}`
    if (isClosedClass) {
      // 已关闭：谁都不能再操作，只能看。
      return {
        tabStatus: 'completed_tab',
        badgeText: '已关闭',
        badgeClass: 'cancelled',
        canManageClass: false,
        progressText: commonProgress
      }
    }
    if (isCompletedState || isAllLessonsCompleted) {
      return {
        tabStatus: 'completed_tab',
        badgeText: '已完成',
        badgeClass: 'completed',
        canManageClass: false,
        progressText: commonProgress
      }
    }

    // 显式 editing：默认落入「待编辑」Tab；
    // 只有管理者本人（isOwner）才能点“进入管理”做编辑/排课节，否则同样只能查看。
    if (isExplicitEditing) {
      return {
        tabStatus: 'editing',
        badgeText: '待编辑',
        badgeClass: 'editing',
        canManageClass: managerialEditable,
        progressText: commonProgress
      }
    }
    // 显式 awaiting：待接取。用户规则：管理者仍可操作“创建班级课程”与“课节管理”，
    // 所以管理者本人这里 canManageClass=true，可以继续进入 publish 管理页补资料/调总课时；
    // 非本人仍然只是查看详情。
    if (isExplicitAwaiting) {
      return {
        tabStatus: 'awaiting',
        badgeText: '待接取',
        badgeClass: 'awaiting',
        canManageClass: managerialEditable,
        progressText: commonProgress
      }
    }
    // 显式 in_progress：教练输入 12 位接取码成功接取后，进入「进行中」。
    // 用户规则：管理者在进行中全部不可操作；接取教练也只是写每日总结，不在列表这里给“进入管理”入口。
    // 因此对任何身份都是 canManageClass=false，一律只显示「查看详情」。
    if (isExplicitInProgress) {
      return {
        tabStatus: 'in_progress',
        badgeText: '进行中',
        badgeClass: 'ongoing',
        canManageClass: false,
        progressText: commonProgress
      }
    }

    // 以下是兜底分支：历史数据 / 显式状态仍为 pending 或空时，按新的规则推断。
    // 关键收紧点：没生成 12 位接取码（!hasGeneratedPickupCode）→ 一律视为「待编辑」。
    if (!hasLessonPlan || !hasGeneratedPickupCode) {
      return {
        tabStatus: 'editing',
        badgeText: '待编辑',
        badgeClass: 'editing',
        // 兜底「待编辑」：管理者（本人/本机构管理层）才能管理。
        canManageClass: managerialFallback,
        progressText: commonProgress
      }
    }

    if (!hasAssignedCoach && !hasLessonRecord) {
      return {
        tabStatus: 'awaiting',
        badgeText: '待接取',
        badgeClass: 'awaiting',
        // 兜底「待接取」：管理者（本人/本机构管理层）能继续进入管理页补资料/调课节。
        canManageClass: managerialFallback,
        progressText: commonProgress
      }
    }

    return {
      tabStatus: 'in_progress',
      badgeText: '进行中',
      badgeClass: 'ongoing',
      // 兜底「进行中」：只能查看。
      canManageClass: false,
      progressText: commonProgress
    }
  },

  // 新增业务模式分栏：顶部 Tab 统一改成「待编辑 / 待接取 / 进行中 / 已完成」四档。
  // - 待编辑：课程还在搭架子阶段（尚未排课节，基础信息可继续编辑）
  // - 待接取：课节已经排好，但还没有执行教练接取（接取码可以继续分享）
  // - 进行中：执行教练已经接取，或已经有课节执行记录（打卡/总结）
  // - 已完成：fulfill_state 走到 completed/closed/cancelled，或所有课节都已完成
  buildTabsByBizRole(bizRole = BIZ_ROLE_VISITOR) {
    // 为了让所有角色看到统一的生命周期分类，4 档 Tab 不再按角色区分文案，
    // 只在 0 档 Tab 上加个轻量说明占位（例如 org_coach 看到的仍是「待编辑」，
    // 但此时他自己大概率没有创建中的课程，过滤结果会为空并给空态提示）。
    return [
      { label: '待编辑', status: 'editing' },
      { label: '待接取', status: 'awaiting' },
      { label: '进行中', status: 'in_progress' },
      { label: '已完成', status: 'completed_tab' }
    ]
  },

  // 新增说明卡文案：不同业务模式进入课程管理后，看到的提示不再是同一套话术
  buildFlowGuideRows(bizRole = BIZ_ROLE_VISITOR) {
    if (bizRole === BIZ_ROLE_ORG_ADMIN) {
      return [
        { label: '这里展示什么', value: '这里展示当前机构下由你创建或有权限查看的课程。' },
        { label: '机构建课后做什么', value: '先录入学员和家长信息，再指派执行教练，后续在这里跟踪执行反馈。' },
        { label: '课程展示', value: '进入展示页后，更适合分享给家长查看课程内容和进度。' },
        { label: '课程管理', value: '进入管理页后，继续维护课节安排、查看总结和执行情况。' }
      ]
    }

    if (bizRole === BIZ_ROLE_ORG_COACH) {
      return [
        { label: '这里展示什么', value: '这里展示分配给你的机构课程，你只需要专注执行和反馈。' },
        { label: '课程展示', value: '进入展示页后，可以先看清课程目标、课节内容和当前进度。' },
        { label: '去执行', value: '进入管理页后，继续上课、推进课节、填写每日总结。' },
        { label: '完成后去哪', value: '你的执行记录会回传给机构管理层，方便同步跟进。' }
      ]
    }

    return [
      { label: '这里展示什么', value: '这里展示您已经创建的全部班级。' },
      { label: '班级展示', value: '进入班级展示页面，用于查看班级信息及课程内容。该页面主要功能是分享给家长，供家长查看。' },
      { label: '班级管理', value: '进入班级管理页面，用于进行课程管理、每日总结等班级相关操作。' },
      { label: '怎么选', value: '您可以根据当前需要，直接选择对应班级的“班级展示”或“班级管理”。' }
    ]
  },

  // 新增业务身份同步：课程管理页统一读取当前业务角色与机构信息，用来切换列表口径
  refreshBusinessContext() {
    const businessIdentity = app.getBusinessIdentity ? app.getBusinessIdentity() : {
      bizRole: this.data.currentUserRole === 'C' ? BIZ_ROLE_FREE_COACH : BIZ_ROLE_VISITOR,
      organizationProfile: {}
    }
    const bizRole = businessIdentity.bizRole || BIZ_ROLE_VISITOR
    const tabs = this.buildTabsByBizRole(bizRole)

    this.setData({
      bizRole,
      bizRoleLabel: getBizRoleLabel(bizRole),
      orgName: (businessIdentity.organizationProfile && businessIdentity.organizationProfile.orgName) || '',
      tabs,
      currentTab: Math.min(this.data.currentTab, tabs.length - 1),
      flowGuideRows: this.buildFlowGuideRows(bizRole),
      viewActionText: bizRole === BIZ_ROLE_ORG_COACH ? '课程展示' : '班级展示',
      manageActionText: bizRole === BIZ_ROLE_ORG_COACH ? '去执行' : '班级管理'
    })

    return businessIdentity
  },

  onLoad() {
    if (app.globalData.userRole && app.globalData.token) {
      this.setData({
        currentUserRole: app.globalData.userRole,
        currentUserToken: app.globalData.token
      })
      this.refreshBusinessContext()
    } else {
      // 建立“数据准备完成通知机制”
      app.globalDataReadyCallback = (globalData) => {
        console.log('[progress] globalDataReadyCallback triggered', globalData)
        this.setData({
          currentUserRole: globalData.userRole,
          currentUserToken: globalData.token
        })
        this.refreshBusinessContext()
        // 数据准备好后，自动刷新列表
        this.loadOrders()
      }
    }
  },

  // 页面显示时拉取
  onShow() {
    // 新增提示卡自动收起：每次进入课程管理页先展示说明，5 秒后自动隐藏
    this.setData({
      showFlowTipCard: true
    })
    this.startFlowTipAutoHide()
    this.refreshBusinessContext()

    // 每次显示页面都尝试刷新数据
    if (this.data.currentUserRole && this.data.currentUserToken) {
      this.loadOrders()
    } else if (app.globalData.token) {
        // 如果 data 中没有 token，尝试从 globalData 重新获取
        this.setData({
            currentUserRole: app.globalData.userRole,
            currentUserToken: app.globalData.token
        }, () => {
            this.refreshBusinessContext()
            this.loadOrders();
        });
    }
  },

  onHide() {
    this.clearFlowTipAutoHideTimer()
  },

  onUnload() {
    this.clearFlowTipAutoHideTimer()
  },

  // 新增提示卡计时器清理：避免页面切走后定时器继续运行
  clearFlowTipAutoHideTimer() {
    if (this.flowTipAutoHideTimer) {
      clearTimeout(this.flowTipAutoHideTimer)
      this.flowTipAutoHideTimer = null
    }
  },

  // 新增提示卡自动收起：固定 5 秒后隐藏课程管理页说明卡
  startFlowTipAutoHide() {
    this.clearFlowTipAutoHideTimer()
    this.flowTipAutoHideTimer = setTimeout(() => {
      this.setData({
        showFlowTipCard: false
      })
      this.flowTipAutoHideTimer = null
    }, 5000)
  },

  // 新增标题栏切换：收起后可点击标题重新展开，展开后继续按 5 秒规则自动收起
  toggleFlowTipCard() {
    const nextVisible = !this.data.showFlowTipCard

    this.setData({
      showFlowTipCard: nextVisible
    })

    if (nextVisible) {
      this.startFlowTipAutoHide()
      return
    }

    this.clearFlowTipAutoHideTimer()
  },

  onPullDownRefresh() {
      this.loadOrders().then(() => {
          wx.stopPullDownRefresh();
      });
  },

  // 标签切换
  onTabChange(e) {
    const index = e.currentTarget.dataset.index
    if (index === this.data.currentTab) return

    this.setData({ currentTab: index })
    this.loadOrders()
  },

  // ================== 拉取订单列表 ==================
  loadOrders() {
    if (this.data.loading) return

    const { currentUserToken, currentUserRole } = this.data
    
    // 如果没有身份信息，暂停请求（等待 callback 自动触发）
    if (!currentUserToken || !currentUserRole) {
      console.log('[progress] loadOrders - waiting for user info...')
      return
    }

    const { status } = this.data.tabs[this.data.currentTab]
    
    console.log('[progress] loadOrders - start', { status, currentUserRole, currentUserToken })

    this.setData({ loading: true })
    wx.showLoading({ title: '加载中...' })

    wx.cloud.callFunction({
      name: 'NEWDL_execution_order',
      data: {
        action: 'list_myself',
        mode: 'self', // 必须指定 mode
        // status, // 移除传给后端的 status，改由前端过滤
        userId: currentUserToken,
        role: currentUserRole, // 后端 list action 需要 role
        userRole: currentUserRole, // 保持兼容
        envVersion: app.globalData.miniEnvVersion || 'develop'
      },
      success: res => {
        console.log('[progress] loadOrders - success', res)
        if (res.result?.code === 0) {
          const allOrders = res.result.data || []
          console.log('[progress] loadOrders - total count from server:', allOrders.length)

          // 新增班级入口过滤：progress 页只展示“我创建的班级”，并按可管理/已关闭分栏
          const businessIdentity = this.refreshBusinessContext()
          const currentBizRole = businessIdentity.bizRole || BIZ_ROLE_VISITOR
          const currentOrgId = String((((businessIdentity || {}).organizationProfile || {}).orgId) || '').trim()
          const filteredOrders = allOrders.filter(item => {
            const isCreatedByMe = item.publisher_Id === currentUserToken
            const orderOrgId = String(item.orgId || item.org_id || item.organizationId || '').trim()
            const assignedCoachToken = String(item.assignedCoachToken || item.assigned_coach_token || item.coach_token || '').trim()
            const assignedCoachOpenid = String(item.assignedCoachOpenid || item.assigned_coach_openid || item.coach_openid || '').trim()
            const isSameOrg = !!(currentOrgId && orderOrgId && currentOrgId === orderOrgId)
            const isAssignedToMe = assignedCoachToken === currentUserToken || assignedCoachOpenid === (app.globalData.openid || '')

            if (currentBizRole === BIZ_ROLE_ORG_ADMIN) {
              if (currentOrgId) {
                if (!isSameOrg && !isCreatedByMe) {
                  return false
                }
              } else if (!isCreatedByMe) {
                return false
              }
            } else if (currentBizRole === BIZ_ROLE_ORG_COACH) {
              if (currentOrgId) {
                if (!isSameOrg && !isAssignedToMe) {
                  return false
                }
              } else if (!isAssignedToMe && !isCreatedByMe) {
                return false
              }
            } else if (currentBizRole === BIZ_ROLE_FREE_COACH) {
              // 新增：自由教练既要看「我创建的班级」，也要看「通过接取码认领的课程」。
              // 这样自由教练在接取不属于任何机构的课程后，也能在底部「课程管理」里直接找到并开始带课。
              if (!isCreatedByMe && !isAssignedToMe) {
                return false
              }
            } else if (!isCreatedByMe) {
              // 访客：只保留我创建的（当前基本不走这条，因为访客通常没有课程），保持旧逻辑。
              return false
            }

            // 新增：把当前登录者身份打包传给 buildOrderLifecycleMeta，用来判断当前用户是不是课程创建者。
            // 只有待编辑 Tab + 本人才能拿到 canManageClass=true（进入管理/编辑）；其他任何阶段对任何人都只能查看。
            const currentUserIdentity = {
              openid: app.globalData.openid || wx.getStorageSync('openid') || '',
              userId: currentUserToken
            };

            // 新增四档前端过滤：先按角色过滤可见范围，再按课程生命周期归入对应 Tab
            return this.buildOrderLifecycleMeta(item, currentUserIdentity).tabStatus === status
          })
          
          console.log(`[progress] filtered for tab '${status}':`, filteredOrders.length)
          
          const tasks = filteredOrders.map(item => {
            const currentUserIdentity = {
              openid: app.globalData.openid || wx.getStorageSync('openid') || '',
              userId: currentUserToken
            };
            const lifecycleMeta = this.buildOrderLifecycleMeta(item, currentUserIdentity);
            const normalizedTitle = ((item.course_target || {}).title) || item.title || '未命名课程';
            const normalizedDescription = ((item.course_target || {}).description) || item.description || '暂无课程介绍';
            const normalizedLocation = ((item.course_basic || {}).location) || item.location || '未填写地点';
            const normalizedCategory = ((item.course_target || {}).category) || item.category || '未分类';
            // 新增列表进度文案：这里不再直接吃旧 progress_done，改成按真实课节记录重新计算
            const progressText = lifecycleMeta.progressText;
            const canManageClass = lifecycleMeta.canManageClass;
            // 新增：列表右下角的课程归属/教练标签，根据当前业务角色细化文案。
            // - 机构管理层/自由教练作为发布者：看到是「待接取教练」还是「已被 XX 接取」；
            // - 机构执行教练/自由教练作为执行端：看到「机构课程」还是「我负责的课程」。
            const normalizedAssignedCoachName = String(item.assignedCoachName || item.assigned_coach_name || '').trim();
            const isThisItemAssignedToMe =
              (item.assignedCoachToken === currentUserToken)
              || (item.assignedCoachOpenid === (app.globalData.openid || ''))
              || (item.assigned_coach_token === currentUserToken)
              || (item.assigned_coach_openid === (app.globalData.openid || ''));
            let courseOwnerText;
            if (currentBizRole === BIZ_ROLE_ORG_ADMIN || currentBizRole === BIZ_ROLE_FREE_COACH) {
              // 发布者视角：优先展示执行教练接取状态
              if (normalizedAssignedCoachName) {
                courseOwnerText = isThisItemAssignedToMe
                  ? `执行教练：${normalizedAssignedCoachName}（我）`
                  : `执行教练：${normalizedAssignedCoachName}`;
              } else if (item.orgId || currentOrgId) {
                courseOwnerText = '待接取教练';
              } else {
                courseOwnerText = '待接取教练';
              }
            } else if (currentBizRole === BIZ_ROLE_ORG_COACH) {
              if (isThisItemAssignedToMe) {
                courseOwnerText = '我负责的课程';
              } else {
                courseOwnerText = (item.orgName || item.organizationName || this.data.orgName || '机构课程');
              }
            } else {
              // 其它角色（主要是访客）兜底，与旧表现一致
              courseOwnerText = isThisItemAssignedToMe ? '我负责的课程' : '个人班级';
            }
            const courseTagText = item.joinCode || item.courseCode || ''

            return {
              ...item,
              id: item._id, // wxml uses id
              title: normalizedTitle,
              description: normalizedDescription,
              location: normalizedLocation,
              category: normalizedCategory,
              progressText,
              status: lifecycleMeta.badgeClass,
              statusText: lifecycleMeta.badgeText,
              deadline: item.ing_day_time || item.deadline, // 兼容字段
              canManageClass,
              courseOwnerText,
              courseTagText
            };
          });

          this.setData({
            tasks: tasks,
            orders: allOrders // 保留所有数据，或者可以考虑缓存
          })
        } else {
          console.error('[progress] loadOrders - error code:', res.result?.code, res.result?.msg)
          wx.showToast({
            title: res.result?.msg || '加载失败',
            icon: 'none'
          })
        }
      },
      fail: (err) => {
        console.error('[progress] loadOrders - network fail', err)
        wx.showToast({
          title: '网络错误',
          icon: 'none'
        })
      },
      complete: () => {
        wx.hideLoading()
        wx.stopPullDownRefresh() // 停止下拉刷新
        this.setData({ loading: false })
      }
    })
  },

  // ================== 下拉刷新 ==================
  onPullDownRefresh() {
    this.setData({ loading: false }) // 重置 loading 状态以允许刷新
    this.loadOrders()
  },

  // ================== 查看详情 ==================
  onOrderDetail(e) {
    const orderId = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/task/detail/task_detail?id=${orderId}`
    })
  },

  // ================== 进入查看页 ==================
  onViewDetail(e) {
    const orderId = e.currentTarget.dataset.id
    const { currentUserRole } = this.data
    console.log('[progress] onViewDetail:', orderId)

    if (!orderId) {
      wx.showToast({ title: '无法进入查看页', icon: 'none' });
      return;
    }

    wx.navigateTo({
      url: `/pages/task/progress/progress_specialOperation/progress_specialOperation?id=${orderId}&role=${currentUserRole}`
    })
  },

  // 新增班级管理入口：我创建的班级直接回到带 ID 的发布页继续管理
  // 新增：双保险权限短路。
  // 用户最新规则：只有「待编辑」和「待接取」两个阶段 + 管理者（课程创建者本人 / 本机构管理层 org_admin，基于 orgId 归属匹配）才能进入管理态编辑；
  // 「进行中 / 已完成 / 已关闭」任何身份都不能进入管理编辑；接取教练只在详情页写每日总结，不走这个入口。
  onManageClass(e) {
    const orderId = e.currentTarget.dataset.id
    console.log('[progress] onManageClass:', orderId)

    if (!orderId) {
      wx.showToast({ title: '班级ID缺失', icon: 'none' });
      return;
    }

    // 新增：优先从当前 Tab 已渲染的 tasks 里取点击行；找不到再退回到原始 orders。
    // WXML 按钮里写的是 data-id="{{item.id}}"，而 tasks 映射时已经把 id: item._id 对齐，
    // 因此同时匹配 item.id / item._id / item.orderId 三种可能，避免后端字段不一导致“未加载”假失败。
    const findIn = (arr = []) => arr.find(item => {
      const itemId = String(item.id || item._id || item.orderId || '').trim();
      return itemId && itemId === String(orderId || '').trim();
    });
    const matchedOrder = findIn(this.data.tasks || []) || findIn(this.data.orders || []) || null;
    if (!matchedOrder) {
      wx.showToast({ title: '数据未加载，请稍后重试', icon: 'none' });
      return;
    }
    const currentUserIdentity = {
      openid: app.globalData.openid || wx.getStorageSync('openid') || '',
      userId: this.data.currentUserToken || ''
    };
    const meta = this.buildOrderLifecycleMeta(matchedOrder, currentUserIdentity);
    if (!meta.canManageClass) {
      let detail;
      if (meta.tabStatus === 'editing' || meta.tabStatus === 'awaiting') {
        detail = '这门课你没有管理编辑权限，只有课程发布者本人或本机构管理层（org_admin）才能进入管理编辑。你可以点击“查看详情”浏览课程内容。';
      } else if (meta.tabStatus === 'in_progress') {
        detail = '这门课已经进入【进行中】阶段。按规则：管理者在进行中全部不可操作；“每日总结”由接取教练本人在课程详情里填写。';
      } else {
        detail = '这门课已经是【' + (meta.badgeText || '') + '】，所有身份只能查看，不能再进入管理编辑。';
      }
      wx.showModal({
        title: '当前阶段只能查看',
        content: detail,
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }

    const entryMode = this.data.bizRole || BIZ_ROLE_VISITOR
    wx.navigateTo({
      url: `/pages/task/publish/publish?id=${orderId}&tab=manage&entryMode=${entryMode}`
    })
  },

  // ================== 重新发布 ==================
  onRepublish(e) {
    const orderId = e.currentTarget.dataset.id
    const entryMode = this.data.bizRole || BIZ_ROLE_VISITOR
    wx.navigateTo({
      url: `/pages/task/publish/publish?id=${orderId}&tab=create&entryMode=${entryMode}`
    })
  }
})
