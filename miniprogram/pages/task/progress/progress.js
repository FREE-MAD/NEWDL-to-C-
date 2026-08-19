// pages/task/progress/progress.js
const app = getApp()

Page({
  flowTipAutoHideTimer: null,

  data: {
    orders: [],
    tasks: [],
    currentTab: 0,
    tabs: [
      { label: '可管理班级', status: 'manageable' },
      { label: '已关闭', status: 'closed' },
    ],
    showFlowTipCard: true,
    loading: false,
    currentUserRole: '',
    currentUserToken: ''
  },

  // 新增列表进度计算：和课节详情页保持同一口径，按“总结+日期”判断是否已完成
  buildProgressText(order = {}) {
    const schedule = Array.isArray(order.schedule) ? order.schedule : []
    const historyCount = Number((((order || {}).history_sync || {}).syncedCount) || 0)
    const completedScheduleCount = schedule.filter(item => {
      const hasSummary = !!((item.summary || '').trim())
      const hasSummaryDate = !!(item.summaryDate || item.startedAt || item.completedAt)
      return hasSummary && hasSummaryDate
    }).length
    const totalCount = Number(order.progress_total || (historyCount + schedule.length) || 0)
    const completedCount = Math.min(historyCount + completedScheduleCount, totalCount)

    return `${completedCount}/${totalCount}`
  },

  onLoad() {
    if (app.globalData.userRole && app.globalData.token) {
      this.setData({
        currentUserRole: app.globalData.userRole,
        currentUserToken: app.globalData.token
      })
    } else {
      // 建立“数据准备完成通知机制”
      app.globalDataReadyCallback = (globalData) => {
        console.log('[progress] globalDataReadyCallback triggered', globalData)
        this.setData({
          currentUserRole: globalData.userRole,
          currentUserToken: globalData.token
        })
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

    // 每次显示页面都尝试刷新数据
    if (this.data.currentUserRole && this.data.currentUserToken) {
      this.loadOrders()
    } else if (app.globalData.token) {
        // 如果 data 中没有 token，尝试从 globalData 重新获取
        this.setData({
            currentUserRole: app.globalData.userRole,
            currentUserToken: app.globalData.token
        }, () => {
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
          const filteredOrders = allOrders.filter(item => {
            const state = item.fulfill_state || 'pending'
            const isCreatedByMe = item.publisher_Id === currentUserToken
            const isClosedClass = state === 'cancelled' || state === 'closed'

            if (!isCreatedByMe) {
              return false
            }

            if (status === 'closed') {
              return isClosedClass
            }

            return !isClosedClass
          })
          
          console.log(`[progress] filtered for tab '${status}':`, filteredOrders.length)
          
          const tasks = filteredOrders.map(item => {
            // 优先使用 fulfill_state，兼容旧 status
            const state = item.fulfill_state || item.status || 'pending';
            const isClosedClass = state === 'cancelled' || state === 'closed';
            const statusText = isClosedClass ? '已关闭' : '可管理';
            const statusClass = isClosedClass ? 'cancelled' : 'pending';
            const normalizedTitle = ((item.course_target || {}).title) || item.title || '未命名课程';
            const normalizedDescription = ((item.course_target || {}).description) || item.description || '暂无课程介绍';
            const normalizedLocation = ((item.course_basic || {}).location) || item.location || '未填写地点';
            const normalizedCategory = ((item.course_target || {}).category) || item.category || '未分类';
            // 新增列表进度文案：这里不再直接吃旧 progress_done，改成按真实课节记录重新计算
            const progressText = this.buildProgressText(item);
            const canManageClass = !isClosedClass;

            return {
              ...item,
              id: item._id, // wxml uses id
              title: normalizedTitle,
              description: normalizedDescription,
              location: normalizedLocation,
              category: normalizedCategory,
              progressText,
              status: statusClass,
              statusText,
              deadline: item.ing_day_time || item.deadline, // 兼容字段
              canManageClass,
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
  onManageClass(e) {
    const orderId = e.currentTarget.dataset.id
    console.log('[progress] onManageClass:', orderId)

    if (!orderId) {
      wx.showToast({ title: '班级ID缺失', icon: 'none' });
      return;
    }

    wx.navigateTo({
      url: `/pages/task/publish/publish?id=${orderId}&tab=manage`
    })
  },

  // ================== 重新发布 ==================
  onRepublish(e) {
    const orderId = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/task/publish/publish?id=${orderId}&tab=create`
    })
  }
})
