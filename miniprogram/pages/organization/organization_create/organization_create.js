// ============================================================
// 机构创建与加入 - 外壳
// hero/auth/tab-bar 由本页渲染，表单 UI 与逻辑下沉到两个组件：
//   - organizationCreate_baseinformation（A 创建机构）
//   - organizationCreate_coachaddorganization（B 教练加入）
// 外壳负责：认证状态加载（refreshCertificationState）、tab 切换、页面参数解析
// ============================================================

Page({
  /**
   * 页面的初始数据
   */
  data: {
    // 新增当前 tab：create / join，控制两个组件的 hidden 切换
    currentTab: 'create',
    // 新增初始模式：从 URL 参数 mode=edit 传入，透传给 baseinformation 组件设置初始 isEditMode
    initialMode: '',
    // 新增 tab 列表：渲染顶部 tab-bar
    tabList: [
      { key: 'create', label: 'A创建机构' },
      { key: 'join', label: 'B教练加入' }
    ],
    // 新增认证状态：hero 下方 auth-card 展示，同时传给组件控制提交按钮
    isAuthLoading: false,
    authReady: false,
    authStatusText: '正在检查教练认证状态',
    authTipText: '创建机构和教练加入都必须先完成教练资料认证。',
    securityReview: {
      status: '',
      reason: '',
      message: '',
      checkType: '',
      failedTextIndex: -1,
      failedImageIndex: -1
    },
    // 新增教练资料摘要：从 NEWDL_mine_user.getProfile 拉取，传给组件用于
    // 联系人/联系电话自动回填（baseinformation）和头像/称呼展示（coachaddorganization）
    profile: {
      avatarUrl: '',
      nickname: '',
      phone: ''
    }
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    const tab = options && options.tab ? String(options.tab).trim() : 'create'
    const mode = options && options.mode ? String(options.mode).trim() : ''
    this.setData({
      currentTab: tab === 'join' ? 'join' : 'create',
      initialMode: mode
    })
    this.refreshCertificationState()
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    this.refreshCertificationState()
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    return {
      title: '机构创建与加入',
      path: `/pages/organization/organization_create/organization_create?tab=${this.data.currentTab || 'create'}`
    }
  },

  // 新增 tab 切换：顶部 tab-bar 点击直接切换 currentTab，组件用 hidden 响应
  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab
    if (!tab || tab === this.data.currentTab) {
      return
    }
    this.setData({ currentTab: tab })
  },

  // 新增资料认证状态刷新：创建机构和教练加入都必须先完成教练资料认证
  // 拆分说明（2026-09-20）：本函数只负责加载认证状态和资料摘要传给组件，
  // createForm 联系人/联系电话回填和 staffRoleOptions 构造已下沉到各组件
  refreshCertificationState() {
    const app = getApp()
    this.setData({
      isAuthLoading: true,
      authStatusText: '正在检查教练认证状态'
    })

    return wx.cloud.callFunction({
      name: getApp().getFnName('NEWDL_mine_user'),
      data: {
        action: 'getProfile',
        envVersion: app.globalData.miniEnvVersion || 'develop'
      }
    }).then((res) => {
      const result = res && res.result ? res.result : {}
      const profile = result.profile || {}
      const securityReview = result.securityReview || {}
      const approved = String((securityReview && securityReview.status) || '').trim() === 'approved'

      this.setData({
        securityReview,
        authReady: approved,
        authStatusText: approved ? '已完成教练认证，可以继续操作' : '未完成教练认证，暂时不能提交',
        authTipText: approved
          ? '你现在可以创建机构，或者填写邀请码加入机构。'
          : '请先完成教练资料填写并等待审核通过，再回来创建机构或加入机构。',
        profile: {
          avatarUrl: String(profile.avatarUrl || '').trim(),
          nickname: String(profile.nickname || '').trim(),
          phone: String(profile.phone || '').trim()
        }
      })
    }).catch(() => {
      this.setData({
        authReady: false,
        authStatusText: '认证状态获取失败，请稍后重试',
        authTipText: '当前无法确认你的教练认证状态，暂时先不要提交。'
      })
    }).finally(() => {
      this.setData({
        isAuthLoading: false
      })
    })
  },

  // 新增认证未通过引导：当前页统一把用户带去资料填写页
  goToProfileCertification() {
    wx.navigateTo({
      url: '/pages/index/profile/profile'
    })
  },

  // 新增下拉刷新：刷新认证状态 + 通知可见组件刷新表单数据
  onPullDownRefresh() {
    const comp1 = this.selectComponent('#baseinformation')
    const comp2 = this.selectComponent('#coachaddorganization')
    Promise.all([
      this.refreshCertificationState(),
      comp1 ? comp1.refreshForPullDown() : Promise.resolve(),
      comp2 ? comp2.refreshForPullDown() : Promise.resolve()
    ]).finally(() => {
      wx.stopPullDownRefresh()
    })
  }
})
