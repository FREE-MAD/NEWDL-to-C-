// ============================================================
// 机构创建与加入 - 外壳（完整表单 UI 与逻辑已下沉到两个组件）
// 组件位置：
//   components/form-submit/organizationCreate_baseinformation（A 创建机构）
//   components/form-submit/organizationCreate_coachaddorganization（B 教练加入）
// 本页面仅作为路由页面承载组件：
//   - 两个组件各自完整渲染 hero/auth/tab-bar + 自身表单，用 hidden 切换显示
//   - 认证状态、机构回查、表单输入、图片上传、提交等全部在组件内部完成
//   - 外壳只负责 tab 切换（接收组件 switchTab 事件）和页面参数解析
// ============================================================

Page({
  /**
   * 页面的初始数据
   */
  data: {
    // 新增当前 tab：create / join，控制两个组件的 hidden 切换
    currentTab: 'create',
    // 新增初始模式：从 URL 参数 mode=edit 传入，透传给 baseinformation 组件设置初始 isEditMode
    initialMode: ''
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

  // 新增 tab 切换：组件内 tab-bar 点击非自己 tab 时 triggerEvent('switchTab')，外壳据此切换
  onTabTap(e) {
    const tab = e.detail && e.detail.tab
    if (!tab || tab === this.data.currentTab) {
      return
    }
    this.setData({ currentTab: tab })
  },

  // 新增下拉刷新：通知两个组件各自清未保存标记并刷新数据
  onPullDownRefresh() {
    const comp1 = this.selectComponent('#baseinformation')
    const comp2 = this.selectComponent('#coachaddorganization')
    Promise.all([
      comp1 ? comp1.refreshForPullDown() : Promise.resolve(),
      comp2 ? comp2.refreshForPullDown() : Promise.resolve()
    ]).finally(() => {
      wx.stopPullDownRefresh()
    })
  }
})
