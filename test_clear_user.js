// 测试用：清除特定用户数据
// 在小程序开发者工具控制台中运行这段代码

const testClearUser = async () => {
  // 先获取当前用户的openid
  const { OPENID } = await wx.cloud.getWXContext();
  console.log('当前用户OPENID:', OPENID);
  
  // 调用云函数清除用户
  wx.cloud.callFunction({
    name: 'debug_clear_user',
    data: { openid: OPENID },
    success: (res) => {
      console.log('清除结果:', res.result);
      if (res.result.code === 200) {
        console.log('用户数据清除成功！现在可以重新注册了');
        wx.showToast({ title: '数据已清除，请重新注册', icon: 'success' });
      }
    },
    fail: (err) => {
      console.error('清除失败:', err);
    }
  });
};

// 执行清除
testClearUser();