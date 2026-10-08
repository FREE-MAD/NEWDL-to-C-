const fs = require('fs');
const path = 'C:/Users/32614/Desktop/sport_yun/代码_8月中进行重构/miniprogram/pages/organization/organization.js';
try {
  const c = fs.readFileSync(path, 'utf8');
  // 替换 require 调用让代码能在 Node 里解析（不执行）
  const cleaned = c.replace(/require\(([^)]+)\)/g, 'require("DUMMY")');
  // eslint-disable-next-line no-new-func
  new Function(cleaned);
  console.log('JS OK,', c.length, 'bytes');
} catch (e) {
  console.log('JS Syntax Error:', e.message);
  console.log('Line context around error if available');
}
