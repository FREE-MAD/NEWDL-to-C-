// index.js
Page({
  data: {
    headerState: 'collapsed',
    animations: [{}, {}, {}, {}],
    role: null,
    nickname: '',

    // Dashboard Data
    panelItems: [],
    welcome: '你好,远方的朋友',
    token: null,
    questionnaireSection: null
  },

  onLoad() {
    const app = getApp();
    // Listen for updates
    app.userUpdateCallback = (newUser) => {
      this.setData({ nickname: newUser });
    };

    // 首页MVP固定使用同一套功能面板，未登录也正常渲染
    this.setPanelB();
    this.loadQuestionnaireSection();
  },

  onShow() {
    this.checkLoginStatus();
  },

  checkLoginStatus() {
    const app = getApp();
    const { token, userRole, nickname } = app.globalData;
    
    // 如果没有全局数据，尝试从缓存读取
    if (!token || !userRole || !nickname) {
        const cachedToken = wx.getStorageSync('token');
        const cachedRole = wx.getStorageSync('userRole');
        const cachedNickname = wx.getStorageSync('nickname');
        if (cachedToken && cachedRole && cachedNickname) {
            app.globalData.token = cachedToken;
            app.globalData.userRole = cachedRole;
            app.globalData.nickname = cachedNickname;
        }
    }

    // 首页不再因为登录状态切换布局，统一保留 setPanelB
    this.setPanelB();

    if (app.globalData.token && app.globalData.userRole && app.globalData.nickname) {
      this.setData({
        token: app.globalData.token,
        role: app.globalData.userRole,
        nickname: app.globalData.nickname,
        headerState: 'collapsed',
        welcome: '欢迎回来，' + app.globalData.nickname
      });
    } else {
      this.setData({
        token: null,
        role: null,
        nickname: '',
        headerState: 'collapsed',
        welcome: '你好,远方的朋友'
      });
    }
  },

  goToLogin() {
    wx.navigateTo({
      url: '/pages/login/login'
    });
  },


  // --- Dashboard Methods ---
  setPanelB() {
    this.setData({
      panelItems: [
      { title: "发布任务", sub: "发布新需求", color: "green",  action: "P_TASK_PUBLISH" },
      // 临时注释首页第二个功能入口（grid-box 第2项“需求管理”），后续需要时可直接恢复
      // { title: "需求管理", sub: "管理已发需求", color: "orange", action: "P_DEMAND_MANAGE" },
      { title: "信息完善", sub: "追踪你的报告",   color: "orange", action: "C_PROFILE_EDIT" }
      ]
    });
  },

  onPanelTap(e) {
    const action = e.currentTarget.dataset.action;
    console.log("点击 action:", action);
    const actionMap = {
      C_TASK_PROGRESS: () => wx.navigateTo({ url: "/pages/task/progress/progress" }),
      C_PROFILE_EDIT:  () => wx.navigateTo({ url: "/pages/index/profile/profile" }),
      C_PLATFORM_INFO: () => wx.navigateTo({ url: "/pages/index/about/about" }),
      P_TASK_PROGRESS: () => wx.navigateTo({ url: "/pages/task/progress/progress" }),
      P_TASK_PUBLISH:  () => wx.navigateTo({ url: "/pages/task/publish/publish" }),
      P_DEMAND_MANAGE: () => wx.navigateTo({ url: "/pages/task/manage/manage" }),
      P_PLATFORM_INFO: () => wx.navigateTo({ url: "/pages/index/about/about" }),
      V_CIRCLE:        () => wx.navigateTo({ url: "/pages/circle/circle" }),
      V_EXERCISE:      () => wx.navigateTo({ url: "/pages/exercise/record/record" }),
      V_TRAIN_PLAN:    () => wx.navigateTo({ url: "/pages/train/plan/plan" }),
      V_PLATFORM_INFO: () => wx.navigateTo({ url: "/pages/index/about/about" }),
    };
    const handler = actionMap[action];
    if (handler) handler();
    else console.warn("未处理的 action:", action);
  },

  // 只加载首页保留的健康问卷模块
  loadQuestionnaireSection() {
    wx.cloud.callFunction({
      name: 'NEWDL_first_page_req',
      data: {
        envVersion: getApp().globalData.miniEnvVersion || 'develop'
      },
      success: res => {
        const sections = (res && res.result && res.result.sections) || [];
        const questionnaireSection = sections.find(item => item.id === 'Questionnaire') || null;
        this.setData({ questionnaireSection });
      },
      fail: err => {
        console.error('NEWDL_first_page_req failed', err);
      }
    });
  },

  // 健康问卷模块统一跳转到问卷页
  onQuestionnaireTap() {
    wx.navigateTo({
      url: '/pages/index/hot/hot'
    });
  },
});
