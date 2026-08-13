// pages/index/events/list/list.js
Page({
  data: {
    events: [],
    categories: ['全部', '篮球赛', '足球赛', '马拉松', '健身比赛', '游泳比赛'],
    currentCategory: 0,
    sortBy: 'latest',
    loading: false,
    hasMore: true,
    filters: {
      location: '',
      dateRange: '',
      feeRange: ''
    }
  },

  onLoad() {
    this.loadEvents();
  },

  onShow() {
    this.loadEvents();
  },

  // 分类切换
  onCategoryChange(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ 
      currentCategory: index,
      events: []
    });
    this.loadEvents(true);
  },

  // 排序切换
  onSortChange() {
    const sorts = ['latest', 'hot', 'upcoming', 'free'];
    const currentIndex = sorts.indexOf(this.data.sortBy);
    const nextIndex = (currentIndex + 1) % sorts.length;
    const sortNames = { 
      latest: '最新', 
      hot: '热度', 
      upcoming: '即将开始', 
      free: '免费' 
    };
    
    this.setData({ sortBy: sorts[nextIndex] });
    wx.showToast({ title: `按${sortNames[sorts[nextIndex]]}排序`, icon: 'none' });
    this.loadEvents(true);
  },

  // 加载赛事列表
  loadEvents(refresh = false) {
    if (this.data.loading) return;
    
    this.setData({ loading: true });
    
    const category = this.data.categories[this.data.currentCategory];
    
    wx.request({
      url: 'http://127.0.0.1:3000/events/list',
      method: 'GET',
      data: {
        category: category === '全部' ? '' : category,
        sort: this.data.sortBy,
        offset: refresh ? 0 : this.data.events.length,
        limit: 10,
        ...this.data.filters
      },
      success: (res) => {
        if (res.data.code === 200) {
          const newEvents = res.data.data;
          this.setData({
            events: refresh ? newEvents : [...this.data.events, ...newEvents],
            hasMore: newEvents.length >= 10
          });
        } else {
          wx.showToast({ title: res.data.message, icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '加载失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ loading: false });
      }
    });
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.loadEvents(true);
    wx.stopPullDownRefresh();
  },

  // 上拉加载
  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadEvents();
    }
  },

  // 赛事详情
  onEventDetail(e) {
    const eventId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/index/events/detail/event_detail?id=${eventId}`
    });
  },

  // 报名参赛
  onRegisterEvent(e) {
    const eventId = e.currentTarget.dataset.id;
    const event = this.data.events.find(item => item.id === eventId);
    
    if (event.isRegistered) {
      wx.showToast({ title: '您已报名', icon: 'none' });
      return;
    }
    
    wx.showModal({
      title: '确认报名',
      content: `确定要报名参加"${event.title}"吗？报名费用：¥${event.fee}`,
      success: (res) => {
        if (res.confirm) {
          this.processRegistration(eventId);
        }
      }
    });
  },

  // 处理报名
  processRegistration(eventId) {
    wx.showLoading({ title: '报名中...' });
    
    wx.request({
      url: `http://127.0.0.1:3000/events/${eventId}/register`,
      method: 'POST',
      data: { userId: wx.getStorageSync('userId') },
      success: (res) => {
        if (res.data.code === 200) {
          wx.showToast({ title: '报名成功', icon: 'success' });
          // 更新列表状态
          const events = [...this.data.events];
          const eventIndex = events.findIndex(item => item.id === eventId);
          if (eventIndex !== -1) {
            events[eventIndex] = {
              ...events[eventIndex],
              isRegistered: true,
              participants: events[eventIndex].participants + 1
            };
            this.setData({ events });
          }
        } else {
          wx.showToast({ title: res.data.message, icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '报名失败', icon: 'none' });
      },
      complete: () => {
        wx.hideLoading();
      }
    });
  },

  // 取消报名
  onCancelRegistration(e) {
    const eventId = e.currentTarget.dataset.id;
    const event = this.data.events.find(item => item.id === eventId);
    
    wx.showModal({
      title: '确认取消',
      content: `确定要取消报名"${event.title}"吗？`,
      success: (res) => {
        if (res.confirm) {
          this.processCancellation(eventId);
        }
      }
    });
  },

  // 处理取消报名
  processCancellation(eventId) {
    wx.showLoading({ title: '处理中...' });
    
    wx.request({
      url: `http://127.0.0.1:3000/events/${eventId}/cancel`,
      method: 'POST',
      data: { userId: wx.getStorageSync('userId') },
      success: (res) => {
        if (res.data.code === 200) {
          wx.showToast({ title: '取消成功', icon: 'success' });
          // 更新列表状态
          const events = [...this.data.events];
          const eventIndex = events.findIndex(item => item.id === eventId);
          if (eventIndex !== -1) {
            events[eventIndex] = {
              ...events[eventIndex],
              isRegistered: false,
              participants: events[eventIndex].participants - 1
            };
            this.setData({ events });
          }
        } else {
          wx.showToast({ title: res.data.message, icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '操作失败', icon: 'none' });
      },
      complete: () => {
        wx.hideLoading();
      }
    });
  },

  // 分享赛事
  onShareEvent(e) {
    const eventId = e.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ['分享给朋友', '分享到朋友圈'],
      success: (res) => {
        wx.showToast({ title: '分享功能开发中', icon: 'none' });
      }
    });
  },

  // 查看地图
  onViewMap(e) {
    const location = e.currentTarget.dataset.location;
    wx.openLocation({
      latitude: location.latitude,
      longitude: location.longitude,
      name: location.name,
      address: location.address
    });
  },

  // 显示筛选器
  onShowFilter() {
    wx.navigateTo({
      url: '/pages/index/events/filter/filter'
    });
  },

  // 获取状态颜色
  getStatusColor(status) {
    const colors = {
      upcoming: '#4CAF50',
      ongoing: '#FF9800',
      ended: '#999',
      cancelled: '#F44336'
    };
    return colors[status] || '#666';
  },

  // 获取状态文本
  getStatusText(status) {
    const texts = {
      upcoming: '即将开始',
      ongoing: '进行中',
      ended: '已结束',
      cancelled: '已取消'
    };
    return texts[status] || '未知';
  }
});