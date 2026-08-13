// 兼容旧页面路径：开发者工具或历史入口命中时，统一跳转到当前发布页
Page({
  onLoad(options) {
    const query = options && options.id ? `?id=${options.id}` : ''
    wx.redirectTo({
      url: `/pages/task/publish/publish${query}`
    })
  }
})
