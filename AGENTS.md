# BedTime 仓库指南

BedTime 是「早睡助手」微信小程序，采用原生 **TypeScript + WXML + WXSS + CloudBase**。首页打卡时领取心语；投稿成功只更新投稿状态。「送出后收到」仍需独立产品实现。

## 从哪里开始

- [README](README.md) 提供命令与目录入口；[架构说明](docs/architecture.md) 定义模块边界。
- [本地开发](docs/local-development.md) 说明构建与微信开发者工具；[云端部署](docs/cloud-deployment.md) 说明环境、部署预演和线上核对。
- 涉及业务时读[业务链路](docs/checkin-and-friends-backend.md)与[云函数契约](cloudfunctions/README.md)的相关部分。
- 功能迭代或联调使用项目内 [bedtime-development](.agents/skills/bedtime-development/SKILL.md) 工作流程。

## 代码入口

| 范围 | 入口 |
| --- | --- |
| 页面、路由与样式 | `miniprogram/pages/{home,friends,profile}/`、`miniprogram/app.json`、`miniprogram/app.wxss` |
| 跨页状态 | `miniprogram/state/app-data.ts`（绑定依赖）、`create-app-store.ts`（状态实现） |
| 云调用与返回值 | `miniprogram/services/`；`cloud.ts` 连接微信并统一处理业务调用 |
| 打卡周期与统计 | `miniprogram/utils/checkin.ts`、`cloudfunctions/common/time.js` |
| 心语投稿与奖励 | `miniprogram/pages/home/`、`miniprogram/services/goodnight.ts`、`cloudfunctions/bedtimeGoodnight/` |
| 云端数据和鉴权 | `cloudfunctions/<函数名>/index.js`、`cloudfunctions/common/` |
| 构建、环境与上传 | `scripts/build.mjs`、`scripts/cloud-env.cjs`、`project.config.json`、`cloudfunctions/deploy.js` |

## 开发约定

- 前端写原生 `App` / `Page` / `Component` 和 TypeScript；WXML 只绑定展示数据与事件，复杂计算放在 TypeScript。页面 `data` 只存可序列化的视图字段，订阅句柄、定时器和业务对象留在逻辑层。
- 页面负责交互与生命周期，服务层负责业务调用与响应转换，共享状态负责跨页同步，纯工具负责规则。页面卸载时取消订阅，隐藏时停止页面定时器，防止旧异步响应覆盖新用户或新打卡周期。
- 原生布局需显式处理 `style: "v2"` 的按钮默认宽度 / 外边距，统一控件盒模型；窄屏断点使用 `px`。具体做法见[原生布局检查](docs/local-development.md#原生布局检查)。
- 修改 `miniprogram/` 源码，`dist/` 由构建生成。前端不依赖 Taro、React 或 H5 入口；新增运行时依赖前先明确小程序打包方式。
- 云函数仍为 Node.js / CommonJS。涉及接口或存储时，从页面追到服务与云函数，核对业务契约、归属校验和事务边界。打卡只使用每日文档。
- 云端从微信上下文确认身份。新的读写需校验所属用户和允许字段；客户端传入的 UID、日期与状态不能替代服务端授权。

## 验证与交付

- 使用 Node.js 22、Yarn Classic；依赖安装 `yarn install --frozen-lockfile`。完成改动后执行相关检查，整体交付使用 `yarn verify`（类型检查、测试、构建）。
- 微信开发者工具导入仓库根目录，读取 `dist/` 与 `cloudfunctions/`。页面改动必须实际打开模拟器检查受影响页面及窄屏布局；仅通过 WXML/WXSS 编译不能视为界面验证通过，模拟器也不能替代真机与云端联调。
- 接口与持久化检查正常流程、重复请求、超时重试和部分失败。日期规则覆盖 22:30 与 00:30 目标、同一晚跨午夜、窗口开启和关闭；提交、首页恢复、统计和心语需使用一致周期日期。
- 统计中只有 `hit` 延续连续记录，`late` 仍计入累计；当前连续与累计使用服务端摘要，近期最佳仅覆盖已加载的最近 365 次打卡记录。变更时覆盖断签、周期切换及重复请求，详见[业务链路](docs/checkin-and-friends-backend.md)。
- 构建与部署共用 `scripts/cloud-env.cjs`，优先读取终端的 `CLOUD_ENV_ID`，再读取 `.env.local`。缺少环境时构建失败；离线预览需显式 `ENABLE_CLOUD=false`。小程序上传前执行拒绝离线配置的 `yarn build:release`；云函数使用部署脚本打包 `common` 和依赖。真实上传、数据库写入或发布前，按当前授权核对环境、AppID 和变更范围。
- 报告区分本地构建、模拟测试、微信模板编译、模拟器运行、真机联调和实际部署。代码变更同步更新对应文档；流程发生实质变化时更新开发 skill。本地私有配置、凭据、`node_modules/`、`dist/` 和部署缓存不入库；团队共用的项目与构建配置正常维护在版本控制中。
