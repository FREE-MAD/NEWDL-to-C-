// pages/profile/edit/edit.js
Page({
  previewDraft: null,

  data: {
    isLoading: false,
    isShareView: false,
    sharerOpenid: '',
    profileOwnerOpenid: '',
    sharePageMode: 'normal',
    securityReview: {
      status: '',
      reason: '',
      message: '',
      checkType: '',
      failedTextIndex: -1,
      failedImageIndex: -1
    },
    securityReviewText: '审核中',
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
    const sharerOpenid = String((options && options.sharerOpenid) || '').trim()
    this.setData({
      isShareView,
      sharerOpenid
    })
    this.syncSharePageMode()
    // 新增分享访问记录：从分享入口进入时，立即把 APPID 和访问时间写入数据库
    if (isShareView) {
      this.logShareView()
    }
    // 新增草稿使用边界：分享查看页只展示已保存资料，不再混入当前访客本地草稿
    this.previewDraft = this.shouldUsePreviewDraft() ? this.consumePreviewDraft() : null
    this.loadProfile()
  },

  onShow() {
    this.syncSharePageMode()
    this.applyShareViewLock()
    // 新增草稿刷新边界：普通预览页继续吃最新草稿，分享查看页始终只看云端已保存结果
    this.previewDraft = this.shouldUsePreviewDraft()
      ? (this.consumePreviewDraft() || this.previewDraft)
      : null
    this.loadProfile()
  },

  // 新增资料分享页模式同步：把分享者本人和普通查看者收口到同一份页面态数据里
  syncSharePageMode() {
    const sharePageMode = this.data.isShareView ? this.resolveSharePageMode() : 'normal'
    this.setData({ sharePageMode })
    return sharePageMode
  },

  // 新增资料分享锁页判断：除了分享者本人外，所有分享进入者都只允许停留在当前页查看
  isShareLockedViewer() {
    return this.data.isShareView && this.data.sharePageMode !== 'share_owner'
  },

  // 新增资料分享锁页应用：分享查看者进入当前页后隐藏首页按钮，尽量只保留当前页查看能力
  applyShareViewLock() {
    if (!this.isShareLockedViewer()) {
      return
    }

    if (wx.hideHomeButton) {
      wx.hideHomeButton()
    }
  },

  // 新增旧分享页退出判断：只要本次唤起不是分享入口，就不再继续沿用缓存里的分享态
  shouldExitSharePreview() {
    if (!this.data.isShareView) {
      return false
    }

    const enterSource = getApp().globalData.enterSource || 'normal'
    return enterSource !== 'share'
  },

  // 新增资料分享页退出分流：分享者本人回资料编辑台，其他查看者回首页
  redirectAfterShareSessionExpired() {
    if (this.isShareLockedViewer()) {
      return
    }

    if (this.data.sharePageMode === 'share_owner') {
      this.goToMainPage()
      return
    }

    wx.switchTab({
      url: '/pages/index/index'
    })
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

  // 新增当前 openid 统一读取：资料本人态、分享本人态、分享访客态都走同一个入口判断
  getCurrentOpenid() {
    const app = getApp()
    return app.globalData.openid || wx.getStorageSync('openid') || ''
  },

  // 新增分享资料目标读取：分享查看优先读分享者资料，普通预览继续读当前用户自己的资料
  getRequestedProfileOpenid() {
    if (this.data.isShareView && this.data.sharerOpenid) {
      return this.data.sharerOpenid
    }

    return this.getCurrentOpenid()
  },

  // 新增草稿可用判断：只有普通预览页允许吃本地临时草稿，分享查看页统一只看已保存内容
  shouldUsePreviewDraft() {
    return !this.data.isShareView
  },

  // 新增ID直显：分享查看时展示被分享教练自己的 openid，普通预览页继续展示当前用户 openid
  buildCoachId(profileOwnerOpenid = '') {
    const openid = String(profileOwnerOpenid || this.data.profileOwnerOpenid || this.getCurrentOpenid() || '').trim()
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

  // 新增资料合并：普通预览页优先展示本地草稿，分享查看页只展示云端已保存资料
  mergeProfileWithDraft(profile = {}) {
    if (!this.shouldUsePreviewDraft()) {
      return Object.assign({}, profile || {})
    }

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

  // 新增审核状态文案：底部固定显示资料当前审核进度，审核完成后切成“审核通过”
  buildSecurityReviewText(review = {}) {
    const status = String((review && review.status) || '').trim()
    if (status === 'approved') {
      return '审核通过'
    }
    return '审核中'
  },

  // 新增资料展示加载：普通预览读自己资料，分享查看按 sharerOpenid 读取被分享教练资料
  loadProfile() {
    if (this.data.isLoading) {
      return
    }

    const requestedProfileOpenid = this.getRequestedProfileOpenid()

    this.setData({
      isLoading: true
    })

    wx.cloud.callFunction({
      name: 'NEWDL_mine_user',
      data: {
        action: 'getProfile',
        targetOpenid: requestedProfileOpenid,
        envVersion: getApp().globalData.miniEnvVersion || 'develop'
      },
      success: (res) => {
        const result = res && res.result
        if (!result || result.status !== 'success') {
          wx.showToast({
            title: (result && result.message) || '资料加载失败',
            icon: 'none'
          })
          return
        }

        const profile = result.profile || {}
        const securityReview = result.securityReview || {}
        const profileOwnerOpenid = String(result.profileOwnerOpenid || requestedProfileOpenid || '').trim()
        const nextProfile = Object.assign({}, this.data.profile, this.mergeProfileWithDraft(profile))
        const app = getApp()
        const shouldSyncLocalIdentity = !this.data.isShareView || this.data.sharePageMode === 'share_owner'

        if (shouldSyncLocalIdentity && nextProfile.nickname) {
          app.globalData.nickname = nextProfile.nickname
          wx.setStorageSync('nickname', nextProfile.nickname)
        }

        this.setData({
          profile: nextProfile,
          profileOwnerOpenid,
          headerName: this.buildHeaderName(nextProfile),
          profileRows: this.buildProfileRows(nextProfile),
          headerStats: this.buildHeaderStats(nextProfile),
          introText: this.buildIntroText(nextProfile),
          coachId: this.buildCoachId(profileOwnerOpenid),
          profileTagline: this.formatSingleLineValue(nextProfile.skills, '专注青少年体能训练'),
          securityReview,
          securityReviewText: this.buildSecurityReviewText(securityReview)
        })
      },
      fail: () => {
        const nextProfile = Object.assign({}, this.data.profile, this.mergeProfileWithDraft({}))
        if (this.previewDraft) {
          this.setData({
            profile: nextProfile,
            profileOwnerOpenid: requestedProfileOpenid,
            headerName: this.buildHeaderName(nextProfile),
            profileRows: this.buildProfileRows(nextProfile),
            headerStats: this.buildHeaderStats(nextProfile),
            introText: this.buildIntroText(nextProfile),
            coachId: this.buildCoachId(requestedProfileOpenid),
            profileTagline: this.formatSingleLineValue(nextProfile.skills, '专注青少年体能训练'),
            securityReviewText: this.buildSecurityReviewText(this.data.securityReview || {})
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
    // 新增分享查看锁页兜底：即便按钮异常露出，非分享者本人也不允许离开当前分享页
    if (this.isShareLockedViewer()) {
      wx.showToast({
        title: '该分享页已锁定，只支持当前页查看',
        icon: 'none'
      })
      return
    }

    // 新增资料分享页返回分流：分享者本人从自己的分享页返回时替换当前页，避免继续停留在分享态页面栈里
    this.openProfileEditor(!!this.data.isShareView)
  },

  // 新增资料操作台统一跳转：普通预览页保留原跳转，分享本人回编辑台时直接替换当前页
  openProfileEditor(replaceCurrentPage = false) {
    if (this.isShareLockedViewer()) {
      wx.showToast({
        title: '该分享页已锁定，只支持当前页查看',
        icon: 'none'
      })
      return
    }

    const navigateMethod = replaceCurrentPage ? 'redirectTo' : 'navigateTo'
    wx[navigateMethod]({
      url: '/pages/index/profile/profile'
    })
  },

  // 新增主页面返回：分享者本人在自己的分享页里点击底部按钮时，直接回主页
  goToMainPage() {
    wx.switchTab({
      url: '/pages/index/index'
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

  // 新增资料分享页模式判断：保留和课程分享日志一致的 pageMode 字段，便于后续按本人/他人进入拆分统计
  resolveSharePageMode() {
    const currentOpenid = getApp().globalData.openid || wx.getStorageSync('openid') || ''
    if (this.data.sharerOpenid && currentOpenid && this.data.sharerOpenid === currentOpenid) {
      return 'share_owner'
    }

    return 'share_viewer'
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
          enteredAt: new Date().toISOString(),
          from: 'share',
          page: 'profile_edit',
          pageMode: this.data.sharePageMode || this.resolveSharePageMode(),
          sharerOpenid: this.data.sharerOpenid || '',
          sourcePage: 'share'
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
    const sharerOpenid = getApp().globalData.openid || wx.getStorageSync('openid') || ''
    return {
      title: `${nickname}的教练资料`,
      // 新增分享查看参数：让分享进入的访问者隐藏底部操作区
      path: `/pages/profile/edit/edit?fromShare=1&sharerOpenid=${sharerOpenid}`
    }
  },

  // 新增系统返回拦截：分享查看者触发物理返回或手势返回时，继续留在当前资料分享页
  onBackPress() {
    if (!this.isShareLockedViewer()) {
      return false
    }

    wx.showToast({
      title: '该分享页已锁定，只支持当前页查看',
      icon: 'none'
    })
    return true
  }
})
