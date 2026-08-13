// pages/circle/circle.js
Page({
  data: {
    posts: [],
    categories: ['推荐', '关注', '篮球', '足球', '健身', '跑步'],
    currentCategory: 0,
    loading: false,
    hasMore: true
  },

  onLoad() {
    this.loadPosts();
  },

  onShow() {
    this.loadPosts();
  },

  // 加载动态
  loadPosts(refresh = false) {
    if (this.data.loading) return;
    
    this.setData({ loading: true });
    
    const category = this.data.categories[this.data.currentCategory];
    
    wx.request({
      url: 'http://127.0.0.1:3000/circle/posts',
      method: 'GET',
      data: {
        category: category,
        offset: refresh ? 0 : this.data.posts.length,
        limit: 10
      },
      success: (res) => {
        if (res.data.code === 200) {
          const newPosts = res.data.data;
          this.setData({
            posts: refresh ? newPosts : [...this.data.posts, ...newPosts],
            hasMore: newPosts.length >= 10
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

  // 分类切换
  onCategoryChange(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ 
      currentCategory: index,
      posts: []
    });
    this.loadPosts(true);
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.loadPosts(true);
    wx.stopPullDownRefresh();
  },

  // 上拉加载
  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadPosts();
    }
  },

  // 点赞
  onLikePost(e) {
    const postId = e.currentTarget.dataset.id;
    const index = e.currentTarget.dataset.index;
    const post = this.data.posts[index];
    const isLiked = post.isLiked;
    
    wx.request({
      url: `http://127.0.0.1:3000/circle/post/${postId}/like`,
      method: 'POST',
      data: { 
        userId: wx.getStorageSync('userId'),
        action: isLiked ? 'unlike' : 'like'
      },
      success: (res) => {
        if (res.data.code === 200) {
          const posts = [...this.data.posts];
          posts[index] = {
            ...post,
            isLiked: !isLiked,
            likes: isLiked ? post.likes - 1 : post.likes + 1
          };
          this.setData({ posts });
        }
      }
    });
  },

  // 评论
  onCommentPost(e) {
    const postId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/circle/detail/circle_detail?id=${postId}`
    });
  },

  // 分享
  onSharePost(e) {
    const postId = e.currentTarget.dataset.id;
    // 这里可以实现分享功能
    wx.showToast({ title: '分享功能开发中', icon: 'none' });
  },

  // 预览图片
  onPreviewImage(e) {
    const { urls, current } = e.currentTarget.dataset;
    wx.previewImage({
      current: current,
      urls: urls
    });
  },

  // 查看用户主页
  onUserAvatar(e) {
    const userId = e.currentTarget.dataset.userId;
    wx.navigateTo({
      url: `/pages/profile/user/user?id=${userId}`
    });
  },

  // 发布动态
  onPublishPost() {
    wx.navigateTo({
      url: '/pages/circle/publish/circle_publish'
    });
  }
});