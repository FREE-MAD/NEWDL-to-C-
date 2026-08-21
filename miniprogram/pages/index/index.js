// index.js
Page({
  data: {
    headerState: 'collapsed',
    animations: [{}, {}, {}, {}],
    role: null,
    roleLabel: '预览方',
    nickname: '',
    headerDesc: '先完善资料，再进入课程管理',
    resumeGroupSub: '先填写资料，系统识别后即可进入教练链路',

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

  // 新增角色文案整理：首页和我的页统一按 C / V 两种口径给用户提示
  getRoleLabel(role) {
    return role === 'C' ? '教练' : '预览方';
  },

  // 新增顶部欢迎文案：教练看管理引导，预览方看成长引导
  buildHeaderDesc(role) {
    return role === 'C'
      ? '开启高效的课程管理之旅'
      : '先完善资料，再进入课程管理';
  },

  // 新增简历区说明：预览方直接告诉他先做什么，避免看到一堆入口还不知道第一步
  buildResumeGroupSub(role) {
    return role === 'C'
      ? '完善资料并查看对外展示效果'
      : '先填写资料，系统识别后即可进入教练链路';
  },

  // 新增首页入口口径统一：同一套卡片，根据当前角色切换更贴近用户的说明文案
  buildPanelItems(role) {
    const isCoachRole = role === 'C';

    return [
      {
        title: "创建课程",
        sub: isCoachRole ? "新建班级并填写时间、地点等信息" : "先填写教练资料，识别后再创建班级",
        color: "green",
        action: "P_TASK_PUBLISH"
      },
      {
        title: "资料填写",
        sub: isCoachRole ? "继续完善教练简历内容" : "先补一份教练资料，系统会自动识别",
        color: "orange",
        action: "C_PROFILE_EDIT"
      },
      {
        title: "简历预览",
        sub: isCoachRole ? "查看展示页面效果" : "先看看对外展示效果长什么样",
        color: "purple",
        action: "PROFILE_EDIT_PAGE"
      }
    ];
  },

  // 新增首页状态同步：统一把角色、文案和入口说明一次性刷到页面上
  applyUserState(role, nickname, token) {
    const safeRole = role || 'V';
    const hasLoginIdentity = !!(token && nickname);

    this.setData({
      token: token || null,
      role: hasLoginIdentity ? safeRole : null,
      roleLabel: this.getRoleLabel(safeRole),
      nickname: nickname || '',
      headerState: 'collapsed',
      welcome: hasLoginIdentity ? '欢迎回来' : '你好,远方的朋友',
      headerDesc: this.buildHeaderDesc(safeRole),
      resumeGroupSub: this.buildResumeGroupSub(safeRole),
      panelItems: this.buildPanelItems(safeRole)
    });
  },

  checkLoginStatus() {
    const app = getApp();
    const { token, userRole, nickname } = app.globalData;
    
    // 新增首页静默登录兜底：只要用户进入首页，就补一次默认登录态，保证“打开小程序直接可用”
    if ((!token || !userRole || !nickname) && app.ensureSilentLogin) {
      app.ensureSilentLogin();
    }

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

    if (app.globalData.token && app.globalData.userRole && app.globalData.nickname) {
      this.applyUserState(
        app.globalData.userRole,
        app.globalData.nickname,
        app.globalData.token
      );
    } else {
      this.applyUserState('V', '', '');
    }

    // 新增首页角色重算：静默登录后再按资料/发课痕迹刷新一次，避免首页提示慢半拍
    if (app.resolveUserRoleByBusiness) {
      app.resolveUserRoleByBusiness().then((nextRole) => {
        this.applyUserState(
          nextRole,
          app.globalData.nickname || wx.getStorageSync('nickname') || '',
          app.globalData.token || wx.getStorageSync('token') || ''
        );
      }).catch(() => {});
    }
  },

  goToLogin() {
    wx.navigateTo({
      url: '/pages/login/login'
    });
  },


  // --- Dashboard Methods ---
  setPanelB() {
    const safeRole = this.data.role || 'V';
    this.setData({
      panelItems: this.buildPanelItems(safeRole),
      roleLabel: this.getRoleLabel(safeRole),
      headerDesc: this.buildHeaderDesc(safeRole),
      resumeGroupSub: this.buildResumeGroupSub(safeRole)
    });
  },

  onPanelTap(e) {
    const action = e.currentTarget.dataset.action;
    console.log("点击 action:", action);
    // 新增首页教练入口引导：预览方点击“创建课程”时，先带去资料填写页，不让用户点完才被生硬拦下
    if (action === 'P_TASK_PUBLISH' && this.data.role !== 'C') {
      wx.showToast({
        title: '先填写教练资料，再创建课程',
        icon: 'none'
      });
      setTimeout(() => {
        wx.navigateTo({ url: "/pages/index/profile/profile" });
      }, 500);
      return;
    }

    const actionMap = {
      C_TASK_PROGRESS: () => wx.navigateTo({ url: "/pages/task/progress/progress" }),
      C_PROFILE_EDIT:  () => wx.navigateTo({ url: "/pages/index/profile/profile" }),
      PROFILE_EDIT_PAGE: () => wx.navigateTo({ url: "/pages/profile/edit/edit" }),
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

    // 首页主卡片新增小箭头入口：让用户可以直接切到底部“课程管理”
    goToCourseManage() {
      wx.switchTab({
        url: "/pages/task/progress/progress"
      });
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
