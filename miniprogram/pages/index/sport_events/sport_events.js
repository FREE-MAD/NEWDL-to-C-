// pages/index/sport_events/sport_events.js
Page({
  data: {
    activeCategory: 'all',
    searchText: '',
    showDetailModal: false,
    selectedEvent: null,
    hasMore: true,
    page: 1,
    categoryMap: {
      'competition': '比赛',
      'training': '训练', 
      'activity': '活动',
      'news': '新闻'
    },
    events: [
      {
        id: 1,
        title: '城市马拉松大赛',
        category: 'competition',
        image: '/images/marathon.jpg',
        date: '2024-03-15 08:00',
        location: '市中心广场',
        participants: 1250,
        description: '一年一度的城市马拉松大赛，全程42.195公里，设半程和全程两个组别。欢迎所有跑步爱好者报名参加！',
        isHot: true,
        isFavorited: false
      },
      {
        id: 2,
        title: '篮球友谊赛',
        category: 'activity',
        image: '/images/basketball.jpg',
        date: '2024-03-10 14:00',
        location: '体育中心篮球馆',
        participants: 48,
        description: '周末篮球友谊赛，5v5全场比赛，欢迎各水平球友参加，重在交流学习。',
        isHot: false,
        isFavorited: false
      },
      {
        id: 3,
        title: '游泳培训班',
        category: 'training',
        image: '/images/swimming.jpg',
        date: '2024-03-08 09:00',
        location: '市游泳馆',
        participants: 32,
        description: '专业游泳教练指导，从基础入门到进阶技术，小班教学，快速提升游泳技能。',
        isHot: false,
        isFavorited: false
      },
      {
        id: 4,
        title: '瑜伽晨练',
        category: 'activity',
        image: '/images/yoga.jpg',
        date: '2024-03-05 06:30',
        location: '公园草坪',
        participants: 86,
        description: '清晨瑜伽练习，呼吸新鲜空气，舒展身体，开启美好的一天。',
        isHot: true,
        isFavorited: false
      },
      {
        id: 5,
        title: '足球联赛',
        category: 'competition',
        image: '/images/football.jpg',
        date: '2024-03-20 16:00',
        location: '足球场',
        participants: 156,
        description: '业余足球联赛，每周一次，各路足球爱好者切磋球技，增进友谊。',
        isHot: true,
        isFavorited: false
      }
    ],
    filteredEvents: []
  },

  onLoad() {
    this.setData({
      filteredEvents: this.data.events
    });
    this.loadEvents();
  },

  // 加载赛事数据
  loadEvents() {
    const app = getApp();
    const token = app.globalData.token;

    if (token) {
      wx.request({
        url: 'http://127.0.0.1:3000/events',
        method: 'GET',
        header: {
          'Authorization': `Bearer ${token}`
        },
        success: (res) => {
          if (res.data.status === 'success') {
            this.setData({
              events: res.data.events || this.data.events,
              filteredEvents: res.data.events || this.data.events
            });
            this.filterEvents();
          }
        }
      });
    }
  },

  // 切换分类
  switchCategory(e) {
    const category = e.currentTarget.dataset.category;
    this.setData({
      activeCategory: category
    });
    this.filterEvents();
  },

  // 搜索输入
  onSearchInput(e) {
    this.setData({
      searchText: e.detail.value
    });
    this.filterEvents();
  },

  // 筛选赛事
  filterEvents() {
    const { events, activeCategory, searchText } = this.data;
    
    let filtered = events;

    // 按分类筛选
    if (activeCategory !== 'all') {
      filtered = filtered.filter(event => event.category === activeCategory);
    }

    // 按搜索词筛选
    if (searchText.trim()) {
      const searchLower = searchText.toLowerCase();
      filtered = filtered.filter(event => 
        event.title.toLowerCase().includes(searchLower) ||
        event.description.toLowerCase().includes(searchLower) ||
        event.location.toLowerCase().includes(searchLower)
      );
    }

    this.setData({
      filteredEvents: filtered
    });
  },

  // 查看赛事详情
  viewEventDetail(e) {
    const id = e.currentTarget.dataset.id;
    const event = this.data.events.find(item => item.id === id);
    
    if (event) {
      this.setData({
        selectedEvent: event,
        showDetailModal: true
      });
    }
  },

  // 隐藏详情模态框
  hideDetailModal() {
    this.setData({
      showDetailModal: false,
      selectedEvent: null
    });
  },

  // 切换收藏状态
  toggleFavorite() {
    const event = this.data.selectedEvent;
    const isFavorited = !event.isFavorited;
    
    // 更新本地状态
    const events = [...this.data.events];
    const eventIndex = events.findIndex(item => item.id === event.id);
    if (eventIndex !== -1) {
      events[eventIndex].isFavorited = isFavorited;
      
      this.setData({
        events: events,
        selectedEvent: {
          ...event,
          isFavorited: isFavorited
        }
      });
    }

    // 发送到后端
    const app = getApp();
    if (app.globalData.token) {
      wx.request({
        url: `http://127.0.0.1:3000/events/${event.id}/favorite`,
        method: 'POST',
        header: {
          'Authorization': `Bearer ${app.globalData.token}`
        },
        data: {
          favorited: isFavorited
        }
      });
    }

    wx.showToast({
      title: isFavorited ? '收藏成功' : '取消收藏',
      icon: 'success'
    });
  },

  // 分享赛事
  shareEvent() {
    const event = this.data.selectedEvent;
    
    // TODO: 实现具体分享逻辑
    console.log('分享赛事:', event);
    
    wx.showActionSheet({
      itemList: ['分享到微信', '分享到朋友圈', '复制链接'],
      success: () => {
        wx.showToast({
          title: '分享成功',
          icon: 'success'
        });
      }
    });
  },

  // 参加赛事
  joinEvent() {
    const event = this.data.selectedEvent;
    const app = getApp();

    if (!app.globalData.token) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      });
      return;
    }

    wx.showModal({
      title: '确认参加',
      content: `确定要参加"${event.title}"吗？`,
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({
            title: '报名中...'
          });

          wx.request({
            url: `http://127.0.0.1:3000/events/${event.id}/join`,
            method: 'POST',
            header: {
              'Authorization': `Bearer ${app.globalData.token}`
            },
            success: (res) => {
              wx.hideLoading();
              if (res.data.status === 'success') {
                // 更新参与人数
                const events = [...this.data.events];
                const eventIndex = events.findIndex(item => item.id === event.id);
                if (eventIndex !== -1) {
                  events[eventIndex].participants += 1;
                  
                  this.setData({
                    events: events,
                    selectedEvent: {
                      ...event,
                      participants: events[eventIndex].participants
                    }
                  });
                }

                wx.showToast({
                  title: '报名成功',
                  icon: 'success'
                });
              } else {
                wx.showToast({
                  title: res.data.message || '报名失败',
                  icon: 'none'
                });
              }
            },
            fail: () => {
              wx.hideLoading();
              wx.showToast({
                title: '网络错误，请重试',
                icon: 'none'
              });
            }
          });
        }
      }
    });
  },

  // 加载更多
  loadMore() {
    if (!this.data.hasMore) return;

    this.setData({
      page: this.data.page + 1
    });

    // 模拟加载更多数据
    setTimeout(() => {
      const newEvents = [
        {
          id: this.data.events.length + 1,
          title: '网球友谊赛',
          category: 'activity',
          image: '/images/tennis.jpg',
          date: '2024-03-25 10:00',
          location: '网球俱乐部',
          participants: 24,
          description: '周末网球友谊赛，欢迎各水平爱好者参加。',
          isHot: false,
          isFavorited: false
        }
      ];

      this.setData({
        events: [...this.data.events, ...newEvents],
        hasMore: this.data.page < 3 // 模拟最多3页
      });
      this.filterEvents();
    }, 1000);
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.setData({
      page: 1,
      hasMore: true
    });
    
    setTimeout(() => {
      wx.stopPullDownRefresh();
      wx.showToast({
        title: '刷新成功',
        icon: 'success'
      });
    }, 1000);
  },

  // 上拉加载
  onReachBottom() {
    this.loadMore();
  },

  // 分享
  onShareAppMessage() {
    return {
      title: '精彩体育赛事',
      path: '/pages/index/sport_events/sport_events'
    };
  }
});