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
    action: 'PROFILE_EDIT'
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
    bizRole: BIZ_ROLE_VISITOR,
    bizRoleLabel: '访客模式',
    orgName: '',
    headerDesc: '先完善资料，再进入课程管理',
    resumeGroupSub: RESUME_GROUP_SUB,
    resumeItems: RESUME_PANEL_ITEMS,
    primaryActionText: '去创建班级',
    primaryShortcutText: '已有班级？去课程管理',
    primaryGuideList: [],

    // Dashboard Data
    panelItems: [],
    welcome: '你好,远方的朋友',

    // 首页新增「接取课程」卡片：教练输入接取码即可认领课程。
    // 修正（2026-09-21）：当前主流程是 10 位新码（8 位课程码 + 2 位状态后缀 pl/ip/dl），
    // 12 位旧码（8 位班级码 + 4 位确认码）仅历史兼容；机构课程码末位可能是小写 b，输入不转大写。
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
    // 首页MVP固定使用同一套功能面板，未登录也正常渲染
    this.setPanelB();
  },

  onShow() {
    this.checkLoginStatus();
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
          action: "PROFILE_EDIT"
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
          action: "PROFILE_EDIT"
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
        action: "TASK_PUBLISH"
      },
      {
        title: "资料填写",
        sub: isCoachRole ? "继续完善教练简历内容" : "先补一份教练资料，系统会自动识别",
        color: "orange",
        action: "PROFILE_EDIT"
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

  // 新增首页状态同步：统一把业务角色、文案和入口说明一次性刷到页面上
  // 调整（2026-10-08）：旧的 P / C 二元角色已由 bizRole 四元体系取代，
  // 这里不再接收 role 参数，业务角色统一从 app.getBusinessIdentity() 读取。
  applyUserState() {
    const app = getApp();
    const globalToken = app.globalData.token || '';
    const globalNickname = app.globalData.nickname || '';
    const hasLoginIdentity = !!(globalToken && globalNickname);
    const businessIdentity = app.getBusinessIdentity
      ? app.getBusinessIdentity()
      : { bizRole: BIZ_ROLE_VISITOR, organizationProfile: {} };
    const bizRole = businessIdentity.bizRole || BIZ_ROLE_VISITOR;
    const orgName = (businessIdentity.organizationProfile && businessIdentity.organizationProfile.orgName) || '';
    const primaryActionText = bizRole === BIZ_ROLE_ORG_COACH ? '去执行课程' : (bizRole === BIZ_ROLE_ORG_ADMIN ? '去机构建课' : '去创建班级');
    const primaryShortcutText = bizRole === BIZ_ROLE_ORG_COACH ? '已有课程？去执行台' : '已有班级？去课程管理';

    this.setData({
      bizRole,
      bizRoleLabel: this.getBusinessRoleLabel(bizRole),
      orgName,
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

    this.applyUserState();

    // 新增首页角色重算：静默登录后再按资料/发课痕迹刷新一次，避免首页提示慢半拍
    if (app.resolveUserRoleByBusiness) {
      app.resolveUserRoleByBusiness().then(() => {
        this.applyUserState();
      }).catch(() => {});
    }
  },

  // --- Dashboard Methods ---
  setPanelB() {
    const safeBizRole = this.data.bizRole || BIZ_ROLE_VISITOR;
    this.setData({
      panelItems: this.buildPanelItems(safeBizRole),
      bizRoleLabel: this.getBusinessRoleLabel(safeBizRole),
      headerDesc: this.buildHeaderDesc(safeBizRole),
      primaryGuideList: this.buildPrimaryGuideList(safeBizRole)
    });
  },

  onPanelTap(e) {
    const action = e.currentTarget.dataset.action;
    console.log("点击 action:", action);
    // 新增首页教练入口引导：预览方点击“创建课程”时，先带去资料填写页，不让用户点完才被生硬拦下
    if (action === 'TASK_PUBLISH' && !isCourseCreatorRole(this.data.bizRole)) {
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
      PROFILE_EDIT: () => wx.navigateTo({ url: "/pages/index/profile/profile" }),
      PROFILE_EDIT_PAGE: () => wx.navigateTo({ url: "/pages/profile/edit/edit" }),
      TASK_PUBLISH: () => wx.navigateTo({ url: "/pages/task/publish/publish" }),
      ORG_ADMIN_TASK_PUBLISH: () => wx.navigateTo({ url: "/pages/task/publish/publish?entryMode=org_admin" }),
      ORG_COACH_TASK_PROGRESS: () => wx.switchTab({ url: "/pages/task/progress/progress" })
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
    // 调整（2026-09-16 二次定版）：机构新码制完整接取码为 13 位（9 位机构课程码 + 4 位确认码），
    // 输入长度上限放宽到 13；输入统一转大写不影响识别（服务端按大小写双变体查库）。
    // 修正（2026-09-16 三次定版·终版确认）：机构课程码回归恒长 8 位，完整接取码统一为 12 位（8+4），
    // 输入长度上限退回 12；机构代码大写放开头不补 0，如 XING001B、AB00002B。
    // 修正（2026-09-21）：不再 .toUpperCase()。
    // 机构新码制课程码末位是小写来源后缀 b（如 SZDX001b），整串接取码形如 SZDX001bpl；
    // 前端统一转大写会把它洗成 SZDX001BPL，页面上看到的和库里存的不是一个东西，
      C_PLATFORM_INFO: () => wx.navigateTo({ url: "/pages/index/about/about" }),
    // 所以这里只做「去非法字符 + 截长度」，大小写原样透传即可。
    onPickupCodeInput(e) {
      const raw = (e && e.detail && e.detail.value) ? e.detail.value : '';
      // 【2026-09-16 新增·新码制】清洗放宽到 10 位（8 课程码 + 2 状态后缀 pl/ip/dl）；
      P_DEMAND_MANAGE: () => wx.navigateTo({ url: "/pages/task/manage/manage" }),
      P_PLATFORM_INFO: () => wx.navigateTo({ url: "/pages/index/about/about" }),
      V_CIRCLE:        () => wx.navigateTo({ url: "/pages/circle/circle" }),
      V_EXERCISE:      () => wx.navigateTo({ url: "/pages/exercise/record/record" }),
      V_TRAIN_PLAN:    () => wx.navigateTo({ url: "/pages/train/plan/plan" }),
      V_PLATFORM_INFO: () => wx.navigateTo({ url: "/pages/index/about/about" }),
      const self = this;
      wx.getClipboardData({
        success(res) {
          const raw = (res && res.data) ? res.data : '';
          // 调整（2026-09-16 二次定版）：粘贴清洗同步放宽到 13 位（机构新码）
          // 修正（2026-09-16 三次定版·终版确认）：机构码回归 8 位课程码，粘贴清洗退回 12 位
          // 【2026-09-16 新增·新码制】粘贴清洗保留 12 位上限，兼容新 10 位（8+2）与旧 12 位（8+4）两种格式；
          // 后端 splitStatePickupCode 会优先按 10 位新码解析，未命中再走 12 位旧码 fallback。
          // 修正（2026-09-21）：与 onPickupCodeInput 保持一致，不再 toUpperCase，
          // 否则从发布页复制来的 SZDX001bpl 会被粘成 SZDX001BPL，与库里存的课程码不是一个值。
          const cleaned = String(raw || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
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

    // 新增：调用后端 request_coach_binding 接口提交教练绑定申请。
    // 【2026-09-21 新流程·接取需管理确认】原 action assign_coach_by_pickup_code 改为 request_coach_binding：
    // 教练输入「课程码+pl」不再直接绑定，而是写入 coach_binding_requests[] 等 management 确认；
    // 成功后只 Toast「已提交，等待管理者确认」，pickupLastResult 不带 orderId，避免误触发 goToPickedUpCourse 跳转。
    // 仅 result.alreadyAssigned（同教练已绑定，幂等）这一种历史/兼容情况仍允许走「进入课程管理」入口。
    // 前置条件：用户身份不是 visitor（避免没登录的乱点）；输入 10 位新码或 12 位旧码；
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
      // 【2026-09-16 新增·新码制双长度校验】
      // - 新码 10 位 = 8 课程码 + 2 位状态后缀（pl/ip/dl）
      // - 旧码 12 位 = 8 课程码 + 4 位随机确认码（历史课程兼容）
      // 后端 assignCoachByPickupCode 会优先按 10 位新码 splitStatePickupCode 解析，未命中再走 12 位 fallback。
      // 长度既不是 10 也不是 12 时直接拦截，避免无效请求打到云函数。
      if (fullCode.length !== 10 && fullCode.length !== 12) {
        wx.showToast({ title: '接取码必须是 10 位（课程码+pl）或 12 位（旧码）', icon: 'none' });
        return;
      }
      if (this.data.isSubmittingPickup) return;
      this.setData({ isSubmittingPickup: true, pickupLastResult: null });
      wx.showLoading({ title: '接取校验中...' });
      const app = getApp();
      // 修正（2026-10-08）：globalData 里没有 userToken / userInfo 这两个字段，
      // 旧写法会让 userId 与 coachName 恒为空，接取申请绑不到人。
      // 统一改为读 globalData.token / globalData.nickname，缓存做兜底。
      const token = (app && app.globalData && app.globalData.token) || wx.getStorageSync('token') || '';
      const miniEnvVersion = (app && app.globalData) ? (app.globalData.miniEnvVersion || 'develop') : 'develop';
      const coachName = (app && app.globalData && app.globalData.nickname) || wx.getStorageSync('nickname') || '';
      wx.cloud.callFunction({
        name: getApp().getFnName('NEWDL_execution_order'),
        data: {
          // 【2026-09-21 新流程】assign_coach_by_pickup_code 已废弃为「直接绑定」语义，
          // 改调 request_coach_binding，让教练输入码后只提交绑定申请、不直接绑定。
          // 旧 action 名 assign_coach_by_pickup_code 在拆双前现网版本里仍保留，前端不再调用以避免误触旧链路。
          action: 'request_coach_binding',
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
            // 【2026-09-21 新流程】新分支：pending（申请已提交，等管理确认）→ 只 Toast，不带 orderId，
            // 防止 goToPickedUpCourse 误触发跳转「别让他以为接到了」。
            // result.alreadyAssigned（同教练已绑定，幂等）→ 仍允许走原「进入课程管理」入口，
            // 因为这种情况下课程确实已 in_progress，跳转合理。
            if (result.pending) {
              const pendingMsg = result.msg || '已提交，等待管理者确认';
              this.setData({
                pickupLastResult: {
                  ok: true,
                  pending: true,
                  msg: pendingMsg,
                  title: result.title || '',
                  location: result.location || '',
                  coachName: result.coachName || ''
                  // 注意：故意不带 orderId / pickupFinalCode，让 goToPickedUpCourse 514-519 早 return
                }
              });
              wx.showToast({ title: '已提交，等待管理者确认', icon: 'success' });
              return;
            }
            // 兼容分支：alreadyAssigned（同教练幂等）或老格式成功 → 保留原「进入课程管理」入口
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
            const failMsg = result.msg || '提交失败，请稍后重试';
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
          console.error('[index] request_coach_binding fail:', err);
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
        // 【2026-09-14 三次调整】课节管理已并入 publish 页【流转】页签，跳转参数由 tab=manage 改为 tab=flow
        url: `/pages/task/publish/publish?id=${orderId}&tab=flow`
      });
    }
});
