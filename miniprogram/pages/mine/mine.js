// pages/mine/mine.js
Page({
  data: {
    user: {},
    stats: {
      posts: 0,
      parttime: 0,
      followers: 0
    },
    roleMap: {
      'C': '体育从业者',
      'P': '需求方',
      'V': '访客'
    },
    activeTab: 0
  },

  onLoad() {
    this.loadUserInfo()
    this.loadUserStats()
  },

  onShow() {
    this.loadUserInfo()
    this.loadUserStats()
  },

  /* ========= 用户信息 ========= */
  loadUserInfo() {
    const app = getApp()
    
    // 强制从全局数据刷新
    const user = {
      nickname: app.globalData.nickname || '未设置',
      id: app.globalData.token || '---',
      role: app.globalData.userRole || '',
      avatar: app.globalData.avatarUrl || ''
    }

    // 只有当数据变化时才 setData，避免无意义渲染，但这里为了确保刷新，直接设置
    this.setData({ user })
    
    // 如果没有昵称，尝试从缓存读取
    if (!app.globalData.nickname) {
       const cacheNick = wx.getStorageSync('nickname')
       const cacheRole = wx.getStorageSync('userRole')
       const cacheToken = wx.getStorageSync('token')
       const cacheAvatar = wx.getStorageSync('avatarUrl')

       if (cacheNick) {
          app.globalData.nickname = cacheNick
          app.globalData.userRole = cacheRole
          app.globalData.token = cacheToken
          app.globalData.avatarUrl = cacheAvatar
          
          this.setData({
            user: {
              nickname: cacheNick,
              id: cacheToken || '---',
              role: cacheRole || '',
              avatar: cacheAvatar || ''
            }
          })
       }
    }
  },

  /* ========= 用户统计（云函数） ========= */
  loadUserStats() {
    wx.cloud.callFunction({
      name: 'NEWDL_mine_user',
      data: {
        envVersion: getApp().globalData.miniEnvVersion || 'develop'
      }
    }).then(res => {
      if (res.result?.stats) {
        this.setData({
          stats: res.result.stats
        })
      }
    }).catch(() => {
      // 兜底
      this.setData({
        stats: {
          posts: 0,
          parttime: 0,
          followers: 0
        }
      })
    })
  },

  /* ========= tab ========= */
  switchTab(e) {
    this.setData({
      activeTab: Number(e.currentTarget.dataset.tab)
    })
  },

  /* ========= 编辑资料 ========= */
  onEditProfile() {
    wx.navigateTo({
      // 新增我的页资料入口修正：直接跳转到 pages/profile/edit/edit
      url: '/pages/profile/edit/edit'
    })
  },

  /* ========= 更换头像（云存储） ========= */
  changeAvatar() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      success: async (res) => {
        const filePath = res.tempFilePaths[0]

        wx.showLoading({ title: '上传中' })

        try {
          // 1️⃣ 上传到云存储
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath: `avatar/${Date.now()}.jpg`,
            filePath
          })

          // 2️⃣ 更新数据库（云函数）
          await wx.cloud.callFunction({
            name: 'updateAvatar',
            data: {
              avatar: uploadRes.fileID
            }
          })

          // 3️⃣ 本地更新
          this.setData({
            'user.avatar': uploadRes.fileID
          })

          // 同步更新全局数据和缓存
          const app = getApp()
          app.globalData.avatarUrl = uploadRes.fileID
          wx.setStorageSync('avatarUrl', uploadRes.fileID)

          wx.showToast({ title: '头像更新成功' })

        } catch (e) {
          wx.showToast({
            title: '上传失败',
            icon: 'none'
          })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  /* ========= 页面跳转 ========= */
  openWallet() {
    wx.showToast({ title: '钱包功能开发中', icon: 'none' })
  },

  openOrders() {
    wx.navigateTo({ url: '/pages/mine/orders/orders' })
  },

  openFavorites() {
    wx.navigateTo({ url: '/pages/mine/favorites/favorites' })
  },

  openHistory() {
    wx.navigateTo({ url: '/pages/mine/history/history' })
  },

  openCertificate() {
    wx.navigateTo({ url: '/pages/mine/certificate/certificate' })
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/mine/settings/settings' })
  },

  openHelp() {
    wx.navigateTo({ url: '/pages/mine/help/help' })
  },

  openAbout() {
    wx.navigateTo({ url: '/pages/index/about/about' })
  },

  /* ========= 退出登录 ========= */
  logout() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          const app = getApp()

          app.globalData.token = null
          app.globalData.user = null
          app.globalData.userRole = null
          app.globalData.nickname = null
          app.globalData.avatarUrl = null
          app.globalData.needChooseRole = true

          wx.clearStorageSync()

          this.setData({
            user: {},
            stats: { posts: 0, parttime: 0, followers: 0 }
          })

          wx.showToast({ title: '已退出登录' })

          setTimeout(() => {
            wx.switchTab({
              url: '/pages/index/index'
            })
          }, 1200)
        }
      }
    })
  }
})
