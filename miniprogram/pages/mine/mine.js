// pages/mine/mine.js
const { prepareImageForUpload } = require('../../utils/imageUpload')

Page({
  data: {
    user: {},
    securityReview: {
      status: '',
      reason: '',
      message: '',
      checkType: '',
      failedTextIndex: -1,
      failedImageIndex: -1
    },
    stats: {
      posts: 0,
      parttime: 0,
      followers: 0
    },
    roleMap: {
      'C': '教练',
      'P': '旧需求方',
      'V': '预览方'
    },
    editButtonText: '先填写教练资料',
    activeTab: 0
  },

  onLoad() {
    this.loadUserInfo()
    this.loadUserStats()
  },

  onShow() {
    this.loadUserInfo()
    this.loadUserStats()
    this.refreshUserRoleState()
  },

  // 新增角色重算同步：我的页展示“教练 / 预览方”时，优先按最新业务痕迹刷新
  refreshUserRoleState() {
    const app = getApp()
    if (!app.resolveUserRoleByBusiness) {
      return
    }

    app.resolveUserRoleByBusiness().then(() => {
      this.loadUserInfo()
    }).catch(() => {})
  },

  // 新增身份标签：当前项目统一按 C / V 两种口径给用户展示
  getRoleLabel(role = '') {
    return this.data.roleMap[role] || '预览方'
  },

  // 新增资料按钮文案：预览方优先看到“先填写”，教练看到“继续编辑”
  getEditButtonText(role = '') {
    return role === 'C' ? '编辑资料' : '先填写教练资料'
  },

  /* ========= 用户信息 ========= */
  loadUserInfo() {
    const app = getApp()
    const safeRole = app.globalData.userRole || wx.getStorageSync('userRole') || 'V'
    
    // 强制从全局数据刷新
    const user = {
      nickname: app.globalData.nickname || '未设置',
      id: app.globalData.token || '---',
      role: safeRole,
      roleLabel: this.getRoleLabel(safeRole),
      avatar: app.globalData.avatarUrl || ''
    }

    // 只有当数据变化时才 setData，避免无意义渲染，但这里为了确保刷新，直接设置
    this.setData({
      user,
      editButtonText: this.getEditButtonText(safeRole)
    })
    
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
          const nextRole = cacheRole || 'V'
          
          this.setData({
            user: {
              nickname: cacheNick,
              id: cacheToken || '---',
              role: nextRole,
              roleLabel: this.getRoleLabel(nextRole),
              avatar: cacheAvatar || ''
            },
            editButtonText: this.getEditButtonText(nextRole)
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

  // 新增头像后台审核触发：头像写库后单独发起资料审核，不阻塞当前换头像操作
  triggerProfileSecurityReview() {
    wx.cloud.callFunction({
      name: 'NEWDL_mine_user',
      data: {
        action: 'submitProfileSecurityReview',
        envVersion: getApp().globalData.miniEnvVersion || 'develop'
      },
      success: (res) => {
        const result = res && res.result
        if (result && result.status === 'success' && result.review) {
          this.setData({
            securityReview: result.review
          })
        }
      },
      fail: (error) => {
        console.warn('头像后台审核触发失败', error)
      }
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
          // 新增头像上传前压缩：尽量先把头像压小，再上传到云存储，减少安全检测超限
          const preparedImage = await prepareImageForUpload(filePath, {
            maxBytes: 300 * 1024
          })
          // 1️⃣ 上传到云存储
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath: `avatar/${Date.now()}.jpg`,
            filePath: preparedImage.filePath || filePath
          })

          // 2️⃣ 更新数据库（云函数）
          const saveRes = await wx.cloud.callFunction({
            name: 'NEWDL_mine_user',
            data: {
              action: 'updateAvatar',
              profile: {
                avatarUrl: uploadRes.fileID
              },
              envVersion: getApp().globalData.miniEnvVersion || 'develop'
            }
          })

          const result = saveRes && saveRes.result
          if (!result || result.status !== 'success') {
            wx.showToast({
              title: (result && result.message) || '头像更新失败',
              icon: 'none'
            })
            return
          }

          // 3️⃣ 本地更新
          this.setData({
            'user.avatar': uploadRes.fileID
          })

          // 同步更新全局数据和缓存
          const app = getApp()
          if (app.saveUserIdentity) {
            app.saveUserIdentity({
              avatarUrl: uploadRes.fileID,
              userRole: 'C',
              needChooseRole: false
            })
          } else {
            app.globalData.avatarUrl = uploadRes.fileID
            app.globalData.userRole = 'C'
            wx.setStorageSync('avatarUrl', uploadRes.fileID)
            wx.setStorageSync('userRole', 'C')
          }
          this.loadUserInfo()
          this.setData({
            securityReview: result.securityReview || {
              status: 'pending',
              reason: '',
              message: '头像已保存，后台检测中',
              checkType: '',
              failedTextIndex: -1,
              failedImageIndex: -1
            }
          })
          // 新增先保存后审核：头像先更新成功，再异步发起检测，不阻塞用户继续操作
          this.triggerProfileSecurityReview()

          wx.showToast({ title: (result && result.message) || '头像已保存，后台检测中' })

        } catch (e) {
          const resultMessage = e && e.result && e.result.message
          wx.showToast({
            title: resultMessage === '您发布的内容含违规信息' ? '您发布的内容含违规信息' : '上传失败',
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
