// ==========================================
// 自动测试脚本：Order Manage 流程
// 使用方法：
// 1. 打开微信开发者工具
// 2. 确保项目已运行且云函数 order_manage 已上传
// 3. 复制本文件所有代码
// 4. 在调试器 Console 面板粘贴并回车运行
// ==========================================

const runTest = async () => {
  console.log('%c🚀 开始测试 order_manage 流程...', 'color: blue; font-weight: bold; font-size: 14px;');
  
  const timestamp = Date.now();
  const testUserId = 'test_user_' + timestamp;
  let orderId = '';

  // 1. 测试发布订单
  console.group('1. 测试发布 (Publish)');
  try {
    const pubRes = await wx.cloud.callFunction({
      name: 'order_manage',
      data: {
        action: 'publish',
        userId: testUserId,
        userRole: 'R',
        submitForm: {
          title: `测试订单 ${timestamp}`,
          description: '这是一个自动测试生成的订单',
          price: '100',
          location: '测试地点',
          ing_day_time: '2023-12-31',
          category: '测试',
          contact: '13800000000',
          frequency: '一次'
        }
      }
    });
    
    if (pubRes.result.code === 0 && pubRes.result.orderId) {
      orderId = pubRes.result.orderId;
      console.log('✅ 发布成功, Order ID:', orderId);
    } else {
      throw new Error(pubRes.result.msg || '发布失败');
    }
  } catch (e) {
    console.error('❌ 发布测试失败:', e);
    console.groupEnd();
    return;
  }
  console.groupEnd();

  // 2. 测试获取详情
  console.group('2. 测试获取详情 (Get)');
  try {
    const getRes = await wx.cloud.callFunction({
      name: 'order_manage',
      data: {
        action: 'get_oneorder',
        orderId: orderId
      }
    });

    if (getRes.result.code === 0 && getRes.result.data._id === orderId) {
      console.log('✅ 获取详情成功:', getRes.result.data.title);
    } else {
      throw new Error(getRes.result.msg || '获取详情失败');
    }
  } catch (e) {
    console.error('❌ 获取详情测试失败:', e);
  }
  console.groupEnd();

  // 3. 测试列表拉取 (R视角)
  console.group('3. 测试列表拉取 (List - R)');
  try {
    const listRes = await wx.cloud.callFunction({
      name: 'order_manage',
      data: {
        action: 'list',
        userId: testUserId,
        userRole: 'R'
      }
    });

    const found = listRes.result.data.find(item => item._id === orderId);
    if (listRes.result.code === 0 && found) {
      console.log('✅ 列表拉取成功，找到刚才发布的订单');
    } else {
      throw new Error('列表中未找到新订单');
    }
  } catch (e) {
    console.error('❌ 列表测试失败:', e);
  }
  console.groupEnd();

  // 4. 测试接单 (P视角 - 模拟另一个用户)
  console.group('4. 测试接单 (Accept)');
  const providerId = 'test_provider_' + timestamp;
  try {
    const acceptRes = await wx.cloud.callFunction({
      name: 'order_manage',
      data: {
        action: 'accept',
        orderId: orderId,
        userId: providerId,
        userRole: 'P'
      }
    });

    if (acceptRes.result.code === 0) {
      console.log('✅ 接单成功');
    } else {
      throw new Error(acceptRes.result.msg || '接单失败');
    }
  } catch (e) {
    console.error('❌ 接单测试失败:', e);
  }
  console.groupEnd();

  // 5. 再次获取详情确认状态
  console.group('5. 确认状态 (Check Status)');
  try {
    const checkRes = await wx.cloud.callFunction({
      name: 'order_manage',
      data: { action: '', orderId: orderId }
    });
    const status = checkRes.result.data.status;
    console.log(`当前状态: ${status} (预期: accepted)`);
    if (status !== 'accepted') console.warn('⚠️ 状态不符合预期');
  } catch(e) { console.error(e); }
  console.groupEnd();

  // 6. 测试完成订单 (P视角)
  console.group('6. 测试完成 (Complete)');
  try {
    const compRes = await wx.cloud.callFunction({
      name: 'order_manage',
      data: {
        action: 'complete',
        orderId: orderId,
        userId: providerId, // 必须是接单人
        userRole: 'P'
      }
    });

    if (compRes.result.code === 0) {
      console.log('✅ 完成订单成功');
    } else {
      throw new Error(compRes.result.msg || '完成订单失败');
    }
  } catch (e) {
    console.error('❌ 完成订单测试失败:', e);
  }
  console.groupEnd();

  console.log('%c🎉 测试流程结束!', 'color: green; font-weight: bold; font-size: 16px;');
};

runTest();
