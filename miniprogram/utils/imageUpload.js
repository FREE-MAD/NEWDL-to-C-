// 新增图片上传压缩工具：资料图、头像图上传前统一尽量压小，减少命中微信安全接口图片体积上限
function statLocalFile(filePath = '') {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().stat({
      path: filePath,
      success: (res) => resolve(res || {}),
      fail: reject
    })
  })
}

// 新增本地文件大小读取：压缩前后统一读取字节数，便于决定是否继续压缩
async function getLocalFileSize(filePath = '') {
  if (!filePath) {
    return 0
  }

  try {
    const statRes = await statLocalFile(filePath)
    return Number(statRes && statRes.stats && statRes.stats.size) || Number(statRes && statRes.size) || 0
  } catch (error) {
    return 0
  }
}

// 新增图片压缩 Promise 封装：让页面层能直接 await，减少回调嵌套
function compressImage(filePath = '', quality = 80) {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src: filePath,
      quality,
      success: (res) => resolve(res || {}),
      fail: reject
    })
  })
}

// 新增上传前压缩：按多档质量逐步压缩，优先拿到当前能得到的最小图片再上传
async function prepareImageForUpload(filePath = '', options = {}) {
  const qualityList = Array.isArray(options.qualityList) && options.qualityList.length
    ? options.qualityList
    : [60, 40, 20, 10]
  const maxBytes = Number(options.maxBytes) || 600 * 1024

  const originalSize = await getLocalFileSize(filePath)
  let bestPath = filePath
  let bestSize = originalSize
  let qualityUsed = 100

  // 新增小图直传：原图已经足够小就不再额外压缩，避免无意义损耗
  if (originalSize > 0 && originalSize <= maxBytes) {
    return {
      filePath,
      originalSize,
      finalSize: originalSize,
      compressed: false,
      qualityUsed
    }
  }

  let currentPath = filePath
  for (let index = 0; index < qualityList.length; index += 1) {
    const quality = Number(qualityList[index]) || 10
    try {
      const compressRes = await compressImage(currentPath, quality)
      const compressedPath = String((compressRes && compressRes.tempFilePath) || '').trim()
      if (!compressedPath) {
        continue
      }

      const compressedSize = await getLocalFileSize(compressedPath)
      if (!compressedSize) {
        continue
      }

      if (!bestSize || compressedSize < bestSize) {
        bestPath = compressedPath
        bestSize = compressedSize
        qualityUsed = quality
      }

      currentPath = compressedPath
    } catch (error) {
      // 保留兜底：单次压缩失败不阻断上传，继续尝试下一档或退回当前最佳结果
    }
  }

  return {
    filePath: bestPath || filePath,
    originalSize,
    finalSize: bestSize || originalSize,
    compressed: !!bestPath && bestPath !== filePath,
    qualityUsed
  }
}

module.exports = {
  getLocalFileSize,
  prepareImageForUpload
}
