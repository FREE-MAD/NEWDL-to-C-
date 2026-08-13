// pages/train/plan/plan.js
Page({
  data: {
    plans: [],
    currentTab: 0,
    tabs: ['我的计划', '推荐计划', '计划模板'],
    categories: ['全部', '力量训练', '有氧运动', '柔韧性', '平衡训练'],
    currentCategory: 0,
    creatingPlan: false
  },

  onLoad() {
    this.loadPlans();
  },

  onShow() {
    this.loadPlans();
  },

  // 标签切换
  onTabChange(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ currentTab: index });
    this.loadPlans();
  },

  // 分类切换
  onCategoryChange(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ currentCategory: index });
    this.loadPlans();
  },

  // 加载计划列表
  loadPlans() {
    const userId = wx.getStorageSync('userId');
    const tab = this.data.tabs[this.data.currentTab];
    const category = this.data.categories[this.data.currentCategory];
    
    wx.showLoading({ title: '加载中...' });
    
    let url = '';
    let data = {};
    
    if (tab === '我的计划') {
      url = 'http://127.0.0.1:3000/train/my-plans';
      data = { userId };
    } else if (tab === '推荐计划') {
      url = 'http://127.0.0.1:3000/train/recommended-plans';
      data = { category };
    } else {
      url = 'http://127.0.0.1:3000/train/plan-templates';
      data = { category };
    }
    
    wx.request({
      url: url,
      method: 'GET',
      data: data,
      success: (res) => {
        if (res.data.code === 200) {
          this.setData({ plans: res.data.data });
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

  // 创建计划
  onCreatePlan() {
    this.setData({ creatingPlan: true });
    wx.navigateTo({
      url: '/pages/train/create/create'
    });
  },

  // 查看计划详情
  onPlanDetail(e) {
    const planId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/train/detail/train_detail?id=${planId}`
    });
  },

  // 开始训练
  onStartTraining(e) {
    const planId = e.currentTarget.dataset.id;
    
    wx.showModal({
      title: '开始训练',
      content: '确定要开始这个训练计划吗？',
      success: (res) => {
        if (res.confirm) {
          wx.request({
            url: `http://127.0.0.1:3000/train/${planId}/start`,
            method: 'POST',
            data: { userId: wx.getStorageSync('userId') },
            success: (res) => {
              if (res.data.code === 200) {
                wx.showToast({ title: '训练已开始', icon: 'success' });
                // 跳转到训练执行页面
                wx.navigateTo({
                  url: `/pages/train/execute/execute?planId=${planId}`
                });
              } else {
                wx.showToast({ title: res.data.message, icon: 'none' });
              }
            },
            fail: () => {
              wx.showToast({ title: '操作失败', icon: 'none' });
            }
          });
        }
      }
    });
  },

  // 采纳计划
  onAdoptPlan(e) {
    const planId = e.currentTarget.dataset.id;
    
    wx.request({
      url: `http://127.0.0.1:3000/train/${planId}/adopt`,
      method: 'POST',
      data: { userId: wx.getStorageSync('userId') },
      success: (res) => {
        if (res.data.code === 200) {
          wx.showToast({ title: '采纳成功', icon: 'success' });
          this.loadPlans();
        } else {
          wx.showToast({ title: res.data.message, icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '采纳失败', icon: 'none' });
      }
    });
  },

  // 编辑计划
  onEditPlan(e) {
    const planId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/train/edit/train_edit?id=${planId}`
    });
  },

  // 删除计划
  onDeletePlan(e) {
    const planId = e.currentTarget.dataset.id;
    
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个训练计划吗？',
      confirmText: '删除',
      confirmColor: '#ff4757',
      success: (res) => {
        if (res.confirm) {
          wx.request({
            url: `http://127.0.0.1:3000/train/plan/${planId}/delete`,
            method: 'POST',
            data: { userId: wx.getStorageSync('userId') },
            success: (res) => {
              if (res.data.code === 200) {
                wx.showToast({ title: '删除成功', icon: 'success' });
                this.loadPlans();
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

  // 获取难度颜色
  getDifficultyColor(difficulty) {
    const colors = {
      easy: '#4CAF50',
      medium: '#FF9800',
      hard: '#F44336'
    };
    return colors[difficulty] || '#666';
  },

  // 获取难度文本
  getDifficultyText(difficulty) {
    const texts = {
      easy: '简单',
      medium: '中等',
      hard: '困难'
    };
    return texts[difficulty] || '未知';
  }
});