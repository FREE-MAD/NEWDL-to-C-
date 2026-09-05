// pages/organization/organization.js
const {
  BIZ_ROLE_VISITOR,
  BIZ_ROLE_FREE_COACH,
  BIZ_ROLE_ORG_ADMIN,
  BIZ_ROLE_ORG_COACH,
  createEmptyOrganizationProfile
} = require('../../utils/bizRole')

const ORGANIZATION_RESULT_CARD_STORAGE_KEY = 'organizationEntryResultCard'
// 新增轮播空白态数据：当团队还没上传展示图时，swiper 固定展示“代码肌广告”空白占位
const DEFAULT_BRAND_SWIPER_LIST = [
  {
    imageUrl: '',
    emptyTitle: '代码肌广告',
    isEmptyState: true
  }
]
const DEFAULT_COACH_TEAM_LIST = [
  {
    avatar: '张',
    name: '张教练',
    role: '青少年体能训练',
    tag: '耐力 / 灵敏 / 协调',
    intro: '更擅长帮助基础薄弱的孩子先把运动习惯和身体底子建立起来。'
  },
  {
    avatar: '李',
    name: '李教练',
    role: '专项动作提升',
    tag: '跑跳投 / 动作纠正',
    intro: '更关注动作质量和专项表现，适合有明确提升目标的训练场景。'
  },
  {
    avatar: '王',
    name: '王教练',
    role: '陪练与阶段反馈',
    tag: '陪伴 / 节奏 / 反馈',
    intro: '擅长把训练过程讲清楚，让家长知道孩子练了什么、变好了什么。'
  }
]

// 新增入口第二张卡固定内容：入口区第 2 张卡不再随团队身份切换，
// 创建机构前后都保持最初的「教练加入团队」入口，只有第 1 张卡按身份变化
const DEFAULT_ENTRY_SECOND_ACTION = {
  title: '教练加入团队',
  desc: '适合团队执行教练。填写邀请码校验通过后，才会成为团队教练。',
  buttonText: '去加入',
  action: 'GO_JOIN_TAB'
}

// 新增团队语义角色文案：当前页展示统一使用“团队”表述，避免和业务层“机构”字段混用
function getOrganizationPageRoleLabel(bizRole = '') {
  if (bizRole === BIZ_ROLE_ORG_ADMIN) {
    return '团队管理层'
  }
  if (bizRole === BIZ_ROLE_ORG_COACH) {
    return '团队执行教练'
  }
  if (bizRole === BIZ_ROLE_FREE_COACH) {
    return '自由教练'
  }
  return '自由教练默认态'
}

Page({

  /**
   * 页面的初始数据
   */
  data: {
    // 新增机构入口状态：当前页承担“创建机构 / 教练加入机构”的正式入口，不再提供机构与个人手动切换
    currentBizRole: BIZ_ROLE_VISITOR,
    currentBizRoleLabel: '自由教练默认态',
    currentOrgName: '',
    hasJoinedOrganization: false,
    submitResultCard: null,
    entryTitle: '团队入口',
    entryDesc: '默认仍按自由教练使用；如果要进入团队体系，请从这里创建团队或填写邀请码加入团队。',
    entryHint: '创建团队和教练加入都在同一个页面里完成，成功后才会进入团队角色。',
    entryActionList: [],
    // 新增结构开关：旧版展示内容先保留但默认隐藏，避免直接删除已有结构和注释
    showLegacySection: false,
    // 新增品牌轮播数据：swiper 只显示图片；没有图片时退回写死的“代码肌广告”空白态
    brandSwiperList: DEFAULT_BRAND_SWIPER_LIST,
    // 新增品牌理念数据：用短句卡片把机构想表达的核心价值讲透
    philosophyList: [
      {
        title: '先看孩子适合什么',
        desc: '不是一上来就塞课程，而是先判断孩子目前基础、目标和节奏，先选对方向。'
      },
      {
        title: '训练过程要看得懂',
        desc: '把课程重点、训练方式和阶段变化表达清楚，让家长知道现在练到了哪一步。'
      },
      {
        title: '结果不是靠感觉',
        desc: '我们更重视持续陪伴和阶段反馈，让成长路径可复盘、可对比、可继续推进。'
      }
    ],
    // 新增教练团队数据：先用 scroll-view 横向卡片展示，后续可补头像和履历
    coachTeamList: DEFAULT_COACH_TEAM_LIST,
    // 新增机构展示页静态数据：先把机构宣传页需要展示的内容集中放在 data，后续接接口时更容易替换
    orgInfo: {
      badge: '团队展示',
      name: '深大体陪',
      slogan: '把运动陪伴、专项训练和阶段成长，做成家长看得见的结果',
      intro: '我们聚焦青少年运动陪伴、专项训练与阶段性提升，用更清晰的流程和更直观的反馈，让家长知道孩子现在适合做什么、进入后先做什么、完成后下一步去哪里。',
      subIntro: '页面当前先用于团队宣传展示，后续可继续接入课程入口、教练团队、真实案例和咨询转化链路。'
    },
    quickStats: [
      { value: '1v1', label: '个性化陪练' },
      { value: '小班', label: '同龄分层训练' },
      { value: '评估', label: '阶段成长反馈' }
    ],
    serviceList: [
      {
        title: '运动陪伴',
        desc: '适合需要稳定陪练节奏、培养运动习惯的孩子，先建立兴趣，再逐步拉起训练强度。'
      },
      {
        title: '专项提升',
        desc: '围绕跑跳投、球类、体测项目等专项需求，拆解动作、纠正问题、逐步提升表现。'
      },
      {
        title: '体能基础',
        desc: '针对耐力、协调、力量、灵敏等基础能力做组合训练，帮助孩子把底子先打稳。'
      },
      {
        title: '阶段评估',
        desc: '训练不是只上课，我们会把阶段变化整理成家长看得懂的结果反馈，知道有没有真正进步。'
      }
    ],
    fitCrowdList: [
      '想先让孩子动起来，但不知道从哪一步开始的家长',
      '已经在训练，但希望提升训练稳定性和效果反馈的家庭',
      '有体测、考试、专项提升目标，需要更清晰训练路径的学生',
      '希望兼顾兴趣培养、习惯养成和阶段成长的孩子'
    ],
    processList: [
      {
        step: '01',
        title: '先了解情况',
        desc: '先看孩子目前基础、目标和时间安排，明确是陪伴型、提升型还是冲刺型需求。'
      },
      {
        step: '02',
        title: '匹配训练方式',
        desc: '根据年龄、基础和目标，匹配更合适的训练节奏、课程形态和陪练方案。'
      },
      {
        step: '03',
        title: '开始阶段训练',
        desc: '从孩子能接受的强度切入，边练边观察，逐步建立动作质量和训练稳定性。'
      },
      {
        step: '04',
        title: '给到成长反馈',
        desc: '每个阶段都能看到训练重点、变化方向和下一步建议，不让家长只凭感觉判断。'
      }
    ],
    advantageList: [
      '不是只上课，更重视孩子长期坚持和阶段变化',
      '信息表达尽量说人话，让家长一眼知道现在处在哪一步',
      '训练目标、训练过程、训练反馈尽量连成完整链路',
      '后续可继续接入课程、案例、教练资料和咨询入口'
    ],
    bottomActionList: [
      '适合先做团队展示与品牌介绍',
      '适合后续承接课程报名和咨询转化',
      '适合放真实案例、教练团队、训练成果'
    ]
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 新增页面初始化：当前为静态展示页，先保留生命周期，后续可在这里接机构详情接口
    this.refreshEntryState()
    this.refreshCurrentOrganizationCard()
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    this.refreshEntryState()
    this.refreshCurrentOrganizationCard()
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    Promise.all([
      this.refreshEntryState(),
      this.refreshCurrentOrganizationCard()
    ]).finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {
    return {
      title: '深大体陪 | 团队入口',
      path: '/pages/organization/organization'
    }
  },

  // 新增机构入口状态构建：默认都是自由教练；只有成功创建机构或填写邀请码加入后，才进入机构角色
  buildEntryState(currentBizRole, currentOrgName) {
    if (currentBizRole === BIZ_ROLE_ORG_ADMIN) {
      return {
        entryTitle: `${currentOrgName || '当前团队'}管理入口`,
        entryDesc: '你已进入团队管理层身份，团队基础信息和团队课程都从这里继续操作。',
        entryHint: '第一张卡按当前身份切换，第二张卡固定保留“教练加入团队”入口，前后位置不变。',
        entryActionList: [
          {
            title: '修改信息',
            desc: '直接带着当前团队资料进入编辑页，改完就保存，邀请码继续保持原样。',
            buttonText: '去修改',
            action: 'GO_CREATE_TAB'
          },
          DEFAULT_ENTRY_SECOND_ACTION
        ]
      }
    }

    if (currentBizRole === BIZ_ROLE_ORG_COACH) {
      return {
        entryTitle: `${currentOrgName || '当前团队'}执行入口`,
        entryDesc: '你已作为团队教练加入团队，后续主要从这里进入执行课程和填写反馈。',
        entryHint: '团队执行教练不能直接建团队课程，需要先接团队分配的课程。',
        entryActionList: [
          {
            title: '待执行课程',
            desc: '查看团队分配给你的课程，继续带课、推进课节和填写总结。',
            buttonText: '去课程管理',
            action: 'GO_ORG_PROGRESS'
          },
          DEFAULT_ENTRY_SECOND_ACTION
        ]
      }
    }

    return {
      entryTitle: '团队入口',
      entryDesc: '默认仍是自由教练。如果你要进入团队体系，请先去创建团队或填写邀请码加入团队。',
      entryHint: '创建团队必须是已完成认证的教练；教练加入团队也必须先完成资料认证。',
      entryActionList: [
        {
          title: '创建团队',
          desc: '适合团队管理层。填写团队信息后生成团队邀请码，并自动成为该团队管理层。',
          buttonText: '去创建',
          action: 'GO_CREATE_TAB'
        },
        DEFAULT_ENTRY_SECOND_ACTION
      ]
    }
  },

  // 新增入口页状态刷新：统一从全局业务身份读取当前是管理层、执行层还是自由教练
  refreshEntryState() {
    const app = getApp()
    const businessIdentity = app.getBusinessIdentity ? app.getBusinessIdentity() : {
      bizRole: BIZ_ROLE_VISITOR,
      organizationProfile: createEmptyOrganizationProfile()
    }
    const currentBizRole = businessIdentity.bizRole || BIZ_ROLE_VISITOR
    const currentOrgName = String((((businessIdentity || {}).organizationProfile || {}).orgName) || '').trim()
    const nextEntryState = this.buildEntryState(currentBizRole, currentOrgName)

    this.setData({
      currentBizRole,
      currentBizRoleLabel: getOrganizationPageRoleLabel(currentBizRole),
      currentOrgName,
      hasJoinedOrganization: !!currentOrgName,
      ...nextEntryState
    })
    return Promise.resolve(nextEntryState)
  },

  // 新增首页结果卡片承接：创建页提交成功后，把结果卡片放到机构入口区和品牌模块之间展示
  refreshCurrentOrganizationCard() {
    const app = getApp()
    const currentIdentity = app.getBusinessIdentity ? app.getBusinessIdentity() : null
    const organizationProfile = (currentIdentity && currentIdentity.organizationProfile) || {}
    const orgId = String(organizationProfile.orgId || '').trim()
    const memberRole = String(organizationProfile.memberRole || '').trim()
    const pendingResultCard = wx.getStorageSync(ORGANIZATION_RESULT_CARD_STORAGE_KEY) || null

    if (!orgId) {
      this.setData({
        submitResultCard: pendingResultCard || null,
        brandSwiperList: DEFAULT_BRAND_SWIPER_LIST,
        coachTeamList: DEFAULT_COACH_TEAM_LIST
      })
      if (pendingResultCard) {
        wx.removeStorageSync(ORGANIZATION_RESULT_CARD_STORAGE_KEY)
      }
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
      const organizationBasic = (organizationDoc && organizationDoc.organization_basic) || {}
      const isAdminRole = memberRole === 'admin'
      const defaultCard = {
        title: '当前团队信息',
        organizationName: String(organizationBasic.organization_name || organizationProfile.orgName || '').trim(),
        invitationCode: String(organizationBasic.invitation_code || organizationProfile.inviteCode || '').trim(),
        memberRoleLabel: isAdminRole ? '团队管理层' : '团队执行教练',
        message: isAdminRole
          ? '你已经进入团队管理层，团队基础信息和邀请码会统一显示在这里。'
          : '你已经加入团队，当前团队名称和邀请码会统一显示在这里。'
      }

      this.setData({
        // 新增机构门面动态拉取：机构存在时，品牌轮播和教练团队都按当前机构已填写资料生成
        brandSwiperList: this.buildBrandSwiperList(organizationBasic),
        coachTeamList: this.buildCoachTeamList(organizationDoc),
        submitResultCard: pendingResultCard ? {
          ...defaultCard,
          ...pendingResultCard,
          organizationName: pendingResultCard.organizationName || defaultCard.organizationName,
          invitationCode: pendingResultCard.invitationCode || defaultCard.invitationCode,
          memberRoleLabel: pendingResultCard.memberRoleLabel || defaultCard.memberRoleLabel
        } : defaultCard
      })

      if (pendingResultCard) {
        wx.removeStorageSync(ORGANIZATION_RESULT_CARD_STORAGE_KEY)
      }
    }).catch(() => {
      this.setData({
        submitResultCard: pendingResultCard || null,
        brandSwiperList: DEFAULT_BRAND_SWIPER_LIST,
        coachTeamList: DEFAULT_COACH_TEAM_LIST
      })
      if (pendingResultCard) {
        wx.removeStorageSync(ORGANIZATION_RESULT_CARD_STORAGE_KEY)
      }
    })
  },

  // 新增品牌轮播动态组装：swiper 现在只展示图片，没有图片时统一回退到写死空白态
  buildBrandSwiperList(organizationBasic = {}) {
    const brandSwiperImages = Array.isArray(organizationBasic.brand_swiper_images)
      ? organizationBasic.brand_swiper_images.filter(item => String(item || '').trim())
      : []

    if (!brandSwiperImages.length) {
      return DEFAULT_BRAND_SWIPER_LIST
    }

    return brandSwiperImages.map((imageUrl) => ({
      imageUrl: String(imageUrl || '').trim(),
      emptyTitle: '',
      isEmptyState: false
    }))
  },

  // 新增教练团队动态组装：优先使用机构成员列表，没有成员时降级为机构联系人卡片
  buildCoachTeamList(organizationDoc = {}) {
    const organizationBasic = organizationDoc.organization_basic || {}
    const organizationMember = organizationDoc.organization_member || {}
    const adminList = Array.isArray(organizationMember.admin_list) ? organizationMember.admin_list : []
    const coachList = Array.isArray(organizationMember.coach_list) ? organizationMember.coach_list : []
    const mergedMemberList = adminList.concat(coachList)

    if (mergedMemberList.length) {
      return mergedMemberList.map((member) => {
        const nickname = String(member.nickname || '').trim() || '团队成员'
        const memberRole = String(member.member_role || '').trim()
        const phone = String(member.phone || '').trim()

        return {
          avatar: nickname.slice(0, 1) || '员',
          name: nickname,
          role: memberRole === 'admin' ? '团队管理层' : '团队执行教练',
          tag: phone ? `联系电话 ${phone}` : '团队成员',
          intro: memberRole === 'admin'
            ? '当前成员来自团队管理层列表，负责团队信息维护和课程发起。'
            : '当前成员来自团队教练列表，后续负责团队课程执行和反馈填写。'
        }
      })
    }

    const contactName = String(organizationBasic.contact_name || '').trim()
    const city = String(organizationBasic.city || '').trim()
    const intro = String(organizationBasic.intro || '').trim()
    if (!contactName) {
      return DEFAULT_COACH_TEAM_LIST
    }

    return [
      {
        avatar: contactName.slice(0, 1) || '教',
        name: contactName,
        role: city ? `${city}团队联系人` : '团队联系人',
        tag: '当前填写联系人',
        intro: intro || '当前还没有更多教练资料，先用团队联系人承接首页团队展示。'
      }
    ]
  },

  // 新增机构入口动作分发：当前只承接“创建机构 / 教练加入机构 / 查看机构课程”，不提供手动角色切换
  onEntryActionTap(e) {
    const action = e.currentTarget.dataset.action
    if (!action) {
      return
    }

    if (action === 'GO_CREATE_TAB') {
      wx.navigateTo({
        url: this.data.currentBizRole === BIZ_ROLE_ORG_ADMIN
          ? '/pages/organization/organization_create/organization_create?tab=create&mode=edit'
          : '/pages/organization/organization_create/organization_create?tab=create'
      })
      return
    }

    if (action === 'GO_JOIN_TAB') {
      wx.navigateTo({
        url: '/pages/organization/organization_create/organization_create?tab=join'
      })
      return
    }

    if (action === 'GO_ORG_CREATE_PAGE') {
      wx.navigateTo({
        url: '/pages/organization/organization_create/organization_create?tab=create'
      })
      return
    }

    if (action === 'GO_ORG_PUBLISH') {
      wx.navigateTo({
        url: '/pages/task/publish/publish?entryMode=org_admin'
      })
      return
    }

    if (action === 'GO_ORG_PROGRESS') {
      wx.switchTab({
        url: '/pages/task/progress/progress'
      })
      return
    }

    if (action === 'GO_PROFILE_EDIT') {
      wx.navigateTo({
        url: '/pages/index/profile/profile'
      })
    }
  },

  // 新增：复制机构邀请码到剪贴板，方便分享给其他教练或成员
  onCopyInvitationCode(e) {
    const dataset = (((e || {}).currentTarget || {}).dataset) || {}
    const normalizedCode = String(dataset.code || '').trim()
    if (!normalizedCode) {
      wx.showToast({
        title: '邀请码为空',
        icon: 'none',
        duration: 1500
      })
      return
    }
    wx.setClipboardData({
      data: normalizedCode,
      success: () => {
        wx.showToast({
          title: '邀请码已复制',
          icon: 'success',
          duration: 1500
        })
      },
      fail: () => {
        // 复制失败时降级：使用 modal 展示邀请码，让用户手动长按复制
        wx.showModal({
          title: '团队邀请码',
          content: normalizedCode,
          showCancel: false,
          confirmText: '我知道了'
        })
      }
    })
  }
})
