// pages/index/hot/hot.js
Page({
  data: {
    hotItems: [],
    categories: ['热门话题', '热门用户', '热门动态', '热门赛事'],
    currentCategory: 0,
    refreshing: false
  },

  onLoad() {
    this.loadHotItems();
  },

  onShow() {
    this.loadHotItems();
  },

  // 分类切换
  onCategoryChange(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ 
      currentCategory: index,
      hotItems: []
    });
    this.loadHotItems();
  },

  // 加载热门内容
  loadHotItems() {
    const category = this.data.categories[this.data.currentCategory];
    let url = '';
    
    switch(category) {
      case '热门话题':
        url = 'http://127.0.0.1:3000/hot/topics';
        break;
      case '热门用户':
        url = 'http://127.0.0.1:3000/hot/users';
        break;
      case '热门动态':
        url = 'http://127.0.0.1:3000/hot/posts';
        break;
      case '热门赛事':
        url = 'http://127.0.0.1:3000/hot/events';
        break;
    }

    wx.showLoading({ title: '加载中...' });
    
    wx.request({
      url: url,
      method: 'GET',
      data: { limit: 20 },
      success: (res) => {
        if (res.data.code === 200) {
          this.setData({ hotItems: this.processHotItems(res.data.data) });
        } else {
          wx.showToast({ title: res.data.message, icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '加载失败', icon: 'none' });
      },
      complete: () => {
        wx.hideLoading();
        this.setData({ refreshing: false });
      }
    });
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.setData({ refreshing: true });
    this.loadHotItems();
    wx.stopPullDownRefresh();
  },

  // 热门话题点击
  onTopicClick(e) {
    const topic = e.currentTarget.dataset.topic;
    wx.navigateTo({
      url: `/pages/circle/topic/topic?name=${encodeURIComponent(topic)}`
    });
  },

  // 用户点击
  onUserClick(e) {
    const userId = e.currentTarget.dataset.userId;
    wx.navigateTo({
      url: `/pages/profile/user/user?id=${userId}`
    });
  },

  // 动态点击
  onPostClick(e) {
    const postId = e.currentTarget.dataset.postId;
    wx.navigateTo({
      url: `/pages/circle/detail/circle_detail?id=${postId}`
    });
  },

  // 赛事点击
  onEventClick(e) {
    const eventId = e.currentTarget.dataset.eventId;
    wx.navigateTo({
      url: `/pages/index/events/detail/event_detail?id=${eventId}`
    });
  },

  // 关注用户
  onFollowUser(e) {
    const userId = e.currentTarget.dataset.userId;
    const index = e.currentTarget.dataset.index;
    const isFollowing = e.currentTarget.dataset.following;
    
    wx.request({
      url: `http://127.0.0.1:3000/user/${userId}/follow`,
      method: 'POST',
      data: { 
        followerId: wx.getStorageSync('userId'),
        action: isFollowing ? 'unfollow' : 'follow'
      },
      success: (res) => {
        if (res.data.code === 200) {
          const hotItems = [...this.data.hotItems];
          hotItems[index] = {
            ...hotItems[index],
            isFollowing: !isFollowing
          };
          this.setData({ hotItems });
          wx.showToast({ 
            title: isFollowing ? '取消关注' : '关注成功', 
            icon: 'success' 
          });
        } else {
          wx.showToast({ title: res.data.message, icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '操作失败', icon: 'none' });
      }
    });
  },

  // 分享
  onShare(e) {
    const type = e.currentTarget.dataset.type;
    const id = e.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ['分享给朋友', '分享到朋友圈'],
      success: (res) => {
        wx.showToast({ title: '分享功能开发中', icon: 'none' });
      }
    });
  },

  // 点赞
  onLike(e) {
    const type = e.currentTarget.dataset.type;
    const id = e.currentTarget.dataset.id;
    const index = e.currentTarget.dataset.index;
    
    wx.request({
      url: `http://127.0.0.1:3000/${type}/${id}/like`,
      method: 'POST',
      data: { userId: wx.getStorageSync('userId') },
      success: (res) => {
        if (res.data.code === 200) {
          const hotItems = [...this.data.hotItems];
          hotItems[index] = {
            ...hotItems[index],
            isLiked: !hotItems[index].isLiked,
            likes: hotItems[index].isLiked ? 
              hotItems[index].likes - 1 : 
              hotItems[index].likes + 1
          };
          this.setData({ hotItems });
        }
      }
    });
  },

  // 搜索
  onSearch() {
    wx.navigateTo({
      url: '/pages/search/search'
    });
  },

  // 获取排行图标
  getRankIcon(rank) {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return rank;
  },

  // 阻止事件冒泡
  stopPropagation() {
    // 空函数，用于阻止事件冒泡
  },

  // 处理热门数据，添加显示用的字段
  processHotItems(items) {
    return items.map(item => ({
      ...item,
      rankIcon: this.getRankIcon(item.rank),
      trendArrow: item.trend > 0 ? '↑' : item.trend < 0 ? '↓' : '→',
      trendAbs: Math.abs(item.trend)
    }));
  }
});