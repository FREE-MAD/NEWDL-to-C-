/**
 * _shared/index.js —— 聚合出口
 *
 * 只是为了少写几行 require，业务函数可以按需选其一：
 *   const { initRuntime, collectionName, fail, ok, toResponse, makeLogger } = require('./_shared')
 *   const { initRuntime } = require('./_shared/runtime')   // 也可以单拿
 *
 * 注意：不要在这里 require('wx-server-sdk') 之外的重型依赖；
 * runtime.js 内部是懒加载，聚合出口本身不触发 cloud.init。
 */

const runtime = require('./runtime');
const collections = require('./collections');
const request = require('./request');
const errors = require('./errors');
const logger = require('./logger');
const http = require('./http');
const security = require('./security');
const courseState = require('./courseState');

module.exports = {
  // L0 底座
  initRuntime: runtime.initRuntime,
  dbHandle: runtime.dbHandle,
  normalizeEnvVersion: runtime.normalizeEnvVersion,
  collectionName: collections.collectionName,
  normalizeCollectionName: collections.normalizeCollectionName,
  BASE: collections.BASE,
  normalizeRequestEvent: request.normalizeRequestEvent,
  parseJsonLike: request.parseJsonLike,

  // L1 公共层
  CODES: errors.CODES,
  AppError: errors.AppError,
  fail: errors.fail,
  ok: errors.ok,
  toResponse: errors.toResponse,
  makeLogger: logger.make,

  // L1 公共层（2026-10-08 新增）
  ENDPOINTS: http.ENDPOINTS,
  postJson: http.postJson,
  getJson: http.getJson,
  isSecurityCheckPassed: security.isSecurityCheckPassed,
  isSecurityViolationError: security.isSecurityViolationError,
  isOpenAPIPermissionError: security.isOpenAPIPermissionError,
  callMsgSecCheck: security.callMsgSecCheck,

  // L2 领域层（2026-10-08 新增）
  COURSE_STATE: courseState.COURSE_STATE,
  readCourseState: courseState.readCourseState,
  isTerminalState: courseState.isTerminalState,
  isClosedState: courseState.isClosedState,
  appendStateSuffix: courseState.appendStateSuffix,
  resolveStateSuffix: courseState.resolveStateSuffix,
  normalizeIncomingState: courseState.normalizeIncomingState,

  // 命名空间备用
  runtime,
  collections,
  request,
  errors,
  logger,
  http,
  security,
  courseState
};
