Page({
  data: {
    // 采集页面
    autoSelected: false, // 自动采集
    agreeProtocol: false, // 协议必须选
    isSubmitting: false, // 防止重复提交
    nickname: '',
    avatarUrl: '',
    phone: '',
    address: '',
    role: null,
  },

  onLoad() {
    const app = getApp();
    // MVP: 登录页暂时停用，进入后直接走静默登录并回首页
    if (app.ensureSilentLogin) {
      app.ensureSilentLogin();
    }
    wx.switchTab({
      url: '/pages/index/index',
    });
  },

  // 选择身份
  chooseRole(e) {
    const selectedRole = e.currentTarget.dataset.role;
    console.log('用户选择的是', selectedRole);
    // MVP: P 侧身份入口已下线，旧页面事件触发时直接拦截
    if (selectedRole === 'P') {
      wx.showToast({
        title: 'P侧入口已下线',
        icon: 'none'
      });
      return;
    }
    this.setData({
      role: selectedRole,
    });
    wx.request({
      // rbac认证certification
      url: 'rbac_certification',
    });
  },

  // 自动采集勾选
  onAutoChange(e) {
    const selected = e.detail.value.length > 0;
    console.log(e.detail.value);
    
    this.setData({
      autoSelected: selected
    });
    // 如果选择自动采集 → 清空手动输入
    if (selected) {
      this.setData({
        nickname: "",
        phone: ""
      });
    }
  },

  // 选择头像
  onChooseAvatar(e) {
    const {
      avatarUrl
    } = e.detail;
    console.log('选择的头像:', avatarUrl);

    this.setData({
      avatarUrl
    });

    // 上传头像到云存储
    const cloudPath = `avatars/${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`;

    wx.showLoading({
      title: '上传头像中...'
    });

    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: avatarUrl, // 临时文件路径
      success: res => {
        console.log('头像上传成功', res.fileID);
        this.setData({
          avatarUrl: res.fileID
        }); // 更新为 fileID
        wx.hideLoading();
      },
      fail: err => {
        console.error('头像上传失败', err);
        wx.hideLoading();
        wx.showToast({
          title: '头像上传失败',
          icon: 'none'
        });
      }
    });
  },

  // 协议勾选
  onAgreeChange(e) {
    this.setData({
      agreeProtocol: e.detail.value.length > 0
    });
  },

  // 输入框事件
  onNickname(e) {
    this.setData({
      nickname: e.detail.value
    });

    // 用户开始手动输入 → 自动采集取消
    if (e.detail.value) {
      this.setData({
        autoSelected: false
      });
    }
  },

  onPhone(e) {
    this.setData({
      phone: e.detail.value
    });

    // 用户开始手动输入 → 自动采集取消
    if (e.detail.value) {
      this.setData({
        autoSelected: false
      });
    }
  },

  chooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          address: res.address + res.name
        });
      },
      fail: (err) => {
        console.error("选择位置失败", err);
      }
    });
  },

  // 提交按钮逻辑
  finishExpanded(e) {
    // 必须勾选协议
    if (!this.data.agreeProtocol) {
      wx.showToast({
        title: "必须同意协议",
        icon: "none"
      });
      return;
    }
    if (!this.data.role) {
      wx.showToast({
        title: "请选择身份",
        icon: "none"
      });
      return;
    }
    //1如果都没有选择 二选一：自动 或 手动
    if (!this.data.autoSelected && (!this.data.nickname || !this.data.phone)) {
      wx.showToast({
        title: "请填写手动信息或选择自动采集",
        icon: "none"
      });
      return;
    }

    // 手动模式下的必填校验
    if (!this.data.autoSelected) {
      if (!this.data.nickname) {
        wx.showToast({
          title: "请填写昵称",
          icon: "none"
        });
        return;
      }
      if (!this.data.phone) {
        wx.showToast({
          title: "请填写联系方式",
          icon: "none"
        });
        return;
      }
      if (!this.data.address) {
        wx.showToast({
          title: "请选择详细地址",
          icon: "none"
        });
        return;
      }
    }

    if (this.data.isSubmitting) return; // 防止重复点击

    // 手动输入登录
    if (this.data.nickname && this.data.phone && this.data.role && !this.data.autoSelected) {
      this.setData({
        isSubmitting: true
      }); // 开始提交
      //2如果选择手动填写 手动输入向后端发请求=====================S
      wx.cloud.callFunction({
        name: 'NEWDL_login_fun',
        data: {
          nickname: this.data.nickname,
          phone: this.data.phone,
          role: this.data.role,
          address: this.data.address,
          avatarUrl: this.data.avatarUrl,
          forceNewUser: true, // 临时修复：强制标记为新用户
          envVersion: getApp().globalData.miniEnvVersion || 'develop'
        },
        success: (res) => {
          this.setData({
            isSubmitting: false
          }); // 结束提交
          console.log(res.result);
          if (res.result.status === 'success') {
            let token = res.result.token
            let nickname = res.result.nickname
            let role = res.result.role
            let isNewUser = res.result.isNewUser
            console.log("token是", token, "是否新用户:", isNewUser);
            
            const app = getApp();
            app.globalData.token = token;
            app.globalData.userRole = role;
            app.globalData.nickname = nickname;
            
            wx.setStorageSync('token', token);
            wx.setStorageSync('nickname', nickname);
            wx.setStorageSync('userRole', role);

            // 根据是否新用户显示不同的提示
            if (isNewUser) {
              wx.showToast({
                title: "注册成功，欢迎使用！",
                icon: "success"
              });
            } else {
              wx.showToast({
                title: "登录成功",
                icon: "success"
              });
            }

            // 跳转回首页
            setTimeout(() => {
              wx.switchTab({
                url: '/pages/index/index',
              });
            }, 1500);

          } else {
            // 输入有误
             wx.showToast({
                title: (res.result && res.result.message) || "登录失败",
                icon: "none"
              });
          }
          console.log('提交成功');
        },
        fail(err) {
          this.setData({
            isSubmitting: false
          }); // 结束提交
          console.log(err);
          wx.showToast({
            title: "网络错误",
            icon: "none"
          });
        }
      })
      // ========================================E
    }
  },

  onGetPhoneNumber(e) {
    if (this.data.isSubmitting) return;
    if (!this.data.role) {
      wx.showToast({
        title: "请选择身份",
        icon: "none"
      });
      return;
    }
    if (!this.data.agreeProtocol) {
      wx.showToast({
        title: "必须同意协议",
        icon: "none"
      });
      return;
    }
    const detail = e.detail || {};
    if (!detail.code) {
      wx.showToast({
        title: "未获取到手机号授权",
        icon: "none"
      });
      return;
    }
    this.setData({
      isSubmitting: true
    });
    wx.getUserProfile({
      desc: "用于完善用户资料",
      success: (userRes) => {
        const userInfo = userRes.userInfo || {};
        wx.chooseLocation({
          success: (locationRes) => {
            const selectedAddress = (locationRes.address || "") + (locationRes.name || "");
            const latitude = locationRes.latitude;
            const longitude = locationRes.longitude;
            const app = getApp();
            if (app.globalData) {
              app.globalData.userLocation = {
                latitude,
                longitude
              };
            }
            this.setData({
              address: selectedAddress
            });
            wx.showLoading({
              title: "登录中..."
            });
            wx.cloud.callFunction({
              name: "NEWDL_login_fun",
              data: {
                phoneCode: detail.code,
                nickname: userInfo.nickName,
                role: this.data.role,
                address: selectedAddress,
                latitude,
                longitude,
                forceNewUser: true,
                avatarUrl: this.data.avatarUrl || userInfo.avatarUrl,
                envVersion: getApp().globalData.miniEnvVersion || 'develop'
              },
              success: (res) => {
                wx.hideLoading();
                this.setData({
                  isSubmitting: false
                });
                if (res.result && res.result.status === "success") {
                  const result = res.result;
                  const token = result.token;
                  const nickname = result.nickname;
                  const role = result.role;
                  const isNewUser = result.isNewUser;
                  const avatarUrl = result.avatarUrl;
                  const app = getApp();
                  app.globalData.token = token;
                  app.globalData.userRole = role;
                  app.globalData.nickname = nickname;
                  app.globalData.avatarUrl = avatarUrl;
                  app.globalData.needChooseRole = false;
                  wx.setStorageSync("token", token);
                  wx.setStorageSync("userRole", role);
                  wx.setStorageSync("nickname", nickname);
                  wx.setStorageSync("avatarUrl", avatarUrl);
                  
                  wx.showToast({
                    title: isNewUser ? "注册成功" : "登录成功",
                    icon: "success"
                  });
                  
                  // 跳转回首页
                  setTimeout(() => {
                    wx.switchTab({
                      url: '/pages/index/index',
                    });
                  }, 1500);

                } else {
                  wx.showToast({
                    title: (res.result && res.result.message) || "登录失败",
                    icon: "none"
                  });
                }
              },
              fail: (err) => {
                wx.hideLoading();
                this.setData({
                  isSubmitting: false
                });
                console.error("NEWDL_login_fun 调用失败", err);
                wx.showToast({
                  title: "网络错误",
                  icon: "none"
                });
              }
            });
          },
          fail: () => {
            this.setData({
              isSubmitting: false
            });
            wx.showToast({
              title: "需要位置授权",
              icon: "none"
            });
          }
        });
      },
      fail: () => {
        this.setData({
          isSubmitting: false
        });
        wx.showToast({
          title: "需要用户信息授权",
          icon: "none"
        });
      }
    });
  },
  
  cancelManual() {
     wx.navigateBack({
       delta: 1
     });
     // Or redirect to index if it was a direct launch
     wx.switchTab({
        url: '/pages/index/index',
     });
  },
  
  calculateDistanceVal(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 99999;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
});
