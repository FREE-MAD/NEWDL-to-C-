// pages/exercise/record/record.js
Page({
  data: {
    records: [],
    currentDate: '',
    stats: {
      totalDuration: 0,
      totalCalories: 0,
      totalDistance: 0,
      weekCount: 0
    },
    showCalendar: false,
    selectedDate: ''
  },

  onLoad() {
    const today = new Date();
    const currentDate = this.formatDate(today);
    this.setData({ 
      currentDate,
      selectedDate: currentDate
    });
    this.loadRecords();
    this.loadStats();
  },

  onShow() {
    this.loadRecords();
    this.loadStats();
  },

  // 格式化日期
  formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 加载运动记录
  loadRecords() {
    const userId = wx.getStorageSync('userId');
    
    wx.showLoading({ title: '加载中...' });
    
    wx.request({
      url: 'http://127.0.0.1:3000/exercise/records',
      method: 'GET',
      data: {
        userId: userId,
        date: this.data.selectedDate
      },
      success: (res) => {
        if (res.data.code === 200) {
          const processedRecords = res.data.data.map(record => ({
            ...record,
            sportIcon: this.getSportIcon(record.type)
          }));
          this.setData({ records: processedRecords });
        } else {
          wx.showToast({ title: res.data.message, icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '加载失败', icon: 'none' });
      },
      complete: () => {
        wx.hideLoading();
      }
    });
  },

  // 加载统计数据
  loadStats() {
    const userId = wx.getStorageSync('userId');
    
    wx.request({
      url: 'http://127.0.0.1:3000/exercise/stats',
      method: 'GET',
      data: { userId: userId },
      success: (res) => {
        if (res.data.code === 200) {
          this.setData({ stats: res.data.data });
        }
      }
    });
  },

  // 显示日历
  onShowCalendar() {
    this.setData({ showCalendar: true });
  },

  // 隐藏日历
  onHideCalendar() {
    this.setData({ showCalendar: false });
  },

  // 日期选择
  onDateChange(e) {
    const date = e.detail.value;
    this.setData({ 
      selectedDate: date,
      currentDate: date
    });
    this.loadRecords();
    this.onHideCalendar();
  },

  // 添加运动记录
  onAddRecord() {
    wx.navigateTo({
      url: '/pages/exercise/add/add'
    });
  },

  // 查看详情
  onRecordDetail(e) {
    const recordId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/exercise/detail/exercise_detail?id=${recordId}`
    });
  },

  // 编辑记录
  onEditRecord(e) {
    const recordId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/exercise/edit/exercise_edit?id=${recordId}`
    });
  },

  // 删除记录
  onDeleteRecord(e) {
    const recordId = e.currentTarget.dataset.id;
    
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条运动记录吗？',
      confirmText: '删除',
      confirmColor: '#ff4757',
      success: (res) => {
        if (res.confirm) {
          wx.request({
            url: `http://127.0.0.1:3000/exercise/record/${recordId}/delete`,
            method: 'POST',
            data: { userId: wx.getStorageSync('userId') },
            success: (res) => {
              if (res.data.code === 200) {
                wx.showToast({ title: '删除成功', icon: 'success' });
                this.loadRecords();
                this.loadStats();
              } else {
                wx.showToast({ title: res.data.message, icon: 'none' });
              }
            },
            fail: () => {
              wx.showToast({ title: '删除失败', icon: 'none' });
            }
          });
        }
      }
    });
  },

  // 分享记录
  onShareRecord(e) {
    const recordId = e.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ['分享到朋友圈', '分享给朋友', '保存图片'],
      success: (res) => {
        // 这里可以实现具体的分享逻辑
        wx.showToast({ title: '分享功能开发中', icon: 'none' });
      }
    });
  },

  // 预览图片
  onPreviewImage(e) {
    const { urls, current } = e.currentTarget.dataset;
    wx.previewImage({
      current: current,
      urls: urls
    });
  },

  // 阻止事件冒泡
  stopPropagation() {
    // 空函数，用于阻止事件冒泡
  },

  // 获取运动类型图标
  getSportIcon(type) {
    const icons = {
      running: '🏃',
      cycling: '🚴',
      swimming: '🏊',
      fitness: '💪',
      yoga: '🧘',
      basketball: '🏀',
      football: '⚽',
      tennis: '🎾'
    };
    return icons[type] || '🏃';
  }
});