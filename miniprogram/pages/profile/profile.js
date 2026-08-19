Page({
  data: {
    isLoading: false,
    profile: {
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
    sections: []
  },

  onLoad() {
    // 新增标准资料页入口：统一跳转到资料展示页，避免外部继续直接记 edit 路径
    // 当前已补齐本页逻辑，标准入口页现在直接承担资料展示功能
    this.loadProfile()
  },

  onShow() {
    this.loadProfile()
  },

  // 新增展示数据组装：把资料整理成可直接渲染的卡片结构
  buildSections(profile = {}) {
    return [
      {
        title: '基础信息',
        items: [
          { label: '昵称', value: profile.nickname || '未填写' },
          { label: '联系电话', value: profile.phone || '未填写' },
          { label: '当前城市', value: profile.city || '未填写' },
          { label: '详细地址', value: profile.address || '未填写' }
        ]
      },
      {
        title: '个人资料',
        items: [
          { label: '关于我', value: profile.aboutMe || '未填写' },
          { label: '工作经历', value: profile.workExperience || '未填写' },
          { label: '教育背景', value: profile.education || '未填写' },
          { label: '技能特长', value: profile.skills || '未填写' },
          { label: '掌握语言', value: profile.languages || '未填写' },
          { label: '荣誉证书', value: profile.honors || '未填写' }
        ]
      }
    ]
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
        const nextProfile = Object.assign({}, this.data.profile, profile)
        const app = getApp()

        if (nextProfile.nickname) {
          app.globalData.nickname = nextProfile.nickname
          wx.setStorageSync('nickname', nextProfile.nickname)
        }

        this.setData({
          profile: nextProfile,
          sections: this.buildSections(nextProfile)
        })
      },
      fail: () => {
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
  }
})
