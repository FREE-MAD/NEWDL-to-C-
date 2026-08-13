Page({
  data: {
    currentIndex: -1,   // 当前展开的卡片索引（默认全部收起）
    isSaving: false,
    profileForm: {
      nickname: '',
      phone: '',
      city: '',
      address: '',
      aboutMe: '',
      workExperience: '',
      education: '',
      skills: '',
      languages: '',
      honors: ''
    },

    cards: [
      { icon: "👤", title: "关于我", field: "aboutMe", placeholder: "介绍一下自己", value: '' },
      { icon: "💼", title: "工作经历", field: "workExperience", placeholder: "填写你的工作经历", value: '' },
      { icon: "🎓", title: "教育背景", field: "education", placeholder: "填写你的教育背景", value: '' },
      { icon: "🌐", title: "技能", field: "skills", placeholder: "填写你的技能特长", value: '' },
      { icon: "🈳", title: "语言", field: "languages", placeholder: "填写你掌握的语言", value: '' },
      { icon: "🏅", title: "荣誉", field: "honors", placeholder: "填写你的荣誉或证书", value: '' },
    ]
  },

  onLoad() {
    this.loadProfile()
  },

  // 点击展开 / 收起
  toggleCard(e) {
    const index = e.currentTarget.dataset.index;

    this.setData({
      currentIndex: this.data.currentIndex === index ? -1 : index
    });
  },

  // 新增通用输入：基础信息和资料详情统一走一个字段更新入口
  onFieldInput(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value || ''
    const nextProfileForm = Object.assign({}, this.data.profileForm, {
      [field]: value
    })
    this.setData({
      profileForm: nextProfileForm,
      cards: this.buildCardsWithValue(nextProfileForm)
    })
  },

  // 新增卡片值同步：把当前表单内容映射到展开卡片里，避免模板动态取值不稳定
  buildCardsWithValue(profileForm = {}) {
    return this.data.cards.map((item) => ({
      ...item,
      value: profileForm[item.field] || ''
    }))
  },

  // 新增资料加载：进入页面时读取当前用户自己的资料
  loadProfile() {
    wx.showLoading({
      title: '加载中...'
    })
    wx.cloud.callFunction({
      name: 'NEWDL_mine_user',
      data: {
        action: 'getProfile',
        envVersion: getApp().globalData.miniEnvVersion || 'develop'
      },
      success: (res) => {
        const result = res && res.result
        if (result && result.status === 'success' && result.profile) {
          const nextProfileForm = Object.assign({}, this.data.profileForm, result.profile)
          this.setData({
            profileForm: nextProfileForm,
            cards: this.buildCardsWithValue(nextProfileForm)
          })
        } else {
          wx.showToast({
            title: '资料加载失败',
            icon: 'none'
          })
        }
      },
      fail: () => {
        wx.showToast({
          title: '资料加载失败',
          icon: 'none'
        })
      },
      complete: () => {
        wx.hideLoading()
      }
    })
  },

  // 新增资料保存：提交当前页面编辑内容并入库到 users 集合
  saveProfile() {
    if (this.data.isSaving) {
      return
    }

    const profileForm = this.data.profileForm || {}
    if (!profileForm.nickname) {
      wx.showToast({
        title: '请填写昵称',
        icon: 'none'
      })
      return
    }

    this.setData({
      isSaving: true
    })

    wx.showLoading({
      title: '保存中...'
    })

    wx.cloud.callFunction({
      name: 'NEWDL_mine_user',
      data: {
        action: 'updateProfile',
        profile: profileForm,
        envVersion: getApp().globalData.miniEnvVersion || 'develop'
      },
      success: (res) => {
        const result = res && res.result
        if (result && result.status === 'success') {
          const app = getApp()
          const latestProfile = result.profile || profileForm
          app.globalData.nickname = latestProfile.nickname || app.globalData.nickname
          wx.setStorageSync('nickname', app.globalData.nickname || '')

          this.setData({
            profileForm: Object.assign({}, this.data.profileForm, latestProfile),
            cards: this.buildCardsWithValue(Object.assign({}, this.data.profileForm, latestProfile))
          })

          wx.showToast({
            title: '保存成功',
            icon: 'success'
          })
          return
        }

        wx.showToast({
          title: (result && result.message) || '保存失败',
          icon: 'none'
        })
      },
      fail: () => {
        wx.showToast({
          title: '保存失败',
          icon: 'none'
        })
      },
      complete: () => {
        this.setData({
          isSaving: false
        })
        wx.hideLoading()
      }
    })
  }
})
