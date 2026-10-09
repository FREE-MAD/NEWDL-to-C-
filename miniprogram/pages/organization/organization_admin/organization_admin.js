// pages/organization/organization_admin/organization_admin.js
// 团队管理（2026-09-21 新建）：机构创建者 / 管理层专用。
// 入口：机构首页 entry-section > entry-action-list 的「团队管理」卡（仅 org_admin 展示）。
// 职责：
//   ① 待确认申请 —— 教练提交加入（邀请码 + 身份：管理 / 执行）后先进 organization_member.pending_list，
//      管理层在这里「同意 / 拒绝」；同意后云函数把该成员写进 admin_list / coach_list 并更新对方业务身份；
//   ② 团队成员 —— 展示 admin_list（管理层）+ coach_list（执行教练）。
// 说明：只读部分走客户端直查 organization 集合（与机构首页 organization.js 同一读法）；
//       审批写操作一律走 ForOrganizationDo 云函数的 reviewJoinRequest 动作（客户端无写权限）。

const {
  BIZ_ROLE_ORG_ADMIN
} = require('../../../utils/bizRole')

// 新增加入申请状态：pending（待确认）/ rejected（已拒绝）
const JOIN_APPLY_STATUS_PENDING = 'pending'
const JOIN_APPLY_STATUS_REJECTED = 'rejected'
// 新增加入身份：admin（管理）/ coach（执行）
const JOIN_ROLE_ADMIN = 'admin'
const JOIN_ROLE_COACH = 'coach'
// 新增加入审核决策：approve（同意）/ reject（拒绝）
const JOIN_DECISION_APPROVE = 'approve'
const JOIN_DECISION_REJECT = 'reject'
// 新增默认团队头像兜底：成员没存头像时用文字首字占位（与机构首页成员展示保持一致的降级策略）
const DEFAULT_COACH_AVATAR = {
  男: 'cloud://cloud1-6gh7jgl8c5b16a83.636c-cloud1-6gh7jgl8c5b16a83-1398046944/NEWDL/users/默认头像defaultavatar/default_coach_avatar_male_cropped.png',
  女: 'cloud://cloud1-6gh7jgl8c5b16a83.636c-cloud1-6gh7jgl8c5b16a83-1398046944/NEWDL/users/默认头像defaultavatar/default_coach_avatar_female_cropped.png'
}

// 新增加入身份文案：管理 → 团队管理层，执行 → 团队执行教练
function getJoinRoleLabel(joinRole = '') {
  return String(joinRole || '').trim() === JOIN_ROLE_ADMIN ? '团队管理层' : '团队执行教练'
}

// 新增成员角色文案：admin_list → 团队管理层，coach_list → 团队执行教练
function getMemberRoleLabel(memberRole = '') {
  return String(memberRole || '').trim() === JOIN_ROLE_ADMIN ? '团队管理层' : '团队执行教练'
}

Page({

  /**
   * 页面的初始数据
   */
  data: {
    // 新增页面状态：loading（首次加载）/ unauthorized（不是团队管理层）/ ready（正常展示）
    pageState: 'loading',
    pageStateTip: '正在加载团队管理信息...',
    organizationName: '',
    invitationCode: '',
    // 新增待确认加入申请列表
    pendingApplyList: [],
    // 新增团队成员列表（管理层在前，执行教练在后）
    memberList: [],
    // 新增审批中的 openid：避免同一个申请被连续点两次
    reviewingOpenid: '',
    isRefreshing: false
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad() {
    this.refreshAdminState()
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    this.refreshAdminState()
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    this.refreshAdminState().finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    return {
      title: '团队管理',
      path: '/pages/organization/organization_admin/organization_admin'
    }
  },

  // 新增团队管理数据刷新：先取业务身份里的机构归属，再直查机构文档拼装两个列表
  refreshAdminState() {
    const app = getApp()
    const currentIdentity = app.getBusinessIdentity ? app.getBusinessIdentity() : null
    const organizationProfile = (currentIdentity && currentIdentity.organizationProfile) || {}
    const orgId = String(organizationProfile.orgId || '').trim()
    const memberRole = String(organizationProfile.memberRole || '').trim()
    const bizRole = String((currentIdentity && currentIdentity.bizRole) || '').trim()

    // 新增无机构兜底：还没创建 / 加入团队时，引导用户先回机构首页完成创建或加入
    if (!orgId) {
      this.setData({
        pageState: 'unauthorized',
        pageStateTip: '你还没有加入团队，请先回到机构入口创建团队或填写邀请码加入团队。',
        organizationName: '',
        invitationCode: '',
        pendingApplyList: [],
        memberList: []
      })
      return Promise.resolve()
    }

    // 新增权限兜底：只有团队管理层能处理加入申请，执行教练进来只给提示不做数据展示
    const isAdmin = bizRole === BIZ_ROLE_ORG_ADMIN || memberRole === JOIN_ROLE_ADMIN
    if (!isAdmin) {
      this.setData({
        pageState: 'unauthorized',
        pageStateTip: '只有团队管理层可以使用团队管理，执行教练请在机构首页查看待执行课程。',
        organizationName: '',
        invitationCode: '',
        pendingApplyList: [],
        memberList: []
      })
      return Promise.resolve()
    }

    const db = wx.cloud.database({
      env: app.globalData.env
    })
    const organizationCollectionName = `${app.globalData.dataPrefix || 'NDLdev_'}organization`

    this.setData({
      isRefreshing: true
    })

    return db.collection(organizationCollectionName).where({
      'organization_basic.organization_id': orgId
    }).limit(1).get().then((res) => {
      const organizationDoc = Array.isArray(res.data) && res.data.length ? res.data[0] : null
      if (!organizationDoc) {
        this.setData({
          pageState: 'unauthorized',
          pageStateTip: '未找到当前团队资料，请下拉刷新或稍后重试。',
          pendingApplyList: [],
          memberList: []
        })
        return
      }

      const organizationBasic = organizationDoc.organization_basic || {}
      this.setData({
        pageState: 'ready',
        pageStateTip: '',
        organizationName: String(organizationBasic.organization_name || '').trim(),
        invitationCode: String(organizationBasic.invitation_code || '').trim(),
        pendingApplyList: this.buildPendingApplyList(organizationDoc),
        memberList: this.buildMemberList(organizationDoc)
      })
    }).catch((err) => {
      // 新增失败兜底：保留提示文案，不把已有列表清掉，避免下拉刷新失败瞬间白屏
      console.error('[organization_admin][ERROR] refreshAdminState.fail', {
        orgId,
        message: err && (err.message || err.errMsg) ? (err.message || err.errMsg) : String(err)
      })
      this.setData({
        pageState: 'ready',
        pageStateTip: ''
      })
      wx.showToast({
        title: '团队信息加载失败',
        icon: 'none'
      })
    }).finally(() => {
      this.setData({
        isRefreshing: false
      })
    })
  },

  // 新增待确认申请列表组装：只展示 status=pending 的条目，按申请时间倒序（最新在前）
  buildPendingApplyList(organizationDoc = {}) {
    const organizationMember = organizationDoc.organization_member || {}
    const pendingList = Array.isArray(organizationMember.pending_list) ? organizationMember.pending_list : []

    return pendingList
      .filter((item) => String((item && item.status) || '').trim() === JOIN_APPLY_STATUS_PENDING)
      .map((item) => ({
        openid: String(item.openid || '').trim(),
        nickname: String(item.nickname || '').trim() || '未设置称呼',
        avatarUrl: String(item.avatarUrl || '').trim() || DEFAULT_COACH_AVATAR.男,
        phone: String(item.phone || '').trim(),
        joinRole: String(item.join_role || '').trim() === JOIN_ROLE_ADMIN ? JOIN_ROLE_ADMIN : JOIN_ROLE_COACH,
        joinRoleLabel: getJoinRoleLabel(item.join_role),
        appliedAtText: this.formatTime(item.applied_at)
      }))
      .reverse()
  },

  // 新增团队成员列表组装：管理层（admin_list）在前，执行教练（coach_list）在后
  // 调整（2026-09-21）：成员展示角色直接用成员项 member_role，不再依赖旧的 staff_role 岗位文案
  buildMemberList(organizationDoc = {}) {
    const organizationMember = organizationDoc.organization_member || {}
    const adminList = Array.isArray(organizationMember.admin_list) ? organizationMember.admin_list : []
    const coachList = Array.isArray(organizationMember.coach_list) ? organizationMember.coach_list : []

    return [].concat(adminList, coachList).map((item) => {
      const nickname = String(item.nickname || '').trim() || '团队成员'
      const memberRole = String(item.member_role || '').trim() === JOIN_ROLE_ADMIN ? JOIN_ROLE_ADMIN : JOIN_ROLE_COACH
      return {
        openid: String(item.openid || '').trim(),
        nickname,
        avatarText: nickname.slice(0, 1) || '员',
        avatarUrl: String(item.avatarUrl || '').trim() || DEFAULT_COACH_AVATAR.男,
        phone: String(item.phone || '').trim(),
        memberRole,
        roleLabel: getMemberRoleLabel(memberRole),
        joinedAtText: this.formatTime(item.joined_at)
      }
    })
  },

  // 新增时间格式化：云函数返回的可能是 Date 序列化串 / Date 对象 / 时间戳
  formatTime(rawTime) {
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

  // 新增加入申请同意：二次确认后调云函数 reviewJoinRequest(decision=approve)。
  // 同意后云函数按申请身份（管理 / 执行）把对方写进 admin_list / coach_list，并更新对方业务身份
  onApproveApply(e) {
    const dataset = (((e || {}).currentTarget || {}).dataset) || {}
    const applyOpenid = String(dataset.openid || '').trim()
    const joinRole = String(dataset.role || '').trim() === JOIN_ROLE_ADMIN ? JOIN_ROLE_ADMIN : JOIN_ROLE_COACH
    if (!applyOpenid) {
      return
    }

    const applyItem = (this.data.pendingApplyList || []).find(
      (item) => String(item.openid || '').trim() === applyOpenid
    )
    const nickname = (applyItem && applyItem.nickname) || '该教练'

    wx.showModal({
      title: '同意加入申请',
      content: `同意后「${nickname}」将成为${getJoinRoleLabel(joinRole)}，并可以进入团队相关功能。`,
      confirmText: '同意',
      cancelText: '再看看',
      success: (res) => {
        if (!res.confirm) {
          return
        }
        this.submitReview(applyOpenid, JOIN_DECISION_APPROVE, '')
      }
    })
  },

  // 新增加入申请拒绝：二次确认后调云函数 reviewJoinRequest(decision=reject)。
  // 拒绝只标记该条申请为 rejected，对方可以在加入页看到「未通过」并重新提交
  onRejectApply(e) {
    const dataset = (((e || {}).currentTarget || {}).dataset) || {}
    const applyOpenid = String(dataset.openid || '').trim()
    if (!applyOpenid) {
      return
    }

    const applyItem = (this.data.pendingApplyList || []).find(
      (item) => String(item.openid || '').trim() === applyOpenid
    )
    const nickname = (applyItem && applyItem.nickname) || '该教练'

    wx.showModal({
      title: '拒绝加入申请',
      content: `拒绝后「${nickname}」不会成为团队成员，对方可以重新提交申请。`,
      confirmText: '拒绝',
      confirmColor: '#d9485f',
      cancelText: '再看看',
      success: (res) => {
        if (!res.confirm) {
          return
        }
        this.submitReview(applyOpenid, JOIN_DECISION_REJECT, '团队管理层拒绝了该申请')
      }
    })
  },

  // 新增审批提交：统一走 ForOrganizationDo 的 reviewJoinRequest 动作，
  // 传 organization_id 显式定位机构（避免依赖云函数侧的当前用户归属判断）
  submitReview(applyOpenid = '', decision = '', reviewRemark = '') {
    if (!applyOpenid || this.data.reviewingOpenid) {
      return
    }

    const app = getApp()
    const currentIdentity = app.getBusinessIdentity ? app.getBusinessIdentity() : null
    const organizationProfile = (currentIdentity && currentIdentity.organizationProfile) || {}
    const organizationId = String(organizationProfile.orgId || '').trim()
    if (!organizationId) {
      wx.showToast({
        title: '未检测到团队 ID',
        icon: 'none'
      })
      return
    }

    this.setData({
      reviewingOpenid: applyOpenid
    })
    wx.showLoading({
      title: '处理中...',
      mask: true
    })

    wx.cloud.callFunction({
      name: getApp().getFnName('ForOrganizationDo'),
      data: {
        action: 'reviewJoinRequest',
        envVersion: app.globalData.miniEnvVersion || 'develop',
        organization_id: organizationId,
        apply_openid: applyOpenid,
        decision,
        review_remark: reviewRemark
      }
    }).then((res) => {
      const result = res && res.result ? res.result : {}
      if (result.status !== 'success') {
        wx.showToast({
          title: String(result.message || '处理失败，请稍后重试').slice(0, 30),
          icon: 'none'
        })
        // 失败也刷一次列表：可能是该申请已被别处处理，刷新后能看到最新状态
        return this.refreshAdminState()
      }

      wx.showToast({
        title: decision === JOIN_DECISION_APPROVE ? '已同意加入' : '已拒绝申请',
        icon: 'success'
      })
      return this.refreshAdminState()
    }).catch((err) => {
      console.error('[organization_admin][ERROR] submitReview.fail', {
        applyOpenid: applyOpenid.slice(0, 10) + '...',
        decision,
        message: err && (err.message || err.errMsg) ? (err.message || err.errMsg) : String(err)
      })
      wx.showToast({
        title: '网络错误，请稍后重试',
        icon: 'none'
      })
    }).finally(() => {
      wx.hideLoading()
      this.setData({
        reviewingOpenid: ''
      })
    })
  },

  // 新增邀请码复制：管理层把邀请码发给教练，教练在加入页填写后才能发起申请
  onCopyInvitationCode() {
    const invitationCode = String(this.data.invitationCode || '').trim()
    if (!invitationCode) {
      wx.showToast({
        title: '邀请码为空',
        icon: 'none'
      })
      return
    }

    wx.setClipboardData({
      data: invitationCode,
      success: () => {
        wx.showToast({
          title: '邀请码已复制',
          icon: 'success'
        })
      }
    })
  },

  // 新增无权限 / 无团队时的返回入口：统一回机构首页（tab 页，用 switchTab）
  backToOrganizationEntry() {
    wx.switchTab({
      url: '/pages/organization/organization'
    })
  }
})
