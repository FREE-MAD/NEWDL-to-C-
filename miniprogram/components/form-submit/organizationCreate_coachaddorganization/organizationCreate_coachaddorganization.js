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
// 新增（2026-09-21）：本地缓存「我已提交但还没被确认」的加入申请，
// 用于未正式加入（业务身份里还没有 orgId）时回查机构文档看申请是待确认还是被拒绝
const ORGANIZATION_JOIN_APPLY_STORAGE_KEY = 'organizationJoinApplyPending'

// 调整（2026-09-21）：B 教练加入的身份选项由「主教 / 副教练 / 指导 / 训练分析 / 自填」
// 换成「管理 / 执行」两项 ——
//   管理（admin）：管理层同意后进入 organization_member.admin_list，成为团队管理层；
//   执行（coach）：管理层同意后进入 organization_member.coach_list，成为团队执行教练。
// 身份仍然只归属「机构」这一层：只入库 NDLdev_organization 的成员项，不写入 NDLdev_users
//（users 侧的 biz_role / organization_profile 由云函数在管理层同意后统一写入）。
const JOIN_ROLE_ADMIN = 'admin'
const JOIN_ROLE_COACH = 'coach'
const JOIN_ROLE_OPTIONS = [
  { key: JOIN_ROLE_ADMIN, label: '管理' },
  { key: JOIN_ROLE_COACH, label: '执行' }
]
// 新增加入申请状态：none（没有申请）/ pending（等待创建者确认）/ rejected（已被拒绝，可重新提交）
const JOIN_APPLY_STATUS_NONE = 'none'
const JOIN_APPLY_STATUS_PENDING = 'pending'
const JOIN_APPLY_STATUS_REJECTED = 'rejected'

// 新增加入身份文案：管理 → 团队管理层，执行 → 团队执行教练
function getJoinRoleLabel(joinRole = '') {
  return String(joinRole || '').trim() === JOIN_ROLE_ADMIN ? '团队管理层' : '团队执行教练'
}

// 拆分说明（2026-09-20）：以下常量已下沉到 baseinformation 组件，本组件仅保留注释参考
// 新增（2026-09-05）：机构展示页区块二/三展示字段的编辑态默认值。
// 老机构文档里可能还没有这些字段（空串），回填时退到这里的默认（完整）值起步，
// 避免空表单 + 必填校验卡住保存。文案与 organization.js DEFAULT_INTRO_INFO_LIST 保持一致。
// 修正（2026-09-06）：编辑态回填已去掉这组默认值兜底（默认文案会被表单当真实值提交入库，
// 造成 org_1a0749 那样的默认值污染），常量仅作展示层参考文案保留，不再参与任何表单回填

Component({
  // 拆分说明（2026-09-20）：authReady 和 profile 由外壳 refreshCertificationState 加载后下传，
  // 组件不再自己调 getProfile；profile.avatarUrl/nickname 用于「我的资料」只读展示
  properties: {
    authReady: { type: Boolean, value: false },
    profile: { type: Object, value: { avatarUrl: '', nickname: '', phone: '' } }
  },

  // 拆分说明（2026-09-20）：profile 由外壳下传，组件直接用 property 渲染头像/称呼，
  // 不再维护 profileBrief 本地副本（WXML 已改为引用 profile.avatarUrl / profile.nickname）
  observers: {},

  /**
   * 组件的初始数据
   */
  data: {
    joinForm: {
      invitation_code: '',
      // 新增（2026-09-21）：加入身份 —— 管理（admin）/ 执行（coach），提交前必须选一项
      join_role: ''
    },
    // 调整（2026-09-21）：身份选项改为「管理 / 执行」两项（原主教 / 副教练 / 指导 / 训练分析 已移除）
    joinRoleOptions: JOIN_ROLE_OPTIONS,
    // 新增已加入机构标记：B 教练加入侧区分「未加入 → 填邀请码提交加入申请」与「已加入 → 只读展示身份」
    hasJoinedOrganization: false,
    // 新增已加入后的身份文案：团队管理层 / 团队执行教练（来自成员项 member_role）
    currentMemberRoleLabel: '',
    // 新增加入申请状态：none / pending / rejected
    joinApplyStatus: JOIN_APPLY_STATUS_NONE,
    // 新增加入申请摘要：待确认 / 被拒绝时展示机构名、申请身份、申请时间
    joinApplyInfo: null,
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
      // 拆分说明（2026-09-20）：refreshCertificationState 已上移到外壳，组件不再自己调 getProfile；
      // 头像/称呼展示改由 profile property 直接渲染
      this.refreshCurrentOrganizationCard()
    }
  },

  // 新增页面级生命周期：组件作为页面直接子节点时，页面 onShow 会透传到此处
  pageLifetimes: {
    show() {
      // 拆分说明（2026-09-20）：认证状态由外壳 onShow → refreshCertificationState 统一刷新，
      // 调整（2026-09-21）：回查字段改为 hasJoinedOrganization / joinForm.join_role / joinApplyStatus
      // 组件只回查机构资料（原 staffForm 已移除）
      this.refreshCurrentOrganizationCard()
    }
  },

  methods: {
    // 拆分说明（2026-09-20）：onTabTap 和 refreshCertificationState 已上移到外壳，
    // tab-bar 不再由本组件渲染，认证状态通过 authReady property 下传，
    // 头像/称呼通过 profile property 直接渲染

    // 新增进页机构回查：当前页仍保留机构资料回查，结果卡片展示改由机构首页承接
    // 拆分说明（2026-09-20）：本组件只回查 join 相关字段（hasJoinedOrganization / 加入身份 / 申请状态），
    // isEditMode / currentOrganizationId / createForm / supplementUnlocked / fetchOrganizationQrcodeForEdit
    // 已下沉到 baseinformation 组件
    // 调整（2026-09-21）：回查的 orgId 不再只取业务身份 —— 提交加入申请后身份里还没有 orgId，
    // 此时用本地缓存的申请记录里的 orgId 回查，才能展示「等待创建者确认 / 已被拒绝」
    refreshCurrentOrganizationCard() {
      const app = getApp()
      const currentIdentity = app.getBusinessIdentity ? app.getBusinessIdentity() : null
      const organizationProfile = (currentIdentity && currentIdentity.organizationProfile) || {}
      const identityOrgId = String(organizationProfile.orgId || '').trim()
      const identityMemberRole = String(organizationProfile.memberRole || '').trim()
      const cachedApply = wx.getStorageSync(ORGANIZATION_JOIN_APPLY_STORAGE_KEY) || null
      const cachedOrgId = String((cachedApply && cachedApply.orgId) || '').trim()
      const orgId = identityOrgId || cachedOrgId

      if (!orgId) {
        this.setData({
          submitResultCard: null,
          hasJoinedOrganization: false,
          joinApplyStatus: JOIN_APPLY_STATUS_NONE,
          joinApplyInfo: null
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
        const organizationName = String(organizationBasic.organization_name || '').trim()
        const invitationCode = String(organizationBasic.invitation_code || '').trim()
        const myOpenid = String(app.globalData.openid || '').trim()
        const organizationMember = organizationDoc.organization_member || {}
        const adminList = Array.isArray(organizationMember.admin_list) ? organizationMember.admin_list : []
        const coachList = Array.isArray(organizationMember.coach_list) ? organizationMember.coach_list : []
        // 新增（2026-09-21）：先按 openid 判断自己是不是正式成员（在 admin_list / coach_list 里）
        const memberList = [].concat(adminList, coachList)
        const myMemberItem = myOpenid
          ? memberList.find((item) => String((item && item.openid) || '').trim() === myOpenid)
          : null
        const hasJoinedOrganization = !!myMemberItem || !!identityOrgId
        // 身份文案取成员项 member_role 优先，成员项缺失时退回业务身份里的 memberRole
        const memberRole = String((myMemberItem && myMemberItem.member_role) || '').trim() || identityMemberRole
        const isAdminRole = memberRole === JOIN_ROLE_ADMIN

        // 新增加入申请状态回查：还没成为正式成员时，看 pending_list 里有没有自己那一条
        const pendingList = Array.isArray(organizationMember.pending_list) ? organizationMember.pending_list : []
        const myPendingItem = (myOpenid && !myMemberItem)
          ? pendingList.find((item) => String((item && item.openid) || '').trim() === myOpenid)
          : null
        let joinApplyStatus = JOIN_APPLY_STATUS_NONE
        let joinApplyInfo = null
        if (myMemberItem) {
          // 已经是正式成员：本地缓存的申请记录可以清掉了
          wx.removeStorageSync(ORGANIZATION_JOIN_APPLY_STORAGE_KEY)
          // 新增（2026-09-21）审批通过即时生效：管理层同意后云函数已经把机构归属写进对方 users 文档，
          // 但对方本地身份（storage / globalData）还是旧的自由教练态。这里就地补写一次本地身份，
          // 让对方不用重新登录就能直接按机构身份使用；已经有 orgId 时不重复写
          if (!identityOrgId && app.saveUserIdentity) {
            app.saveUserIdentity({
              userRole: 'C',
              bizRole: isAdminRole ? BIZ_ROLE_ORG_ADMIN : BIZ_ROLE_ORG_COACH,
              organizationProfile: {
                orgId,
                orgName: organizationName,
                memberRole,
                inviteCode: invitationCode,
                joinedAt: String((myMemberItem && myMemberItem.joined_at) || '').trim(),
                source: 'joinOrganization'
              },
              needChooseRole: false
            })
          }
        } else if (myPendingItem) {
          joinApplyStatus = String(myPendingItem.status || '').trim() === JOIN_APPLY_STATUS_REJECTED
            ? JOIN_APPLY_STATUS_REJECTED
            : JOIN_APPLY_STATUS_PENDING
          joinApplyInfo = {
            organizationName: organizationName || String((cachedApply && cachedApply.organizationName) || '').trim(),
            joinRoleLabel: getJoinRoleLabel(myPendingItem.join_role),
            appliedAtText: this.formatApplyTime(myPendingItem.applied_at),
            reviewRemark: String(myPendingItem.review_remark || '').trim()
          }
        } else {
          // 既不是成员也没有待审记录（申请被清理 / 缓存过期）：清掉本地缓存回到初始态
          wx.removeStorageSync(ORGANIZATION_JOIN_APPLY_STORAGE_KEY)
        }

        // 用户已经手动选过身份时保留当前选择，避免编辑中途返回页面被回查覆盖
        const nextJoinRole = String((((this.data || {}).joinForm || {}).join_role) || '').trim()
          || (myMemberItem ? memberRole : '')

        let submitResultCard = null
        if (hasJoinedOrganization) {
          submitResultCard = {
            title: '当前已加入机构',
            organizationName,
            invitationCode,
            memberRoleLabel: isAdminRole ? '机构管理层' : '机构执行教练',
            message: isAdminRole
              ? '你当前已经在机构内，下面这张卡展示的是机构最新邀请码和基础信息。'
              : '你当前已经加入机构，下面这张卡展示的是机构最新邀请码和基础信息。'
          }
        } else if (joinApplyStatus === JOIN_APPLY_STATUS_PENDING) {
          submitResultCard = {
            title: '加入申请待确认',
            organizationName,
            invitationCode,
            memberRoleLabel: joinApplyInfo ? joinApplyInfo.joinRoleLabel : '待确认',
            message: '已提交加入申请，等待团队创建者确认后才会正式成为团队成员。'
          }
        }

        this.setData({
          // 新增已加入标记：在成员列表里（或业务身份里已有机构）才算正式加入
          hasJoinedOrganization,
          currentMemberRoleLabel: hasJoinedOrganization
            ? (isAdminRole ? '团队管理层' : '团队执行教练')
            : '',
          joinApplyStatus,
          joinApplyInfo,
          'joinForm.join_role': nextJoinRole,
          submitResultCard
        })
        // 拆分说明（2026-09-20）：updateInviteCodePreview 与 fetchOrganizationQrcodeForEdit
        // 已下沉到 baseinformation 组件，本组件不再调用
      }).catch(() => {
        // 新增查询失败兜底：进页拉取失败时不覆盖当前卡片，避免把已有结果清空
      })
    },

    // 新增（2026-09-21）：申请时间格式化 —— 云函数返回的可能是 Date 序列化串 / Date 对象 / 时间戳
    formatApplyTime(rawTime) {
      if (!rawTime) {
        return ''
      }
      const parsed = new Date(rawTime)
      if (isNaN(parsed.getTime())) {
        return ''
      }
      const pad = (value) => (value < 10 ? `0${value}` : String(value))
      return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
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

    // 新增（2026-09-21）加入身份选择：管理 / 执行 二选一。
    // 管理 → 同意后进 admin_list（团队管理层）；执行 → 同意后进 coach_list（团队执行教练）。
    // 已正式加入团队后不允许自己改身份（改身份需要团队管理层在「团队管理」里处理），点击无效。
    onJoinRoleTap(e) {
      if (this.data.hasJoinedOrganization) {
        return
      }

      const key = String((e.currentTarget.dataset || {}).key || '').trim()
      if (key !== JOIN_ROLE_ADMIN && key !== JOIN_ROLE_COACH) {
        return
      }

      this.setData({
        'joinForm.join_role': key
      })
    },

    // 新增（2026-09-21）加入身份取值：未选择返回空串，由提交侧拦截提示
    getJoinRolePayload() {
      const joinRole = String((((this.data || {}).joinForm || {}).join_role) || '').trim()
      return joinRole === JOIN_ROLE_ADMIN ? { join_role: JOIN_ROLE_ADMIN } : { join_role: JOIN_ROLE_COACH }
    },

    // 新增机构身份保存（B 教练加入侧）：已经在机构里时，只把身份更新到该机构的成员项，
    // 不带 organization_basic，避免覆盖机构资料；身份仍只入库 NDLdev_organization
    // 调整（2026-09-21）：身份改为「管理 / 执行」后由管理层审批决定，本按钮不再使用（保留方法不删除）
    onSaveStaffRole() {
      if (!this.data.hasJoinedOrganization) {
        wx.showToast({
          title: '请先加入机构',
          icon: 'none'
        })
        return
      }

      const staffRolePayload = { staff_role: '', staff_role_custom: '' }
      this.submitOrganizationAction('updateOrganization', staffRolePayload, {
        successTitle: '身份已保存',
        // 新增保存后停留本页：身份只是一条字段，保存完继续留在创建页做别的编辑
        stayOnPage: true
      })
    },

    // 新增教练加入提交：填写邀请码 + 选择加入身份（管理 / 执行）
    // 调整（2026-09-21）：校验通过后不再是直接成为机构成员 —— 云函数把申请写进
    // organization_member.pending_list 置为 pending，等待机构创建者（管理层）在「团队管理」里确认
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

      // 新增（2026-09-21）：加入身份必选 —— 管理（进管理层）/ 执行（进执行教练），
      // 二选一必填，未选直接拦下，避免申请进待审列表后管理层不知道要给什么身份
      const joinRole = String((((this.data || {}).joinForm || {}).join_role) || '').trim()
      if (joinRole !== JOIN_ROLE_ADMIN && joinRole !== JOIN_ROLE_COACH) {
        wx.showToast({
          title: '请选择加入身份',
          icon: 'none'
        })
        return
      }

      this.submitOrganizationAction('joinOrganization', {
        invitation_code: invitationCode,
        join_role: joinRole
      }, {
        successTitle: '申请已提交'
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

        // 新增（2026-09-21）：加入申请进入待审 —— 此时还不是团队成员，
        // ① 不写本地业务身份（orgId 为空会把自由教练误判成机构身份）；
        // ② 不跳机构首页，停留在本页展示「等待创建者确认」卡片；
        // ③ 把机构 ID 与申请信息缓存到本地，下次进页用 orgId 回查申请状态
        if (String(result.joinStatus || '').trim() === JOIN_APPLY_STATUS_PENDING) {
          const pendingOrgId = String(result.organizationId || '').trim()
          const pendingJoinRole = String(result.joinRole || result.memberRole || '').trim() || JOIN_ROLE_COACH
          const nextJoinApplyInfo = {
            organizationName: String(result.organizationName || '').trim(),
            joinRoleLabel: getJoinRoleLabel(pendingJoinRole),
            appliedAtText: this.formatApplyTime(result.appliedAt),
            reviewRemark: ''
          }

          if (pendingOrgId) {
            wx.setStorageSync(ORGANIZATION_JOIN_APPLY_STORAGE_KEY, {
              orgId: pendingOrgId,
              organizationName: String(result.organizationName || '').trim(),
              invitationCode: String(result.invitationCode || '').trim(),
              joinRole: pendingJoinRole,
              appliedAt: result.appliedAt || ''
            })
          }

          this.setData({
            hasJoinedOrganization: false,
            joinApplyStatus: JOIN_APPLY_STATUS_PENDING,
            joinApplyInfo: nextJoinApplyInfo,
            submitResultCard: {
              title: '加入申请待确认',
              organizationName: String(result.organizationName || '').trim(),
              invitationCode: String(result.invitationCode || '').trim(),
              memberRoleLabel: nextJoinApplyInfo.joinRoleLabel,
              message: '已提交加入申请，等待团队创建者确认后才会正式成为团队成员。'
            }
          })

          wx.showToast({
            title: '已提交，待确认',
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

        // 调整（2026-09-21）：加入身份可能是管理也可能是执行，业务角色按云函数回传的 memberRole 决定
        const joinedMemberRole = String(result.memberRole || '').trim()
        const isJoinedAdmin = joinedMemberRole === JOIN_ROLE_ADMIN

        if (app.saveUserIdentity) {
          app.saveUserIdentity({
            userRole: 'C',
            bizRole: action === 'joinOrganization'
              ? (isJoinedAdmin ? BIZ_ROLE_ORG_ADMIN : BIZ_ROLE_ORG_COACH)
              : BIZ_ROLE_ORG_ADMIN,
            organizationProfile,
            needChooseRole: false
          })
        }

        // 新增结果卡片跨页透传：创建页提交成功后，结果卡片改到机构首页入口区展示
        const nextSubmitResultCard = {
          title: options.successTitle || '提交成功',
          organizationName: result.organizationName || '',
          invitationCode: result.invitationCode || '',
          memberRoleLabel: action === 'joinOrganization' ? getJoinRoleLabel(joinedMemberRole) : '机构管理层',
          message: result.message || '操作成功'
        }

        this.setData({
          submitResultCard: nextSubmitResultCard,
          // 新增（2026-09-21）：加入成功后回填当前身份文案（管理 → 团队管理层 / 执行 → 团队执行教练）
          hasJoinedOrganization: action === 'joinOrganization' ? true : this.data.hasJoinedOrganization,
          currentMemberRoleLabel: action === 'joinOrganization' ? getJoinRoleLabel(joinedMemberRole) : this.data.currentMemberRoleLabel
        })

        wx.setStorageSync(ORGANIZATION_RESULT_CARD_STORAGE_KEY, nextSubmitResultCard)

        // 新增（2026-09-21）：正式加入后本地缓存的「待确认申请」可以清掉了
        wx.removeStorageSync(ORGANIZATION_JOIN_APPLY_STORAGE_KEY)
        this.setData({
          joinApplyStatus: JOIN_APPLY_STATUS_NONE,
          joinApplyInfo: null
        })

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
    // 清除未保存编辑标记后整包回查机构卡片
    // 拆分说明（2026-09-20）：认证状态已由外壳 onPullDownRefresh → refreshCertificationState 统一刷新，
    // 本组件下拉刷新只回查机构资料
    refreshForPullDown() {
      this._hasUnsavedFormEdits = false
      return this.refreshCurrentOrganizationCard()
    }
  }
})
