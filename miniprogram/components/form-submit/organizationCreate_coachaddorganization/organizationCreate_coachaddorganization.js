// ============================================================
// 业务积木：表单提交 - organizationCreate_coachaddorganization 模块
// 所属页面：pages/organization/organization_create/organization_create（B 教练加入）
// 说明：本组件完整还原原 organization_create 页面 TAB_JOIN='join' 分支的
//       固定 UI 结构与全部业务逻辑，由原 Page 形态改造为 Component。
//       所有事件方法位于 methods 内，组件 attached 时自动加载数据。
// 拆分说明（2026-09-20）：原 organization_create 页面按 tab 拆为两个自包含组件，
//       本组件对应 B 教练加入（原 currentTab === 'join' 分支），
//       A 创建机构分支见 organizationCreate_baseinformation 组件。
// ============================================================

const {
  BIZ_ROLE_ORG_ADMIN,
  BIZ_ROLE_ORG_COACH
} = require('../../../utils/bizRole')

// 拆分说明（2026-09-20）：imageUpload 已下沉到 baseinformation 组件（join 无图片上传），本组件不再 require

const TAB_JOIN = 'join'
const ORGANIZATION_RESULT_CARD_STORAGE_KEY = 'organizationEntryResultCard'

// 新增机构成员身份枚举（2026-09-05）：主教 / 副教练 / 指导 / 训练分析 / 自定义填写。
// 身份属于「机构」这一层：只入库 NDLdev_organization（成员项 staff_role），不写入 NDLdev_users。
const STAFF_ROLE_HEAD_COACH = 'head_coach'
const STAFF_ROLE_ASSISTANT_COACH = 'assistant_coach'
const STAFF_ROLE_INSTRUCTOR = 'instructor'
const STAFF_ROLE_TRAINING_ANALYST = 'training_analyst'
const STAFF_ROLE_CUSTOM = 'custom'
const STAFF_ROLE_OPTIONS = [
  { key: STAFF_ROLE_HEAD_COACH, label: '主教' },
  { key: STAFF_ROLE_ASSISTANT_COACH, label: '副教练' },
  { key: STAFF_ROLE_INSTRUCTOR, label: '指导' },
  { key: STAFF_ROLE_TRAINING_ANALYST, label: '训练分析' }
]
// 调整（2026-09-05）：机构身份改为「固定文案选项 + 常驻输入框」——
// ① 选项不再用称呼（昵称）合成，一直就是主教 / 副教练 / 指导 / 训练分析这类固定文案；
// ② 「其他（自填）」从选项里移除（输入框常驻显示，本身就是自填入口）；
// ③ 点击选项只把文案回填到输入框，由用户再次编辑，最终落库值 = 输入框文本
// （统一按 staff_role='custom' + staff_role_custom=文本 提交，云函数 normalizeStaffRole 已支持，云函数零改动）
const STAFF_ROLE_CUSTOM_MAX_LENGTH = 20

// 拆分说明（2026-09-20）：以下常量已下沉到 baseinformation 组件，本组件仅保留注释参考
// 新增（2026-09-05）：机构展示页区块二/三展示字段的编辑态默认值。
// 老机构文档里可能还没有这些字段（空串），回填时退到这里的默认（完整）值起步，
// 避免空表单 + 必填校验卡住保存。文案与 organization.js DEFAULT_INTRO_INFO_LIST 保持一致。
// 修正（2026-09-06）：编辑态回填已去掉这组默认值兜底（默认文案会被表单当真实值提交入库，
// 造成 org_1a0749 那样的默认值污染），常量仅作展示层参考文案保留，不再参与任何表单回填

Component({
  /**
   * 组件的初始数据
   */
  data: {
    // 新增本组件归属 tab：tab-bar 高亮依据，固定为 'join'
    myTab: TAB_JOIN,
    tabList: [
      { key: 'create', label: 'A创建机构' },
      { key: TAB_JOIN, label: 'B教练加入' }
    ],
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
    joinForm: {
      invitation_code: ''
    },
    // 新增我的资料摘要：头像与称呼从教练资料（NEWDL_mine_user.getProfile）拉取，
    // 本页只展示不编辑，需要改就跳资料填写页
    profileBrief: {
      avatarUrl: '',
      nickname: ''
    },
    // 新增机构身份选项：主教 / 副教练 / 指导 / 训练分析 / 其他（自填）；
    // 教练资料拉取成功后会替换成「称呼+身份」前缀版本（如「张三主教」），这里是称呼缺失时的兜底纯文本
    // 调整（2026-09-05）：选项固定为纯文案（不再随称呼变化），点击选项回填输入框由用户再编辑
    staffRoleOptions: STAFF_ROLE_OPTIONS,
    // 新增机构身份表单：staff_role 为选中枚举，staff_role_custom 为选「其他」时的填写值
    // 调整（2026-09-05）：staff_role 固定记为 custom，staff_role_custom 即输入框文本（=最终落库值）
    staffForm: {
      staff_role: '',
      staff_role_custom: ''
    },
    // 新增已加入机构标记：B 教练加入侧区分「未加入 → 填邀请码加入」与「已加入 → 只更新身份」
    hasJoinedOrganization: false,
    joinCodePreview: '',
    isSubmitting: false,
    submitResultCard: null
  },

  // 新增组件生命周期：原 Page 的 onLoad 逻辑迁移到 attached
  lifetimes: {
    attached() {
      // 新增（2026-09-06）未保存编辑标记：页面实例级标记（不进 data、不参与渲染），
      // 用户输入过内容 / 触发过图片选择上传后置 true；
      // 修复「上传图片（进相册会触发 onHide→选图返回 onShow）→ onShow 回查把区块二已填字段
      // 和刚上传未保存的轮播图整包覆盖回服务端旧值」的问题（覆盖的是轮播图项前面的填空）
      this._hasUnsavedFormEdits = false
      this.refreshCertificationState()
      this.refreshCurrentOrganizationCard()
    }
  },

  // 新增页面级生命周期：组件作为页面直接子节点时，页面 onShow 会透传到此处
  pageLifetimes: {
    show() {
      this.refreshCertificationState()
      this.refreshCurrentOrganizationCard()
    }
  },

  methods: {
    // 新增标签切换：机构创建和教练加入都放在一个页面里，通过顶部 Tab 切换
    // 拆分说明（2026-09-20）：本组件只负责触发 switchTab 事件交由宿主页面切换组件，
    // 点击自己所属 tab（join）时不做事，点击 create 时上抛事件
    onTabTap(e) {
      const tab = e.currentTarget.dataset.tab
      if (!tab || tab === this.data.myTab) {
        return
      }
      this.triggerEvent('switchTab', { tab })
    },

    // 新增资料认证状态刷新：创建机构和教练加入都必须先完成教练资料认证
    // 拆分说明（2026-09-20）：本组件只回查 join 相关字段（staffRoleOptions），
    // createForm 联系人/联系电话回填与 updateInviteCodePreview 已下沉到 baseinformation 组件
    refreshCertificationState() {
      const app = getApp()
      this.setData({
        isAuthLoading: true,
        authStatusText: '正在检查教练认证状态'
      })

      return wx.cloud.callFunction({
        name: 'NEWDL_mine_user',
        data: {
          action: 'getProfile',
          envVersion: app.globalData.miniEnvVersion || 'develop'
        }
      }).then((res) => {
        const result = res && res.result ? res.result : {}
        const profile = result.profile || {}
        const securityReview = result.securityReview || {}
        const approved = String((securityReview && securityReview.status) || '').trim() === 'approved'

        // 新增资料摘要回填：头像 / 称呼直接取自教练资料，本页只读展示，
        // 需要修改时由「去资料页修改」按钮跳资料填写页，不在这里编辑
        const nextProfileBrief = {
          avatarUrl: String(profile.avatarUrl || '').trim(),
          nickname: String(profile.nickname || '').trim()
        }

        // 新增身份选项带称呼前缀：预设四项展示成「称呼+身份」（如「张三主教 / 张三副教练」），
        // 其他（自填）不加前缀；称呼拉取失败时回退纯文本选项，落库值始终是枚举 key 不受影响
        // 调整（2026-09-05）：选项改回固定文案，不再用称呼合成（见 buildStaffRoleOptions 调整说明）
        const staffRoleOptions = this.buildStaffRoleOptions()

        this.setData({
          securityReview,
          authReady: approved,
          authStatusText: approved ? '已完成教练认证，可以继续操作' : '未完成教练认证，暂时不能提交',
          authTipText: approved
            ? '你现在可以创建机构，或者填写邀请码加入机构。'
            : '请先完成教练资料填写并等待审核通过，再回来创建机构或加入机构。',
          profileBrief: nextProfileBrief,
          staffRoleOptions
          // 调整（2026-09-06）：存在未保存编辑时不再自动回填联系人/联系电话，
          // 避免上传图片返回（onShow 回查）把用户刚清空/未填的填空强行走昵称/手机号兜底
          // 拆分说明（2026-09-20）：createForm.contact_name/contact_phone 回填已下沉到 baseinformation 组件
        })
        // 拆分说明（2026-09-20）：updateInviteCodePreview 已下沉到 baseinformation 组件，本组件不再调用
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

    // 新增进页机构回查：当前页仍保留机构资料回查，结果卡片展示改由机构首页承接
    // 拆分说明（2026-09-20）：本组件只回查 join 相关字段（hasJoinedOrganization / staffForm），
    // isEditMode / currentOrganizationId / createForm / supplementUnlocked / fetchOrganizationQrcodeForEdit
    // 已下沉到 baseinformation 组件
    refreshCurrentOrganizationCard() {
      const app = getApp()
      const currentIdentity = app.getBusinessIdentity ? app.getBusinessIdentity() : null
      const organizationProfile = (currentIdentity && currentIdentity.organizationProfile) || {}
      const orgId = String(organizationProfile.orgId || '').trim()
      const memberRole = String(organizationProfile.memberRole || '').trim()

      if (!orgId) {
        this.setData({
          submitResultCard: null,
          hasJoinedOrganization: false
        })
        return Promise.resolve()
      }

      const db = wx.cloud.database({
        env: app.globalData.env
      })
      const organizationCollectionName = `${app.globalData.dataPrefix || 'NDLdev_'}organization`

      return db.collection(organizationCollectionName).where({
        'organization_basic.organization_id': orgId
      }).limit(1).get().then((res) => {
        const organizationDoc = Array.isArray(res.data) && res.data.length ? res.data[0] : null
        if (!organizationDoc) {
          this.setData({
            submitResultCard: null
          })
          return
        }

        const organizationBasic = organizationDoc.organization_basic || {}
        const isAdminRole = memberRole === 'admin'
        // 新增机构身份回查：身份存在机构成员项（organization_member.*.staff_role）里，
        // 按当前用户 openid 找出自己那一条，编辑态回填到身份选择区
        const myOpenid = String(app.globalData.openid || '').trim()
        const organizationMember = organizationDoc.organization_member || {}
        const memberList = [].concat(
          Array.isArray(organizationMember.admin_list) ? organizationMember.admin_list : [],
          Array.isArray(organizationMember.coach_list) ? organizationMember.coach_list : []
        )
        const myMemberItem = myOpenid
          ? memberList.find((item) => String((item && item.openid) || '').trim() === myOpenid)
          : null
        const savedStaffRole = String((myMemberItem && myMemberItem.staff_role) || '').trim()
        // 用户已经手动选过身份时保留当前选择，避免编辑中途返回页面被回查覆盖
        const hasPickedStaffRole = !!String((this.data.staffForm || {}).staff_role || '').trim()
        const nextStaffForm = hasPickedStaffRole
          ? this.data.staffForm
          : this.buildStaffFormFromSaved(savedStaffRole)

        this.setData({
          // 新增已加入标记：能按 orgId 查到机构文档，说明当前用户已在机构内，
          // B 教练加入侧据此判断显示「加入」还是「保存我的机构身份」
          hasJoinedOrganization: true,
          staffForm: nextStaffForm,
          submitResultCard: {
            title: '当前已加入机构',
            organizationName: String(organizationBasic.organization_name || '').trim(),
            invitationCode: String(organizationBasic.invitation_code || '').trim(),
            memberRoleLabel: isAdminRole ? '机构管理层' : '机构执行教练',
            message: isAdminRole
              ? '你当前已经在机构内，下面这张卡展示的是机构最新邀请码和基础信息。'
              : '你当前已经加入机构，下面这张卡展示的是机构最新邀请码和基础信息。'
          }
        })
        // 拆分说明（2026-09-20）：updateInviteCodePreview 与 fetchOrganizationQrcodeForEdit
        // 已下沉到 baseinformation 组件，本组件不再调用
      }).catch(() => {
        // 新增查询失败兜底：进页拉取失败时不覆盖当前卡片，避免把已有结果清空
      })
    },

    // 新增加入机构输入收口：邀请码统一转成大写英数格式，避免前端提交脏值
    onJoinInput(e) {
      let value = String((e.detail && e.detail.value) || '')
      value = value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 16)

      this.setData({
        'joinForm.invitation_code': value,
        joinCodePreview: value
      })
    },

    // 新增认证未通过引导：当前页统一把用户带去资料填写页，不让用户自己猜下一步去哪
    goToProfileCertification() {
      wx.navigateTo({
        url: '/pages/index/profile/profile'
      })
    },

    // 新增资料修改入口：头像 / 称呼属于教练个人资料，本页只读展示，
    // 点「去资料页修改」统一跳资料填写页（/pages/index/profile/profile）修改
    goToProfileEdit() {
      wx.navigateTo({
        url: '/pages/index/profile/profile'
      })
    },

    // 新增身份选项构造：预设四项展示成「称呼+身份」（如「张三主教」「张三副教练」），
    // 其他（自填）不加称呼前缀；称呼为空时退回纯文本标签。
    // 仅影响展示文案，落库值始终是枚举 key（head_coach 等），后端 normalizeStaffRole 不受影响
    // 调整（2026-09-05）：选项改回固定文案，不再用称呼合成；点击选项只负责把文案回填输入框由用户再编辑，
    // 最终落库值 = 输入框文本（统一按 custom 文本提交），不再落枚举 key
    buildStaffRoleOptions() {
      return STAFF_ROLE_OPTIONS
    },

    // 新增机构身份回填：已存值命中预设枚举直接选中对应项；
    // 其余值（含自定义身份文本）落到「其他（自填）」并填进输入框
    // 调整（2026-09-05）：改为常驻输入框回填——历史枚举 key（head_coach 等）翻译成选项固定文案填进输入框，
    // 文本值原样填进输入框；staff_role 统一记为 custom（提交协议不变），输入框文本即最终落库值
    buildStaffFormFromSaved(savedStaffRole = '') {
      const safeSaved = String(savedStaffRole || '').trim()
      if (!safeSaved) {
        return {
          staff_role: '',
          staff_role_custom: ''
        }
      }

      // 新增历史枚举翻译：旧数据存的枚举 key 翻译回选项固定文案，自定义文本原样回填
      const matchedPreset = STAFF_ROLE_OPTIONS.find((item) => item.key === safeSaved)
      const nextStaffRoleCustom = String(matchedPreset ? matchedPreset.label : safeSaved)
        .slice(0, STAFF_ROLE_CUSTOM_MAX_LENGTH)

      return {
        staff_role: STAFF_ROLE_CUSTOM,
        staff_role_custom: nextStaffRoleCustom
      }
    },

    // 新增机构身份选择：主教 / 副教练 / 指导 / 训练分析 / 其他（自填），
    // 选「其他」时才展开自定义输入框，切换回预设项时顺手清掉自定义值，避免脏值提交
    // 调整（2026-09-05）：输入框常驻显示（不再只限「其他自填」时展开），点击选项把该选项固定文案
    // 回填进输入框，由用户再次编辑；staff_role 统一记为 custom，最终提交值 = 输入框文本
    onStaffRoleTap(e) {
      const key = String((e.currentTarget.dataset || {}).key || '').trim()
      if (!key) {
        return
      }

      // 新增文案回填：按 key 找到对应选项，把固定文案填进输入框（用户可在输入框里继续修改）
      const matchedOption = STAFF_ROLE_OPTIONS.find((item) => item.key === key)
      if (!matchedOption) {
        return
      }

      this.setData({
        'staffForm.staff_role': STAFF_ROLE_CUSTOM,
        'staffForm.staff_role_custom': matchedOption.label
      })
    },

    // 新增自定义身份输入：限制长度，避免超长文本入库
    onStaffRoleCustomInput(e) {
      const value = String((e.detail && e.detail.value) || '').slice(0, STAFF_ROLE_CUSTOM_MAX_LENGTH)
      this.setData({
        'staffForm.staff_role_custom': value
      })
    },

    // 新增机构身份取值：预设枚举取标签文本，自填取用户输入值；未选择返回空串
    // 调整（2026-09-05）：统一取输入框文本提交——文本非空按 custom 协议提交（云函数取文本落库），
    // 文本为空视为未选择身份，不再依赖枚举 key
    getStaffRolePayload() {
      const staffForm = this.data.staffForm || {}
      const staffRoleCustom = String(staffForm.staff_role_custom || '').trim().slice(0, STAFF_ROLE_CUSTOM_MAX_LENGTH)

      if (!staffRoleCustom) {
        return { staff_role: '', staff_role_custom: '' }
      }

      return { staff_role: STAFF_ROLE_CUSTOM, staff_role_custom: staffRoleCustom }
    },

    // 新增机构身份保存（B 教练加入侧）：已经在机构里时，只把身份更新到该机构的成员项，
    // 不带 organization_basic，避免覆盖机构资料；身份仍只入库 NDLdev_organization
    onSaveStaffRole() {
      if (!this.data.hasJoinedOrganization) {
        wx.showToast({
          title: '请先加入机构',
          icon: 'none'
        })
        return
      }

      const staffRolePayload = this.getStaffRolePayload()
      // 调整（2026-09-05）：身份统一来自常驻输入框（选项只是回填文案），为空时提示选择或填写
      if (!staffRolePayload.staff_role) {
        wx.showToast({
          title: '请选择或填写机构身份',
          icon: 'none'
        })
        return
      }

      if (staffRolePayload.staff_role === STAFF_ROLE_CUSTOM && !staffRolePayload.staff_role_custom) {
        wx.showToast({
          title: '请填写自定义身份',
          icon: 'none'
        })
        return
      }

      this.submitOrganizationAction('updateOrganization', staffRolePayload, {
        successTitle: '身份已保存',
        // 新增保存后停留本页：身份只是一条字段，保存完继续留在创建页做别的编辑
        stayOnPage: true
      })
    },

    // 新增教练加入提交：填写邀请码校验通过后，才会成为机构执行教练
    onJoinOrganization() {
      if (!this.data.authReady) {
        wx.showToast({
          title: '请先完成教练认证',
          icon: 'none'
        })
        return
      }

      const invitationCode = String((((this.data || {}).joinForm || {}).invitation_code) || '').trim().toUpperCase()
      // 调整（2026-09-05）：邀请码已改为完全自定义（不再固定 16 位），这里只做非空校验，
      // 格式（英数大写）由 onJoinInput 输入过滤保证，是否有效由云函数按机构邀请码精确匹配
      if (!invitationCode) {
        wx.showToast({
          title: '请输入机构邀请码',
          icon: 'none'
        })
        return
      }

      // 新增身份随加入一起提交（B 教练加入侧收集）：云函数把身份写进该机构的
      // organization_member.coach_list 成员项 staff_role，不写入 NDLdev_users
      const staffRolePayload = this.getStaffRolePayload()
      if (staffRolePayload.staff_role === STAFF_ROLE_CUSTOM && !staffRolePayload.staff_role_custom) {
        wx.showToast({
          title: '请填写自定义身份',
          icon: 'none'
        })
        return
      }

      this.submitOrganizationAction('joinOrganization', {
        invitation_code: invitationCode,
        ...staffRolePayload
      }, {
        successTitle: '加入机构成功'
      })
    },

    // 新增机构操作统一提交：创建机构和教练加入都走同一个云函数
    // 拆分说明（2026-09-20）：本组件只保留 join 与 staffRole save 链路，
    // stayForQrcode 分支（create 专有）已下沉到 baseinformation 组件
    submitOrganizationAction(action, payload, options = {}) {
      if (this.data.isSubmitting) {
        return
      }

      const app = getApp()
      this.setData({
        isSubmitting: true,
        submitResultCard: null
      })
      wx.showLoading({
        title: '提交中...'
      })

      wx.cloud.callFunction({
        name: 'ForOrganizationDo',
        data: {
          action,
          envVersion: app.globalData.miniEnvVersion || 'develop',
          ...payload
        }
      }).then((res) => {
        const result = res && res.result ? res.result : {}
        if (result.status !== 'success') {
          wx.showToast({
            title: result.message || '提交失败',
            icon: 'none'
          })
          return
        }

        const organizationProfile = {
          orgId: result.organizationId || '',
          orgName: result.organizationName || '',
          memberRole: result.memberRole || '',
          inviteCode: result.invitationCode || '',
          joinedAt: result.joinedAt || '',
          source: action
        }

        if (app.saveUserIdentity) {
          app.saveUserIdentity({
            userRole: 'C',
            bizRole: action === 'joinOrganization' ? BIZ_ROLE_ORG_COACH : BIZ_ROLE_ORG_ADMIN,
            organizationProfile,
            needChooseRole: false
          })
        }

        // 新增结果卡片跨页透传：创建页提交成功后，结果卡片改到机构首页入口区展示
        const nextSubmitResultCard = {
          title: options.successTitle || '提交成功',
          organizationName: result.organizationName || '',
          invitationCode: result.invitationCode || '',
          memberRoleLabel: action === 'joinOrganization' ? '机构执行教练' : '机构管理层',
          message: result.message || '操作成功'
        }

        this.setData({
          submitResultCard: nextSubmitResultCard
        })

        wx.setStorageSync(ORGANIZATION_RESULT_CARD_STORAGE_KEY, nextSubmitResultCard)

        // 新增身份入库回填：云函数返回当前用户在机构成员项里的 staff_role，
        // 页面据此刷新身份选择区，避免前端选的值和最终落库值不一致
        if (result.staffRole !== undefined) {
          this.setData({
            staffForm: this.buildStaffFormFromSaved(result.staffRole)
          })
        }

        // 新增创建成功停留本页：机构入口二维码的生成 + 入库在 NEWDL_ResponseQRCode 云函数侧完成
        // （B 侧生成归属 B 的码 → 图片转存 A 侧云存储 → 入库 organization 文档 entry_qrcode 字段），
        // 前端就地展示返回结果，不再立即跳转机构首页
        // 拆分说明（2026-09-20）：stayForQrcode 分支已下沉到 baseinformation 组件，本组件不再处理

        wx.showToast({
          title: options.successTitle || '提交成功',
          icon: 'success'
        })

        // 新增保存后停留本页：身份保存这类单项提交不需要跳走，用户继续在当前页操作
        if (options.stayOnPage) {
          return
        }

        // 新增成功后自动回入口：用户提交成功后直接回机构首页看结果卡片，不用自己再点一次返回
        wx.switchTab({
          url: '/pages/organization/organization'
        })
      }).catch(() => {
        wx.showToast({
          title: '网络错误',
          icon: 'none'
        })
      }).finally(() => {
        wx.hideLoading()
        this.setData({
          isSubmitting: false
        })
      })
    },

    // 新增成功后返回机构入口：创建机构或加入机构后，统一回到机构入口页查看当前状态
    backToOrganizationEntry() {
      wx.switchTab({
        url: '/pages/organization/organization'
      })
    },

    // 新增下拉刷新入口（2026-09-20）：供宿主页面 onPullDownRefresh 调用，
    // 清除未保存编辑标记后整包回查认证状态与机构卡片
    refreshForPullDown() {
      this._hasUnsavedFormEdits = false
      return Promise.all([
        this.refreshCertificationState(),
        this.refreshCurrentOrganizationCard()
      ])
    }
  }
})
