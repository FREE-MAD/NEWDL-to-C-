// ==========================================
// 一次性运维脚本（2026-10-10 · 课程流转 Q4）
//
// 作用：把存量订单里非法的 fulfill_state = 'pending' 归一成 'awaiting'（顶层 + 内层一起改）。
//
// 为什么必须清洗：
//   1. pending 是历史遗留值 —— 早期「半途接入课表」和「B 侧桥接建单」都会写它。
//      写侧现在已经堵住：_lesson.js 的 syncLessonProgress 不再写状态、
//      owner（_shared/courseState.js）会把 to=pending 归一成 awaiting。
//   2. 但库里的存量没人动过。前端 progress.js 只认 editing / awaiting / in_progress 三个值，
//      pending 三个都不成立 → 会掉进「按有没有排课重新推断」的老分支，Tab 可能落错档。
//
// 使用方法（和 test_order_manage.js 一样的跑法）：
//   1. 打开微信开发者工具，**切到目标环境**（开发版 / 正式版）
//   2. 复制本文件全部代码，在调试器 Console 面板粘贴并回车
//   3. 先按默认 DRY_RUN = true 跑：只统计、只打印，一个字都不写库
//   4. 核对统计数字无误后，把 DRY_RUN 改成 false，再跑一次
//
// 注意：
//   - 集合名按环境带前缀：开发 NDLdev_execution_orders / 正式 NDLreal_execution_orders
//   - 只改 fulfill_state === 'pending' 的订单，其它字段一律不动
//   - state_history 不用改：pending 与 awaiting 同属 pl 档（courseState.stateSuffixOf 的口径）
//   - 小程序端不支持 where().update() 批量写，只能逐条 doc().update()
// ==========================================

const DRY_RUN = true;   // ← 先 true 看统计，确认后改 false
const IS_DEV = true;    // ← 开发环境 true，正式环境 false
const COLLECTION = (IS_DEV ? 'NDLdev_' : 'NDLreal_') + 'execution_orders';
const PAGE_SIZE = 100;

const run = async () => {
  const db = wx.cloud.database();
  const cmd = db.command;

  const where = cmd.or([
    { fulfill_state: 'pending' },
    { 'course_flow_info.fulfill_state': 'pending' }
  ]);

  // 第一步：分页把所有待处理 _id 收齐（此阶段不写库，skip 分页是安全的）
  const ids = [];
  while (true) {
    const res = await db.collection(COLLECTION)
      .where(where)
      .field({ _id: true })
      .skip(ids.length)
      .limit(PAGE_SIZE)
      .get();
    const list = (res && res.data) || [];
    if (!list.length) break;
    ids.push(...list.map(item => item._id));
    if (list.length < PAGE_SIZE) break;
  }

  console.log(`[fix_pending] 集合=${COLLECTION}  命中 fulfill_state=pending 的订单：${ids.length} 条`);
  if (!ids.length) {
    console.log('[fix_pending] 没有需要清洗的数据，结束。');
    return;
  }

  if (DRY_RUN) {
    console.log('[fix_pending] DRY_RUN = true，仅列出前 20 条，不做任何写入：');
    console.log(ids.slice(0, 20));
    console.log('[fix_pending] 确认无误后把 DRY_RUN 改成 false 再跑一次。');
    return;
  }

  // 第二步：逐条归一（顶层 + 内层都写，避免 readCourseState 内层优先读到旧值）
  let ok = 0;
  const failed = [];
  for (const id of ids) {
    try {
      await db.collection(COLLECTION).doc(id).update({
        data: {
          fulfill_state: 'awaiting',
          'course_flow_info.fulfill_state': 'awaiting',
          updatedAt: new Date()
        }
      });
      ok += 1;
    } catch (err) {
      failed.push({ id, msg: (err && err.message) || String(err) });
    }
  }

  console.log(`[fix_pending] 完成：成功 ${ok} 条，失败 ${failed.length} 条`);
  if (failed.length) {
    console.warn('[fix_pending] 失败明细：', failed);
  }
};

run();
