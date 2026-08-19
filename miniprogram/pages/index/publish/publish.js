Page({
  data: {
    title: '',
    desc: '',
    contact: '',
    type: '',
    date: '',
    images: [],
    toolItems: []
  },

  onLoad() {
    // MVP 工具页：承接首页迁移过来的“课程管理”入口
    this.setData({
      toolItems: [
        {
          title: '课程管理',
          sub: '查看并管理已创建课程',
          action: 'TASK_PROGRESS'
        }
      ]
    });
  },

  // input 双向绑定
  onInputTitle(e) {
    this.setData({ title: e.detail.value });
  },
  onInputDesc(e) {
    this.setData({ desc: e.detail.value });
  },
  onInputContact(e) {
    this.setData({ contact: e.detail.value });
  },

  // 单选类型
  onTypeChange(e) {
    this.setData({ type: e.detail.value });
  },

  // 日期选择
  onDateChange(e) {
    this.setData({ date: e.detail.value });
  },

  // 图片选择
  chooseImage() {
    wx.chooseImage({
      count: 3, // 最多3张
      sizeType: ['original', 'compressed'],
      sourceType: ['album', 'camera'],
      success: res => {
        const newImages = this.data.images.concat(res.tempFilePaths);
        this.setData({ images: newImages });
      }
    })
  },

  // 删除图片
  removeImage(e) {
    const index = e.currentTarget.dataset.index;
    const imgs = this.data.images;
    imgs.splice(index, 1);
    this.setData({ images: imgs });
  },

  // 提交表单
  submitForm(e) {
    if (!this.data.title || !this.data.desc || !this.data.type || !this.data.contact) {
      wx.showToast({ title: '请填写完整信息', icon: 'none' });
      return;
    }

    wx.request({
      url: 'http://127.0.0.1:3000/task/create', // 后端接口
      method: 'POST',
      data: {
        title: this.data.title,
        desc: this.data.desc,
        type: this.data.type,
        contact: this.data.contact,
        date: this.data.date,
        images: this.data.images
      },
      success: res => {
        if (res.data.status === 'success') {
          wx.showToast({ title: '发布成功', icon: 'success' });
          this.setData({
            title: '',
            desc: '',
            contact: '',
            type: '',
            date: '',
            images: []
          });
        } else {
          wx.showToast({ title: '发布失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络错误', icon: 'none' });
      }
    })
  },

  // 工具页点击分发
  onToolTap(e) {
    const action = e.currentTarget.dataset.action;
    if (action === 'TASK_PROGRESS') {
      wx.navigateTo({
        url: '/pages/task/progress/progress'
      });
    }
  }
})
