// pages/profile/edit/edit.js
Page({
  data: {
    profile: {
      nickname: '',
      avatar: '',
      gender: 1,
      age: '',
      height: '',
      weight: '',
      phone: '',
      email: '',
      bio: '',
      sports: [],
      location: ''
    },
    sportOptions: [
      { name: '篮球', value: 'basketball' },
      { name: '足球', value: 'football' },
      { name: '网球', value: 'tennis' },
      { name: '羽毛球', value: 'badminton' },
      { name: '游泳', value: 'swimming' },
      { name: '健身', value: 'fitness' },
      { name: '跑步', value: 'running' },
      { name: '瑜伽', value: 'yoga' }
    ]
  },

  onLoad() {
    this.loadProfile();
  },

  // 加载个人资料
  loadProfile() {
    const userId = wx.getStorageSync('userId');
    
    wx.request({
      url: `http://127.0.0.1:3000/user/${userId}/profile`,
      method: 'GET',
      success: (res) => {
        if (res.data.code === 200) {
          this.setData({ profile: res.data.data });
        } else {
          wx.showToast({ title: '加载失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络错误', icon: 'none' });
      }
    });
  },

  // 选择头像
  onChooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        this.uploadAvatar(tempFilePath);
      }
    });
  },

  // 上传头像
  uploadAvatar(filePath) {
    wx.showLoading({ title: '上传中...' });
    
    wx.uploadFile({
      url: 'http://127.0.0.1:3000/upload/avatar',
      filePath: filePath,
      name: 'avatar',
      success: (res) => {
        const data = JSON.parse(res.data);
        if (data.code === 200) {
          this.setData({
            'profile.avatar': data.url
          });
        } else {
          wx.showToast({ title: '上传失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '上传失败', icon: 'none' });
      },
      complete: () => {
        wx.hideLoading();
      }
    });
  },

  // 输入事件
  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({
      [`profile.${field}`]: value
    });
  },

  // 性别选择
  onGenderChange(e) {
    this.setData({
      'profile.gender': parseInt(e.detail.value)
    });
  },

  // 运动爱好选择
  onSportChange(e) {
    const selected = e.detail.value;
    this.setData({
      'profile.sports': selected
    });
  },

  // 位置选择
  onLocationChoose() {
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          'profile.location': `${res.name} - ${res.address}`
        });
      }
    });
  },

  // 保存资料
  onSave() {
    if (!this.validateProfile()) {
      return;
    }

    wx.showLoading({ title: '保存中...' });
    
    wx.request({
      url: 'http://127.0.0.1:3000/user/profile/update',
      method: 'POST',
      data: {
        userId: wx.getStorageSync('userId'),
        ...this.data.profile
      },
      success: (res) => {
        if (res.data.code === 200) {
          wx.showToast({ title: '保存成功', icon: 'success' });
          setTimeout(() => {
            wx.navigateBack();
          }, 1500);
        } else {
          wx.showToast({ title: res.data.message, icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '保存失败', icon: 'none' });
      },
      complete: () => {
        wx.hideLoading();
      }
    });
  },

  // 验证资料
  validateProfile() {
    const profile = this.data.profile;
    
    if (!profile.nickname.trim()) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return false;
    }
    
    if (!profile.age || profile.age < 1 || profile.age > 120) {
      wx.showToast({ title: '请输入有效年龄', icon: 'none' });
      return false;
    }
    
    if (!profile.phone || !/^1[3-9]\d{9}$/.test(profile.phone)) {
      wx.showToast({ title: '请输入有效手机号', icon: 'none' });
      return false;
    }
    
    return true;
  }
});