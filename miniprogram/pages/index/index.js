// index.js
const {
  BIZ_ROLE_VISITOR,
  BIZ_ROLE_FREE_COACH,
  BIZ_ROLE_ORG_ADMIN,
  BIZ_ROLE_ORG_COACH,
  getBizRoleLabel,
  isCourseCreatorRole
} = require('../../utils/bizRole')

// 新增简历区固定内容：教练简历分组不再随业务角色切换，
// 访客 / 自由教练 / 机构管理层都保持同一套「最初状态」的文案和入口
const RESUME_GROUP_SUB = '先填写资料，系统识别后即可进入教练链路'

const RESUME_PANEL_ITEMS = [
  {
    title: '资料填写',
    sub: '先补一份教练资料，系统会自动识别',
    color: 'orange',
    action: 'C_PROFILE_EDIT'
  },
  {
    title: '简历预览',
    sub: '先看看对外展示效果长什么样',
    color: 'purple',
    action: 'PROFILE_EDIT_PAGE'
  }
]

Page({
  data: {
    headerState: 'collapsed',
    animations: [{}, {}, {}, {}],
    role: null,
    roleLabel: '预览方',
    bizRole: BIZ_ROLE_VISITOR,
    bizRoleLabel: '访客模式',
    orgName: '',
    nickname: '',
    headerDesc: '先完善资料，再进入课程管理',
    resumeGroupSub: RESUME_GROUP_SUB,
    resumeItems: RESUME_PANEL_ITEMS,
    primaryActionText: '去创建班级',
    primaryShortcutText: '已有班级？去课程管理',
    primaryGuideList: [],

    // Dashboard Data
    panelItems: [],
    welcome: '你好,远方的朋友',
    token: null,
    questionnaireSection: null,

    // 首页新增「接取课程」卡片：教练输入 12 位完整接取码（8 位班级码 + 4 位确认码）即可认领课程。
    // 所有教练/访客都能看到入口，点击后展开输入区；仅登录教练（bizRole !== visitor）能实际提交。
    showPickupPanel: false,
    pickupCodeInput: '',
    isSubmittingPickup: false,
    pickupLastResult: null, // { ok: bool, msg, orderId, title, coachName, location }

    // 首页新增办证轮播：直接轮播 3 张办证宣传图，让用户一眼看到入口内容
    certificationBanners: [
      {
        image: 'cloud://cloud1-6gh7jgl8c5b16a83.636c-cloud1-6gh7jgl8c5b16a83-1398046944/NEWDL/yemian_ui_show/index_adv/蓝色简约开学注意事项微信公众号封面 (1).png'
      },
      {
        image: 'cloud://cloud1-6gh7jgl8c5b16a83.636c-cloud1-6gh7jgl8c5b16a83-1398046944/NEWDL/yemian_ui_show/index_adv/蓝色简约开学注意事项微信公众号封面 (2).png'
      },
      {
        image: 'cloud://cloud1-6gh7jgl8c5b16a83.636c-cloud1-6gh7jgl8c5b16a83-1398046944/NEWDL/yemian_ui_show/index_adv/蓝色简约开学注意事项微信公众号封面.png'
      }
    ]
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

  // 新增业务角色文案：首页顶部直接告诉用户当前是自由教练还是机构协作模式
  getBusinessRoleLabel(bizRole) {
    return getBizRoleLabel(bizRole);
  },

  // 新增顶部欢迎文案：教练看管理引导，预览方看成长引导
  buildHeaderDesc(bizRole) {
    if (bizRole === BIZ_ROLE_ORG_ADMIN) {
      return '先录入家长与学员信息，再把课程分配给机构教练';
    }
    if (bizRole === BIZ_ROLE_ORG_COACH) {
      return '这里专门承接机构执行课程，你只需要安心带课和写反馈';
    }
    return bizRole === BIZ_ROLE_FREE_COACH
      ? '开启高效的课程管理之旅'
      : '先完善资料，再进入课程管理';
  },

  // 新增首页入口口径统一：同一套卡片，根据当前角色切换更贴近用户的说明文案
  buildPanelItems(bizRole) {
    if (bizRole === BIZ_ROLE_ORG_ADMIN) {
      return [
        {
          title: "机构建课",
          sub: "先录入地点、学员、家长信息，再把课程指派给执行教练",
          color: "green",
          action: "ORG_ADMIN_TASK_PUBLISH"
        },
        {
          title: "机构资料",
          sub: "完善机构门面和教练资料，方便家长快速建立信任",
          color: "orange",
          action: "C_PROFILE_EDIT"
        },
        {
          title: "机构展示",
          sub: "查看机构页和个人资料页的对外展示效果",
          color: "purple",
          action: "PROFILE_EDIT_PAGE"
        }
      ];
    }

    if (bizRole === BIZ_ROLE_ORG_COACH) {
      return [
        {
          title: "执行课程",
          sub: "查看分配给我的机构课程，继续带课、推进课节、填写总结",
          color: "green",
          action: "ORG_COACH_TASK_PROGRESS"
        },
        {
          title: "教练资料",
          sub: "完善个人资料，让家长知道接下来是谁来带孩子",
          color: "orange",
          action: "C_PROFILE_EDIT"
        },
        {
          title: "资料预览",
          sub: "查看自己的展示页和机构展示页效果",
          color: "purple",
          action: "PROFILE_EDIT_PAGE"
        }
      ];
    }

    const isCoachRole = bizRole === BIZ_ROLE_FREE_COACH;

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

  // 新增主入口辅助文案：首页大卡片下方说明统一按业务角色切换
  buildPrimaryGuideList(bizRole) {
    if (bizRole === BIZ_ROLE_ORG_ADMIN) {
      return [
        {
          label: '第一步做什么',
          value: '先把学员、家长、训练地点和课程目标录进去，机构课程底账先建完整。'
        },
        {
          label: '建完后去哪里',
          value: '生成课程码或直接指派执行教练，后续在课程管理页查看带课反馈。'
        }
      ];
    }

    if (bizRole === BIZ_ROLE_ORG_COACH) {
      return [
        {
          label: '这里适合做什么',
          value: '查看机构分配给你的课程，执行上课、课节推进和课后总结。'
        },
        {
          label: '完成后会去哪里',
          value: '你的执行记录会沉淀到课程管理页，机构管理层可以同步看到。'
        }
      ];
    }

    return [
      {
        label: '为什么要创建班级',
        value: '把孩子信息、课程安排和上课记录放在一起，之后带课更方便。'
      },
      {
        label: '创建后可以做什么',
        value: '安排课程 → 记录每次上课 → 查看训练情况 → 完成结课'
      }
    ];
  },

  // 新增首页状态同步：统一把角色、文案和入口说明一次性刷到页面上
  applyUserState(role, nickname, token) {
    const safeRole = role || 'V';
    const hasLoginIdentity = !!(token && nickname);
    const app = getApp();
    const businessIdentity = app.getBusinessIdentity ? app.getBusinessIdentity() : {
      bizRole: safeRole === 'C' ? BIZ_ROLE_FREE_COACH : BIZ_ROLE_VISITOR,
      organizationProfile: {}
    };
    const bizRole = businessIdentity.bizRole || (safeRole === 'C' ? BIZ_ROLE_FREE_COACH : BIZ_ROLE_VISITOR);
    const orgName = (businessIdentity.organizationProfile && businessIdentity.organizationProfile.orgName) || '';
    const primaryActionText = bizRole === BIZ_ROLE_ORG_COACH ? '去执行课程' : (bizRole === BIZ_ROLE_ORG_ADMIN ? '去机构建课' : '去创建班级');
    const primaryShortcutText = bizRole === BIZ_ROLE_ORG_COACH ? '已有课程？去执行台' : '已有班级？去课程管理';

    this.setData({
      token: token || null,
      role: hasLoginIdentity ? safeRole : null,
      roleLabel: this.getRoleLabel(safeRole),
      bizRole,
      bizRoleLabel: this.getBusinessRoleLabel(bizRole),
      orgName,
      nickname: nickname || '',
      headerState: 'collapsed',
      welcome: hasLoginIdentity ? '欢迎回来' : '你好,远方的朋友',
      headerDesc: this.buildHeaderDesc(bizRole),
      panelItems: this.buildPanelItems(bizRole),
      primaryActionText,
      primaryShortcutText,
      primaryGuideList: this.buildPrimaryGuideList(bizRole)
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
    const safeBizRole = this.data.bizRole || BIZ_ROLE_VISITOR;
    this.setData({
      panelItems: this.buildPanelItems(safeBizRole),
      roleLabel: this.getRoleLabel(this.data.role || 'V'),
      bizRoleLabel: this.getBusinessRoleLabel(safeBizRole),
      headerDesc: this.buildHeaderDesc(safeBizRole),
      primaryGuideList: this.buildPrimaryGuideList(safeBizRole)
    });
  },

  onPanelTap(e) {
    const action = e.currentTarget.dataset.action;
    console.log("点击 action:", action);
    // 新增首页教练入口引导：预览方点击“创建课程”时，先带去资料填写页，不让用户点完才被生硬拦下
    if (action === 'P_TASK_PUBLISH' && !isCourseCreatorRole(this.data.bizRole)) {
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
      ORG_ADMIN_TASK_PUBLISH: () => wx.navigateTo({ url: "/pages/task/publish/publish?entryMode=org_admin" }),
      ORG_COACH_TASK_PROGRESS: () => wx.switchTab({ url: "/pages/task/progress/progress" }),
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

    // 首页新增“低价办证”入口：单独跳到办证页，避免塞进现有业务 actionMap 里影响原逻辑
    goToDoCertification() {
      wx.navigateTo({
        url: "/pages/index/do_certification/do_certification"
      });
    },

    // 首页主卡片新增小箭头入口：让用户可以直接切到底部“课程管理”
    goToCourseManage() {
      wx.switchTab({
        url: "/pages/task/progress/progress"
      });
    },

    // 新增：展开/收起「接取课程」输入面板，同时清空上一次结果展示，避免历史信息干扰新输入。
    togglePickupPanel() {
      const next = !this.data.showPickupPanel;
      this.setData({
        showPickupPanel: next,
        pickupLastResult: next ? this.data.pickupLastResult : null
      });
    },

    // 新增：接取码输入框实时格式化；
    // - 统一转大写并剔除非字母数字字符，减少空格/横杠干扰；
    // - 长度自动限制 12 位，超限即截断；
    // - 实时在页面上回显，便于用户核对。
    onPickupCodeInput(e) {
      const raw = (e && e.detail && e.detail.value) ? e.detail.value : '';
      const cleaned = String(raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12);
      this.setData({ pickupCodeInput: cleaned });
    },

    // 新增：一键粘贴剪贴板内容到输入框（自动执行与 onPickupCodeInput 一致的清洗规则）
    pastePickupCode() {
      const self = this;
      wx.getClipboardData({
        success(res) {
          const raw = (res && res.data) ? res.data : '';
          const cleaned = String(raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12);
          if (!cleaned) {
            wx.showToast({ title: '剪贴板为空', icon: 'none' });
            return;
          }
          self.setData({ pickupCodeInput: cleaned });
          wx.showToast({ title: '已粘贴到输入框', icon: 'success' });
        },
        fail() {
          wx.showToast({ title: '读取剪贴板失败', icon: 'none' });
        }
      });
    },

    // 新增：清空接取码输入与上一次结果
    clearPickupCode() {
      this.setData({ pickupCodeInput: '', pickupLastResult: null });
    },

    // 新增：调用后端 assign_coach_by_pickup_code 接口认领课程。
    // 前置条件：用户身份不是 visitor（避免没登录的乱点）；输入 12 位；
    // 成功后把结果渲染到卡片下方，提供「进入课程管理」直接跳到课程详情；
    // 失败则直接 toast 展示后端 msg，让用户可以对照着改。
    submitPickupCode() {
      const bizRole = this.data.bizRole || BIZ_ROLE_VISITOR;
      if (bizRole === BIZ_ROLE_VISITOR) {
        wx.showToast({ title: '先完善教练资料后再接取', icon: 'none' });
        setTimeout(() => {
          wx.navigateTo({ url: '/pages/index/profile/profile' });
        }, 600);
        return;
      }
      const fullCode = String(this.data.pickupCodeInput || '').trim();
      if (fullCode.length !== 12) {
        wx.showToast({ title: '完整接取码必须是 12 位', icon: 'none' });
        return;
      }
      if (this.data.isSubmittingPickup) return;
      this.setData({ isSubmittingPickup: true, pickupLastResult: null });
      wx.showLoading({ title: '接取校验中...' });
      const app = getApp();
      const token = (app && app.globalData && app.globalData.userToken) || '';
      const miniEnvVersion = (app && app.globalData) ? (app.globalData.miniEnvVersion || 'develop') : 'develop';
      const userInfo = (app && app.globalData && app.globalData.userInfo) || {};
      const coachName = userInfo.nickName || '';
      wx.cloud.callFunction({
        name: 'NEWDL_execution_order',
        data: {
          action: 'assign_coach_by_pickup_code',
          pickupFullCode: fullCode,
          userId: token,
          userRole: 'C',
          envVersion: miniEnvVersion,
          coachName
        },
        success: (res) => {
          wx.hideLoading();
          this.setData({ isSubmittingPickup: false });
          const result = res && res.result ? res.result : {};
          if (result.code === 0) {
            // 新增：教练接取成功后，明确告诉用户这门课已经进入「进行中」状态，
            // 后续去【课程管理】→【进行中】Tab 就能找到它，开始带课和写总结。
            const baseMsg = result.alreadyAssigned
              ? (result.msg || '该课程已由你接取')
              : (result.msg || '接取成功');
            const stateHint = '课程已进入【进行中】队列，可直接进入管理开始带课。';
            this.setData({
              pickupLastResult: {
                ok: true,
                msg: `${baseMsg}｜${stateHint}`,
                orderId: result.orderId || '',
                title: result.title || '未命名课程',
                coachName: result.coachName || '',
                location: result.location || '',
                pickupFinalCode: result.pickupFinalCode || '',
                alreadyAssigned: !!result.alreadyAssigned
              }
            });
            wx.showToast({ title: result.alreadyAssigned ? '已接取过，进入【进行中】' : '接取成功，进入【进行中】', icon: 'success' });
          } else {
            const failMsg = result.msg || '接取失败，请稍后重试';
            this.setData({
              pickupLastResult: {
                ok: false,
                msg: failMsg
              }
            });
            wx.showToast({ title: failMsg, icon: 'none' });
          }
        },
        fail: (err) => {
          wx.hideLoading();
          console.error('[index] assign_coach_by_pickup_code fail:', err);
          this.setData({ isSubmittingPickup: false });
          const netMsg = '网络错误，请稍后重试';
          this.setData({
            pickupLastResult: { ok: false, msg: netMsg }
          });
          wx.showToast({ title: netMsg, icon: 'none' });
        }
      });
    },

    // 新增：接取成功后，进入对应课程的「编辑态 / 管理」页面，教练直接开始管理课节和总结。
    goToPickedUpCourse() {
      const orderId = (this.data.pickupLastResult && this.data.pickupLastResult.orderId) || '';
      if (!orderId) {
        wx.showToast({ title: '缺少课程ID', icon: 'none' });
        return;
      }
      wx.redirectTo({
        url: `/pages/task/publish/publish?id=${orderId}&tab=manage`
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
