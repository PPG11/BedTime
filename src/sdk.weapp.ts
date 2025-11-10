import Taro from '@tarojs/taro'
import sr from 'sr-sdk-wxapp'
import { CLOUD_ENV_ID, CLOUD_SHOULD_ENABLE } from './config/cloud'
import { env } from './config/env'
import { ANALYTICS_DEBUG, ENABLE_ANALYTICS } from './config/featureFlags'

/**
  * 有数埋点SDK 默认配置
  * 使用方法请参考文档 https://mp.zhls.qq.com/youshu-docs/develop/sdk/Taro.html
  * 如对有数SDK埋点接入有任何疑问，请联系微信：sr_data_service
*/
if (ENABLE_ANALYTICS) {
  sr.init({
      /**
       * 有数 - ka‘接入测试用’ 分配的 app_id，对应的业务接口人负责
       */
      token: env.TARO_APP_ANALYTICS_TOKEN ?? 'bi6cdbda95ae2640ec',

      /**
       * 微信小程序appID，以wx开头
       */
      appid: env.TARO_APP_ANALYTICS_APPID ?? 'touristappid',

      /**
       * 如果使用了小程序插件，需要设置为 true
       */
      usePlugin: false,

      /**
       * 开启打印调试信息， 默认 false
       */
      debug: ANALYTICS_DEBUG,

      /**
       * 建议开启-开启自动代理 Page， 默认 false
       * sdk 负责上报页面的 browse 、leave、share 等事件
       * 可以使用 sr.page 代替 Page(sr.page(options))
       * 元素事件跟踪，需要配合 autoTrack: true
       */
      proxyPage: true,
      /**
       * 建议开启-开启组件自动代理， 默认 false
       * sdk 负责上报页面的 browse 、leave、share 等事件
       */
      proxyComponent: true,
      // 建议开启-是否开启页面分享链路自动跟踪
      openSdkShareDepth: true,
      // 建议开启-元素事件跟踪，自动上报元素事件，入tap、change、longpress、confirm
      autoTrack: true,
      installFrom: 'Taro@v3'
    })
} else if (process.env.NODE_ENV !== 'production') {
  console.info('已跳过有数埋点 SDK 初始化（ENABLE_ANALYTICS 未开启）')
}

const cloudInitErrorToast = (message: string, detail?: unknown) => {
  console.error(message, detail)
  try {
    Taro.showToast({ title: message, icon: 'none', duration: 2000 })
  } catch (toastError) {
    console.error('展示错误提示失败', toastError)
  }
}

const envId = CLOUD_ENV_ID.trim()

if (!CLOUD_SHOULD_ENABLE) {
  cloudInitErrorToast('未配置云开发环境，应用无法运行')
  throw new Error('CLOUD_ENV_ID 未配置')
}

if (!Taro.cloud) {
  cloudInitErrorToast('当前环境不支持微信云开发，应用无法运行')
  throw new Error('Taro.cloud 不可用')
}

try {
  Taro.cloud.init({
    traceUser: true,
    env: envId || undefined
  })
} catch (error) {
  cloudInitErrorToast('初始化微信云开发失败', error)
  throw error
}
