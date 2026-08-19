// pages/profile/edit/edit.js
Page({
  previewDraft: null,

  data: {
    isLoading: false,
    isShareView: false,
    profile: {
      avatarUrl: '',
      nickname: '',
      phone: '',
      experienceLevel: '',
      studentCountLevel: '',
      city: '',
      address: '',
      aboutMe: '',
      workExperience: '',
      education: '',
      skills: '',
      languages: '',
      honors: '',
      relatedCertificates: '',
      honorShowcase: ''
    },
    profileRows: [],
    headerName: '默认教练',
    headerStats: {
      experienceLevel: '待完善',
      education: '待完善',
      studentCountLevel: '待完善'
    },
    introText: '',
    coachId: '',
    profileTagline: ''
  },

  onLoad(options) {
    // 新增分享来源识别：从分享卡片进入的查看者不显示底部操作区
    const isShareView = !!(options && options.fromShare === '1')
    this.setData({
      isShareView
    })
    // 新增分享访问记录：从分享入口进入时，立即把 APPID 和访问时间写入数据库
    if (isShareView) {
      this.logShareView()
    }
    // 新增预览草稿读取：进入预览页时先接收资料编辑页传来的未保存内容
    this.previewDraft = this.consumePreviewDraft()
    this.loadProfile()
  },

  onShow() {
    // 新增预览草稿刷新：页面再次展示时继续接收最新草稿，避免二次进入时漏掉新昵称
    this.previewDraft = this.consumePreviewDraft() || this.previewDraft
    this.loadProfile()
  },

  // 新增已填写判断：展示页只保留真正填写过的项目，空内容不再占位显示
  hasFilledValue(value) {
    return !!String(value || '').trim()
  },

  // 新增单行内容整理：统一把列表里的内容压成单行文案，避免每个字段单独撑成卡片
  formatSingleLineValue(value, fallback = '待完善') {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    return text || fallback
  },

  // 新增多块摘要整理：相关证书和荣誉展示在预览页合并成单行摘要展示
  formatMultiBlockSummary(value, fallback = '待完善') {
    const text = String(value || '').trim()
    if (!text) {
      return fallback
    }

    try {
      const parsedValue = JSON.parse(text)
      if (Array.isArray(parsedValue) && parsedValue.length) {
        const summaryText = parsedValue
          .map((item) => String((item && item.content) || '').trim())
          .filter(Boolean)
          // 新增逐条换行：表单页有几块，预览页就按几行对应展示
          .join('\n')
        return this.formatSingleLineValue(summaryText, fallback)
      }
    } catch (error) {
      // 保留兼容：历史旧值继续按普通文本展示
    }

    return this.formatSingleLineValue(text, fallback)
  },

  // 新增多块逐行整理：表单页有几条块，预览页就渲染成几行，而不是依赖 \n 换行
  formatMultiBlockLines(value, fallback = '待完善') {
    const text = String(value || '').trim()
    if (!text) {
      return [fallback]
    }

    try {
      const parsedValue = JSON.parse(text)
      if (Array.isArray(parsedValue) && parsedValue.length) {
        const lineList = parsedValue
          .map((item) => this.formatSingleLineValue((item && item.content) || '', ''))
          .filter(Boolean)
        return lineList.length ? lineList : [fallback]
      }
    } catch (error) {
      // 保留兼容：历史旧值继续按普通文本展示
    }

    return [this.formatSingleLineValue(text, fallback)]
  },

  // 新增条件多行配置：默认保持单行高度，只有多条内容时才切到多行撑开
  buildConditionalMultilineValue(value, fallback = '待完善') {
    const lineList = this.formatMultiBlockLines(value, fallback)
    return {
      value: lineList[0] || fallback,
      lineList,
      multiline: lineList.length > 1
    }
  },

  // 新增地区文案组装：优先展示城市，没有城市时再用详细地址
  buildAreaText(profile = {}) {
    const city = String(profile.city || '').trim()
    const address = String(profile.address || '').trim()
    return city || address || ''
  },

  // 新增擅长领域整理：兼容历史手输文本和当前多选结果，预览页按多项内容稳妥展示
  buildSkillSelectionConfig(value, fallback = '待完善') {
    const lineList = [...new Set(
      String(value || '')
        .split(/[\n,，、/]+/)
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )]

    if (!lineList.length) {
      return {
        value: fallback,
        lineList: [fallback],
        multiline: false
      }
    }

    return {
      value: lineList.join('、'),
      lineList,
      multiline: lineList.length > 1
    }
  },

  // 新增概览值整理：头部概览项统一截短，避免撑坏一行三列布局
  formatOverviewValue(value, fallback = '待完善', maxLength = 8) {
    const text = String(value || '').replace(/\s+/g, ' ').trim()
    if (!text) {
      return fallback
    }
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
  },

  // 新增头部姓名拉取：header-name 固定对应昵称字段
  buildHeaderName(profile = {}) {
    return String(profile.nickname || '').trim() || '默认教练'
  },

  // 新增ID直显：用户要求 header-id 直接展示完整 openid，方便页面里一眼核对身份
  buildCoachId() {
    const app = getApp()
    const openid = app.globalData.openid || wx.getStorageSync('openid') || ''
    return openid || '未设置'
  },

  // 新增资料大卡片行数据：统一固定成横向信息行
  buildProfileRows(profile = {}) {
    const educationText = this.formatSingleLineValue(profile.education)
    const relatedCertificatesConfig = this.buildConditionalMultilineValue(profile.relatedCertificates)
    const honorShowcaseConfig = this.buildConditionalMultilineValue(profile.honorShowcase)
    const skillSelectionConfig = this.buildSkillSelectionConfig(profile.skills)

    return [
      // 新增排序调整：按"教育背景/相关证书/荣誉展示/擅长领域/联系方式"顺序展示
      { icon: '🎓', label: '教育背景', value: educationText },
      { icon: '📜', label: '相关证书', value: relatedCertificatesConfig.value, multiline: relatedCertificatesConfig.multiline, lineList: relatedCertificatesConfig.lineList },
      { icon: '🏆', label: '荣誉展示', value: honorShowcaseConfig.value, multiline: honorShowcaseConfig.multiline, lineList: honorShowcaseConfig.lineList },
      { icon: '⭐', label: '擅长领域', value: skillSelectionConfig.value, multiline: skillSelectionConfig.multiline, lineList: skillSelectionConfig.lineList },
      // 保留说明：用户已明确要求“所在地区不要”，展示页同步移除该行
      { icon: '📞', label: '联系方式', value: this.formatSingleLineValue(profile.phone) }
    ]
  },

  // 新增头部概览拉取：第1项固定对应工作经验，第3项固定对应带过学员
  buildHeaderStats(profile = {}) {
    return {
      experienceLevel: this.formatOverviewValue(profile.experienceLevel, '待完善', 6),
      education: this.formatOverviewValue(profile.education, '待完善', 6),
      studentCountLevel: this.formatOverviewValue(profile.studentCountLevel, '待完善', 6)
    }
  },

  // 新增预览草稿缓存键：与资料编辑页共用同一个临时存储
  getPreviewDraftStorageKey() {
    return 'NEWDL_profile_preview_draft'
  },

  // 新增预览草稿消费：只取一次未保存内容，避免旧草稿长期污染展示页
  consumePreviewDraft() {
    try {
      const draftProfile = wx.getStorageSync(this.getPreviewDraftStorageKey())
      wx.removeStorageSync(this.getPreviewDraftStorageKey())
      return draftProfile && typeof draftProfile === 'object' ? draftProfile : null
    } catch (error) {
      console.warn('读取资料预览草稿失败', error)
      return null
    }
  },

  // 新增资料合并：预览页优先展示刚填写的草稿，没有草稿时再回退到云端资料
  mergeProfileWithDraft(profile = {}) {
    return Object.assign({}, profile || {}, this.previewDraft || {})
  },

  // 新增教练介绍文案：优先展示关于我，没有时给一个温和占位
  buildIntroText(profile = {}) {
    const aboutMe = String(profile.aboutMe || '').trim()
    if (aboutMe) {
      return aboutMe
    }
    return '这位教练还没有填写教练介绍，先去完善资料吧。'
  },

  // 新增资料展示加载：直接读取当前微信用户自己的云端资料
  loadProfile() {
    if (this.data.isLoading) {
      return
    }

    this.setData({
      isLoading: true
    })

    wx.cloud.callFunction({
      name: 'NEWDL_mine_user',
      data: {
        action: 'getProfile',
        envVersion: getApp().globalData.miniEnvVersion || 'develop'
      },
      success: (res) => {
        const result = res && res.result
        const profile = result && result.status === 'success' ? (result.profile || {}) : {}
        const nextProfile = Object.assign({}, this.data.profile, this.mergeProfileWithDraft(profile))
        const app = getApp()

        if (nextProfile.nickname) {
          app.globalData.nickname = nextProfile.nickname
          wx.setStorageSync('nickname', nextProfile.nickname)
        }

        this.setData({
          profile: nextProfile,
          headerName: this.buildHeaderName(nextProfile),
          profileRows: this.buildProfileRows(nextProfile),
          headerStats: this.buildHeaderStats(nextProfile),
          introText: this.buildIntroText(nextProfile),
          coachId: this.buildCoachId(),
          profileTagline: this.formatSingleLineValue(nextProfile.skills, '专注青少年体能训练')
        })
      },
      fail: () => {
        const nextProfile = Object.assign({}, this.data.profile, this.mergeProfileWithDraft({}))
        if (this.previewDraft) {
          this.setData({
            profile: nextProfile,
            headerName: this.buildHeaderName(nextProfile),
            profileRows: this.buildProfileRows(nextProfile),
            headerStats: this.buildHeaderStats(nextProfile),
            introText: this.buildIntroText(nextProfile),
            coachId: this.buildCoachId(),
            profileTagline: this.formatSingleLineValue(nextProfile.skills, '专注青少年体能训练')
          })
          return
        }
        wx.showToast({
          title: '资料加载失败',
          icon: 'none'
        })
      },
      complete: () => {
        this.setData({
          isLoading: false
        })
      }
    })
  },

  // 新增跳转编辑：展示页只负责查看，真正编辑统一走资料完善页
  goToProfileEditor() {
    wx.navigateTo({
      url: '/pages/index/profile/profile'
    })
  },

  // 新增小程序 APPID 提取：前端把当前小程序 appId 一并带给云端日志，便于后续核对
  getMiniProgramAppId() {
    try {
      const accountInfo = wx.getAccountInfoSync()
      return (accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.appId) || ''
    } catch (error) {
      return ''
    }
  },

  // 新增分享访问日志：从分享页进入时记录 APPID 和时间到数据库
  logShareView() {
    wx.cloud.callFunction({
      name: 'NEWDL_mine_user',
      data: {
        action: 'logSharedProfileView',
        envVersion: getApp().globalData.miniEnvVersion || 'develop',
        shareLog: {
          clientAppId: this.getMiniProgramAppId(),
          pagePath: '/pages/profile/edit/edit',
          enteredAt: new Date().toISOString()
        }
      },
      fail: (error) => {
        console.warn('记录分享访问日志失败', error)
      }
    })
  },

  // 新增分享卡片：支持把当前资料页分享给家长查看
  onShareAppMessage() {
    const nickname = this.data.profile.nickname || '默认教练'
    return {
      title: `${nickname}的教练资料`,
      // 新增分享查看参数：让分享进入的访问者隐藏底部操作区
      path: '/pages/profile/edit/edit?fromShare=1'
    }
  }
})
