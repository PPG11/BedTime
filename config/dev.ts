import type { UserConfigExport } from "@tarojs/cli";
export default {
   logger: {
    quiet: false,
    stats: true
  },
  mini: {
    webpackChain(chain) {
      // 禁用 webpack 在输出文件中生成的模块路径注释
      // 这些注释会导致微信小程序真机调试时 wxss 编译错误
      chain.output.pathinfo(false)
    }
  },
  h5: {}
} satisfies UserConfigExport<'webpack5'>
