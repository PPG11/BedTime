# BedTime 仓库指南

BedTime 是「早睡助手」微信小程序。用户设置目标就寝时间，记录每晚打卡，也可以送出晚安心语。产品目标包含送出后收到其他人的心语。现有代码的抽取入口在打卡，迭代时以当前需求和代码为准。

## 从哪里开始

- [README](README.md) 提供项目入口和常用命令。
- [本地开发](docs/local-development.md) 说明 Node.js、Yarn、微信开发者工具和联调步骤。
- [云端部署](docs/cloud-deployment.md) 说明环境、部署预演和线上核对步骤。
- [云函数与数据库](cloudfunctions/README.md) 和 [打卡与好友数据流](docs/checkin-and-friends-backend.md) 记录后端契约。
- 做功能迭代或联调时，使用项目内的 [bedtime-development](.agents/skills/bedtime-development/SKILL.md) 工作流程。

## 代码入口

| 范围 | 入口 |
| --- | --- |
| 页面和样式 | `src/pages/{home,friends,profile}/`、`src/components/`、`src/app.config.ts` |
| 跨页状态和接口 | `src/state/appData.tsx`、`src/services/` |
| 打卡日期和时间 | `src/utils/checkin.ts`、`cloudfunctions/common/time.js` |
| 心语投稿和领取 | `src/pages/home/useGoodnight.ts`、`src/services/goodnight.ts`、`cloudfunctions/gn*/` |
| 云端数据和鉴权 | `cloudfunctions/<函数名>/index.js`、`cloudfunctions/common/`、`cloudfunctions/databaseProxy/` |
| 构建、环境和上传 | `config/`、`project.config.json`、`src/config/cloud.ts`、`cloudfunctions/deploy.js` |

## 修改和验证

- 使用 Node.js 22 和 Yarn Classic。依赖安装用 `yarn install --frozen-lockfile`，源码类型检查用 `yarn typecheck`，小程序构建用 `yarn build:weapp`。微信开发者工具导入仓库根目录，读取 `project.config.json` 中的 `dist/` 和 `cloudfunctions/`。
- 涉及接口或存储时，从页面追到服务层和云函数。保留已有响应契约及旧打卡文档的兼容路径，除非任务包含对应的迁移。核对正常流程、重复请求和部分失败后的结果。
- 云函数从微信上下文确认身份。新的云端读写应校验所属用户和允许的字段。涉及打卡日期时，核对同一晚跨午夜前后，以及目标时间在午夜后的情况。
- `TARO_APP_CLOUD_ENV_ID` 可同时指定前端构建和云函数部署预演的目标。对已配置环境执行真实上传、数据库写入或发布前，按当前请求核对环境、AppID 和变更范围。
- 报告时区分本地构建、模拟验证、微信端联调和实际部署。保持本地配置、凭据、`node_modules/`、`dist/` 和部署缓存留在版本控制之外。
