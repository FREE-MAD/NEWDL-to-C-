// pages/organization/organization.js
const {
  BIZ_ROLE_VISITOR,
  BIZ_ROLE_FREE_COACH,
  BIZ_ROLE_ORG_ADMIN,
  BIZ_ROLE_ORG_COACH,
  createEmptyOrganizationProfile
} = require('../../utils/bizRole')

const ORGANIZATION_RESULT_CARD_STORAGE_KEY = 'organizationEntryResultCard'
// 改造长图设计：organization_show 改为海军蓝 + 红色斜切 + 白卡堆叠，机构介绍与团队成员使用新默认值
// 注意：以下默认值对应设计稿 "星耀体育训练中心"，后续接真实接口时改为按 organization_basic 动态生成
const DEFAULT_BRAND_HEADER_IMAGE = '' // 训练现场图片（豆包 AI 生成稿），由管理层上传后填到 organization_basic.brand_header_image
// 新增 Hero 轮播默认数据：一张图都没有时只保留 1 屏占位，避免出现空白轮播
const DEFAULT_BRAND_HERO_SLIDES = [{ imageUrl: DEFAULT_BRAND_HEADER_IMAGE }]
const DEFAULT_ORGANIZATION_PROFILE = {
  organizationName: '代码肌 · 跃动邻',
  slogan: '用代码连接体育，让专业能力被看见'
}
// 补充（2026-09-05）：机构简介卡改为固定结构，接入区块二新收集的真实字段
// （核心服务 core_services / 服务区域 service_area / 适合谁 target_audience / 教练理念 coaching_philosophy），
// 每行缺省时退到这里的默认（完整）值，保证展示区永远完整不空
// 调整（2026-09-05）：「成立时间」行非必要已移除（创建表单未收集 established_year），现为 4 行
const DEFAULT_INTRO_INFO_LIST = [
  { label: '核心服务：', value: '体育数字化工具、教练服务连接、机构展示' },
  { label: '服务区域：', value: '不只深圳南山，软件链接万物' },
  { label: '适合群体：', value: '体育教练、体育机构及有运动服务需求的用户' },
  { label: '品牌理念：', value: '用代码提升体育服务效率，让专业更容易被看见' }
]
// 调整（2026-09-06）：团队成员改为「一人一行」展示，默认/兜底只保留 1 名示例成员；
// 真实成员加入后按加入顺序向下追加，列表最多同时展示 5 人，超过 5 人由展示层折叠展开
// 新增（2026-09-06）：成员无真实头像时不再展示红底首字，改用与资料页一致的官方默认头像图片。
// 注意：以下 cloud fileID 与 profile.js DEFAULT_COACH_AVATAR 保持一致，改动时必须两端同步；
// 成员项入库时未保存性别，无性别可判时统一用「男」默认头像兜底。
const DEFAULT_COACH_AVATAR = {
  男: 'cloud://cloud1-6gh7jgl8c5b16a83.636c-cloud1-6gh7jgl8c5b16a83-1398046944/NEWDL/users/默认头像defaultavatar/default_coach_avatar_male_cropped.png',
  女: 'cloud://cloud1-6gh7jgl8c5b16a83.636c-cloud1-6gh7jgl8c5b16a83-1398046944/NEWDL/users/默认头像defaultavatar/default_coach_avatar_female_cropped.png'
}
const DEFAULT_TEAM_MEMBER_LIST = [
  { avatar: '王', avatarUrl: DEFAULT_COACH_AVATAR.男, name: '王教练', role: '篮球主教练' }
]
// 旧版 organization_show 数据保留：legacy / showLegacySection 仍可能引用，先继续维护
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
  desc: '适合团队执行教练。填写邀请码并选择加入身份（管理 / 执行）后提交，需团队创建者确认。',
  buttonText: '去加入',
  action: 'GO_JOIN_TAB'
}

// 新增（2026-09-21）团队管理层专属入口卡：只有 org_admin 展示。
// 去向 pages/organization/organization_admin/organization_admin，用于查看团队成员、
// 处理教练提交的加入申请（同意 / 拒绝）。待确认数量由 refreshCurrentOrganizationCard 回填成 badge。
const DEFAULT_ENTRY_ADMIN_MANAGE_ACTION = {
  title: '团队管理',
  desc: '查看团队成员，处理教练加入申请；同意后对方才正式成为团队成员。',
  buttonText: '去管理',
  action: 'GO_ORG_ADMIN',
  badge: ''
}
// 新增加入申请待确认状态（云函数 pending_list 里的 status 值）
const JOIN_APPLY_STATUS_PENDING = 'pending'

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
    // 新增（2026-09-21）待确认加入申请数量：仅团队管理层有值，回填到「团队管理」入口卡的徽标上
    pendingApplyCount: 0,
    // 新增结构开关：旧版展示内容先保留但默认隐藏，避免直接删除已有结构和注释
    showLegacySection: false,
    // 改造 organization_show 长图设计：海军蓝背景 + 红斜切 + 白卡（机构简介 / 团队成员）
    // 新增 organization_show 顶部品牌头图：未上传时退到海军蓝占位，后续由 organization_basic.brand_header_image 填充
    brandHeaderImage: DEFAULT_BRAND_HEADER_IMAGE,
    // 新增 Hero 轮播数据：brandHeaderImage 为兼容字段，始终等于轮播第一张图
    brandHeroSlides: DEFAULT_BRAND_HERO_SLIDES,
    brandHeroCurrent: 0,
    // 新增 organization_show 顶部品牌文案：团队名 + 副标题，对应设计稿标题层
    organizationProfile: DEFAULT_ORGANIZATION_PROFILE,
    // 新增机构简介字段列表：成立时间 / 课程项目 / 招生对象 / 训练理念 4 行固定结构
    // 调整（2026-09-05）：改为 4 行结构（核心服务 / 服务区域 / 适合谁 / 教练理念），「成立时间」行非必要已移除，
    // 有机构时由 buildIntroInfoList 按 organization_basic 真实字段生成，缺省行退回 DEFAULT_INTRO_INFO_LIST 的默认（完整）值
    introInfoList: DEFAULT_INTRO_INFO_LIST,
    // 新增团队成员列表：一人一行一个块，默认/兜底 1 人；真实成员从 organization_member.admin_list+coach_list 依序向下追加
    teamMembers: DEFAULT_TEAM_MEMBER_LIST,
    // 团队成员折叠开关：true=只展示前 5 人，false=已展开全部
    teamShowAll: false,
    // 旧版 organization_show 数据保留：legacy 区块仍可能引用，先继续维护
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
          // 调整（2026-09-06）：手动补推 B 侧展示信息入口（原「同步展示信息」卡片）已移到
          // organization_show 上方的「家长端展示预览」语义提示条内，不再占用入口卡片位；
          // 背景：A→B 同步只绑在创建二维码 / 保存资料 / 新教练加入三个事件上，老机构或推送
          // 失败时家长端会缺数据，提示条内按钮给管理层一个幂等补推入口（点击即全量覆盖推送）。
          // SYNC_ORG_SHOW 动作分发与 onSyncOrgShowTap 调用逻辑保持不变。
          DEFAULT_ENTRY_SECOND_ACTION,
          // 新增（2026-09-21）：团队管理入口 —— 待确认的教练加入申请在这里同意 / 拒绝。
          // 排在「教练加入团队」之后，不占用第 2 张固定卡的位置（第 2 张卡仍是教练加入团队）
          { ...DEFAULT_ENTRY_ADMIN_MANAGE_ACTION }
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

    // 新增（2026-09-06 诊断日志）：定位「organization_show 不拉取用户填写数据」——
    // 先打印身份里的 orgId 与环境信息，区分「身份没带上 orgId」和「DB 查询失败 / 空结果」两类根因
    console.log('[organization][INFO] refreshCurrentOrganizationCard.start', {
      orgId: orgId ? orgId.slice(0, 28) : '<empty>',
      memberRole,
      dataPrefix: app.globalData.dataPrefix || '<default>',
      env: app.globalData.env || '<empty>'
    })

    if (!orgId) {
      // 新增（2026-09-06 诊断日志）：走到这里说明业务身份里没有机构 ID，展示区只能回退默认值
      console.warn('[organization][WARN] refreshCurrentOrganizationCard.no_orgid', {
        hasIdentityFn: typeof (app && app.getBusinessIdentity) === 'function',
        identityKeys: currentIdentity ? Object.keys(currentIdentity) : [],
        profileKeys: Object.keys(organizationProfile || {})
      })
      this.setData({
        submitResultCard: pendingResultCard || null,
        brandSwiperList: DEFAULT_BRAND_SWIPER_LIST,
        coachTeamList: DEFAULT_COACH_TEAM_LIST,
        // 新增（2026-09-21）：没有归属团队时不存在待确认申请，徽标清零
        pendingApplyCount: 0,
        // 新增长图设计字段：无机构时统一使用默认值（设计稿「星耀体育训练中心」）
        brandHeaderImage: DEFAULT_BRAND_HEADER_IMAGE,
        brandHeroSlides: DEFAULT_BRAND_HERO_SLIDES,
        brandHeroCurrent: 0,
        organizationProfile: DEFAULT_ORGANIZATION_PROFILE,
        introInfoList: DEFAULT_INTRO_INFO_LIST,
        teamMembers: DEFAULT_TEAM_MEMBER_LIST
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
      // 新增（2026-09-06 诊断日志）：查询命中数 —— 命中 0 条时重点排查集合权限
      //（「仅创建者可读写」权限下，云函数创建的文档没有 _openid，客户端直查会返回空集）
      console.log('[organization][INFO] refreshCurrentOrganizationCard.query_done', {
        hitCount: Array.isArray(res.data) ? res.data.length : 0,
        collectionName: organizationCollectionName
      })
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

      // 新增（2026-09-21）：管理层才统计待确认申请数量（执行教练不参与审批，不需要计数）
      const pendingApplyCount = isAdminRole ? this.countPendingApply(organizationDoc) : 0

      this.setData({
        // 新增机构门面动态拉取：机构存在时，品牌轮播和教练团队都按当前机构已填写资料生成
        brandSwiperList: this.buildBrandSwiperList(organizationBasic),
        coachTeamList: this.buildCoachTeamList(organizationDoc),
        // 长图设计：把接口数据灌进 organizationProfile / introInfoList / teamMembers / brandHeaderImage
        brandHeaderImage: this.buildBrandHeaderImage(organizationBasic),
        brandHeroSlides: this.buildBrandHeroSlides(organizationBasic),
        brandHeroCurrent: 0,
        organizationProfile: this.buildOrganizationShowProfile(organizationBasic, organizationProfile, defaultCard),
        introInfoList: this.buildIntroInfoList(organizationBasic),
        teamMembers: this.buildShowTeamMembers(organizationDoc),
        // 新增（2026-09-21）：待确认申请数量（管理层），同步刷新「团队管理」入口卡徽标
        pendingApplyCount,
        entryActionList: this.buildEntryActionListWithBadge(pendingApplyCount),
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
    }).catch((err) => {
      // 调整（2026-09-06 诊断日志）：原来 catch 静默吞掉异常，查询失败时控制台无任何线索；
      // 这里补打真实错误信息（权限不足 / env 不匹配等都会走到这里），行为仍是回退默认值不变
      console.error('[organization][ERROR] refreshCurrentOrganizationCard.query_fail', {
        message: err && (err.message || err.errMsg) ? (err.message || err.errMsg) : String(err),
        collectionName: `${app.globalData.dataPrefix || 'NDLdev_'}organization`
      })
      this.setData({
        submitResultCard: pendingResultCard || null,
        brandSwiperList: DEFAULT_BRAND_SWIPER_LIST,
        coachTeamList: DEFAULT_COACH_TEAM_LIST,
        // 新增（2026-09-21）：查询失败时待确认数量清零，避免展示上一次的旧徽标
        pendingApplyCount: 0,
        // 长图设计接口异常时也退回默认值，避免展示断裂
        brandHeaderImage: DEFAULT_BRAND_HEADER_IMAGE,
        brandHeroSlides: DEFAULT_BRAND_HERO_SLIDES,
        brandHeroCurrent: 0,
        organizationProfile: DEFAULT_ORGANIZATION_PROFILE,
        introInfoList: DEFAULT_INTRO_INFO_LIST,
        teamMembers: DEFAULT_TEAM_MEMBER_LIST
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

  // 长图设计·组织名 + 副标题：已创建机构时使用真实机构名，未上传 slogan 时退到默认副标题
  buildOrganizationShowProfile(organizationBasic = {}, identityProfile = {}, defaultCard = {}) {
    const realOrgName = String(
      organizationBasic.organization_name
      || identityProfile.orgName
      || defaultCard.organizationName
      || DEFAULT_ORGANIZATION_PROFILE.organizationName
    ).trim() || DEFAULT_ORGANIZATION_PROFILE.organizationName

    const slogan = String(
      organizationBasic.slogan
      || identityProfile.slogan
      || DEFAULT_ORGANIZATION_PROFILE.slogan
    ).trim() || DEFAULT_ORGANIZATION_PROFILE.slogan

    return {
      organizationName: realOrgName,
      slogan
    }
  },

  // 长图设计·Hero 顶图：优先读 organization_basic.brand_header_image；为空时回退到 brand_swiper_images 第一张；都没有则空串让 wxml 显示占位
  buildBrandHeaderImage(organizationBasic = {}) {
    const explicitHeader = String(organizationBasic.brand_header_image || '').trim()
    if (explicitHeader) {
      return explicitHeader
    }
    const swiperImages = Array.isArray(organizationBasic.brand_swiper_images)
      ? organizationBasic.brand_swiper_images.filter(item => String(item || '').trim())
      : []
    if (swiperImages.length) {
      return String(swiperImages[0] || '').trim()
    }
    return DEFAULT_BRAND_HEADER_IMAGE
  },

  // 新增 Hero 轮播图数据：头图 + brand_swiper_images 去重合并；一张都没有时只留 1 屏占位
  buildBrandHeroSlides(organizationBasic = {}) {
    const headerImage = String(organizationBasic.brand_header_image || '').trim()
    const swiperImages = Array.isArray(organizationBasic.brand_swiper_images)
      ? organizationBasic.brand_swiper_images
        .map(item => String(item || '').trim())
        .filter(item => !!item)
      : []

    const mergedImageList = []
    if (headerImage) {
      mergedImageList.push(headerImage)
    }
    swiperImages.forEach((imageUrl) => {
      if (mergedImageList.indexOf(imageUrl) === -1) {
        mergedImageList.push(imageUrl)
      }
    })

    if (!mergedImageList.length) {
      return DEFAULT_BRAND_HERO_SLIDES.map(item => ({ ...item }))
    }

    return mergedImageList.map(imageUrl => ({ imageUrl }))
  },

  // 补充（2026-09-05）：机构简介 4 行字段（核心服务 / 服务区域 / 适合谁 / 教练理念）—— 依次读 organization_basic 里区块二新收集的真实字段，
  // 没有真实值（老机构还没重新保存过）时退回 DEFAULT_INTRO_INFO_LIST 的默认（完整）值
  buildIntroInfoList(organizationBasic = {}) {
    const entries = [
      { label: '核心服务：', value: organizationBasic.core_services },
      { label: '服务区域：', value: organizationBasic.service_area },
      { label: '适合谁：', value: organizationBasic.target_audience },
      { label: '教练理念：', value: organizationBasic.coaching_philosophy }
    ]
    return entries.map((entry, index) => {
      const fallback = DEFAULT_INTRO_INFO_LIST[index] || entry
      const normalizedValue = String(entry.value || '').trim() || fallback.value
      return {
        label: entry.label || fallback.label,
        value: normalizedValue
      }
    })
  },

  // 团队成员列表（一人一行）：真实成员（admin_list + coach_list）按加入顺序向下追加、不再截断/补足；
  // 空团队时退回 DEFAULT_TEAM_MEMBER_LIST 默认（1 名示例成员）值；超过 5 人由展示层折叠，「展开全部」可看全部
  // 调整（2026-09-06）：真实成员没存头像（老数据）时兜底为官方默认男头像，展示层不再出现红底首字
  buildShowTeamMembers(organizationDoc = {}) {
    const organizationMember = organizationDoc.organization_member || {}
    const adminList = Array.isArray(organizationMember.admin_list) ? organizationMember.admin_list : []
    const coachList = Array.isArray(organizationMember.coach_list) ? organizationMember.coach_list : []

    const realMembers = adminList.concat(coachList).map((member) => {
      const nickname = String(member.nickname || '').trim() || '团队成员'
      const memberRole = String(member.member_role || '').trim()
      const rawAvatarUrl = String(member.avatar_url || member.avatarUrl || '').trim()
      return {
        avatar: nickname.slice(0, 1) || '员',
        avatarUrl: rawAvatarUrl || DEFAULT_COACH_AVATAR.男,
        name: nickname,
        role: memberRole === 'admin' ? '团队管理层' : '团队执行教练'
      }
    })

    if (!realMembers.length) {
      return DEFAULT_TEAM_MEMBER_LIST.map((item) => ({ ...item }))
    }
    return realMembers
  },

  // 新增（2026-09-21）：统计机构待确认的加入申请数量（organization_member.pending_list 里 status=pending 的条数）
  countPendingApply(organizationDoc = {}) {
    const organizationMember = (organizationDoc && organizationDoc.organization_member) || {}
    const pendingList = Array.isArray(organizationMember.pending_list) ? organizationMember.pending_list : []
    return pendingList.filter(
      (item) => String((item && item.status) || '').trim() === JOIN_APPLY_STATUS_PENDING
    ).length
  },

  // 新增（2026-09-21）：把待确认数量写进「团队管理」入口卡的 badge，其余卡片原样保留
  buildEntryActionListWithBadge(pendingApplyCount = 0) {
    const count = Number(pendingApplyCount) || 0
    return (this.data.entryActionList || []).map((item) => (
      item.action === 'GO_ORG_ADMIN'
        ? { ...item, badge: count > 0 ? `${count} 条待确认` : '' }
        : item
    ))
  },

  // 团队成员「展开全部 / 收起」切换：成员超过 5 人时折叠只展示前 5 人，点入口看剩余成员
  onToggleTeamMembers() {
    this.setData({
      teamShowAll: !this.data.teamShowAll
    })
  },

  // 新增 Hero 轮播切换：记录当前页下标，驱动自定义指示器高亮
  onBrandHeroChange(e) {
    const current = Number(((e || {}).detail || {}).current)
    this.setData({
      brandHeroCurrent: isNaN(current) ? 0 : current
    })
  },

  // 长图设计·Hero 图片加载失败兜底：只清空失败那一屏的 src，让 wxml 单独显示海军蓝占位区
  onBrandHeroImageError(e) {
    const index = Number((((e || {}).currentTarget || {}).dataset || {}).index)
    const brandHeroSlides = this.data.brandHeroSlides || []
    if (isNaN(index) || !brandHeroSlides[index]) {
      return
    }

    const nextSlides = brandHeroSlides.map((slide, slideIndex) => (
      slideIndex === index ? { ...slide, imageUrl: '' } : slide
    ))
    this.setData({
      brandHeroSlides: nextSlides,
      brandHeaderImage: index === 0 ? '' : this.data.brandHeaderImage
    })
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

    // 新增（2026-09-21）：团队管理 —— 查看成员、处理教练加入申请（同意 / 拒绝）
    if (action === 'GO_ORG_ADMIN') {
      wx.navigateTo({
        url: '/pages/organization/organization_admin/organization_admin'
      })
      return
    }

    // 新增（2026-09-06）：手动补推机构展示信息到 B 侧 dev_forPshowC
    // 调整（2026-09-06）：触发按钮已从入口卡片移到 organization_show 上方预览提示条，动作名保持不变
    if (action === 'SYNC_ORG_SHOW') {
      this.onSyncOrgShowTap()
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

  // 新增（2026-09-06）：手动补推机构展示信息（A→B dev_forPshowC）。
  // 链路：A 侧 NEWDL_ResponseQRCode syncOrganizationShow → B 侧 DLforP_entry_qrcode sync_org_show，
  // 按 organizationId 幂等覆盖推送，与 organization_create 的 callResponseQrcodeCloud 同一调用模式。
  // 2026-10-10 调整：该函数已降级为普通云函数，调用方式从 wx.cloud.callHTTPFunction 改回 wx.cloud.callFunction
  //（HTTP 通道会直接得到 cloud.callHttpFunction:fail … code: 400 / INVALID_PATH，且云函数不会被调用、日志为空）。
  onSyncOrgShowTap() {
    const app = getApp()
    const identityProfile = (app.getBusinessIdentity ? app.getBusinessIdentity() : {}).organizationProfile || {}
    const organizationId = String(identityProfile.orgId || '').trim()
    if (!organizationId) {
      wx.showToast({
        title: '未检测到机构 ID，请先创建或加入团队',
        icon: 'none'
      })
      return
    }
    wx.showLoading({
      title: '同步中…',
      mask: true
    })
    // envVersion 继续显式透传：云函数用它决定集合前缀（NDLdev_/NDLreal_），并随快照透传给 B 侧。
    // 取值对齐全仓约定：getApp().globalData.miniEnvVersion || 'develop'（app 已在函数顶部声明）。
    const envVersion = (app && app.globalData && app.globalData.miniEnvVersion) || 'develop'
    wx.cloud.callFunction({
      name: getApp().getFnName('NEWDL_ResponseQRCode'),
      // callFunction 语义：data 整体作为 event 传给 exports.main（无 HTTP 网关，无需 path/method）
      data: {
        action: 'syncOrganizationShow',
        organizationId,
        envVersion
      },
      success: (res) => {
        const payload = (res && res.result) || {}
        if (payload.status === 'success') {
          // failedImageCount：图片转存失败数量（文字信息已落库，失败图片等下次推送自愈重试）
          const failedImageCount = Number(payload.failedImageCount || 0)
          wx.showToast({
            title: failedImageCount > 0 ? '文字已同步，部分图片待重试' : '展示信息已同步',
            icon: failedImageCount > 0 ? 'none' : 'success'
          })
        } else {
          wx.showToast({
            title: String(payload.message || '同步失败，请稍后重试').slice(0, 30),
            icon: 'none'
          })
        }
      },
      fail: (err) => {
        console.error('[organization][ERROR] onSyncOrgShowTap.fail', {
          organizationId,
          message: err && (err.message || err.errMsg) ? (err.message || err.errMsg) : String(err)
        })
        wx.showToast({
          title: '同步失败，请稍后重试',
          icon: 'none'
        })
      },
      complete: () => {
        wx.hideLoading()
      }
    })
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
