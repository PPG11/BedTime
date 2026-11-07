# BedTime · 早睡助手

微信原生小程序，使用 **TypeScript + WXML + WXSS**，后端沿用微信云开发 **CloudBase**。用户可以设置就寝目标、记录每晚打卡、查看好友状态和送出晚安心语。

当前心语投稿与打卡奖励分开：投稿后显示已分享，打卡时尝试抽取其他用户的心语。「送出一条后收到一条」是待实现的产品需求，不能从现有投稿流程推断已经支持。

## 开始开发

使用 Node.js 22 和 Yarn Classic 1.22.22，在仓库根目录运行：

```sh
yarn install --frozen-lockfile
# 首次创建本地配置；已有文件不要覆盖
cp -n .env.example .env.local
```

在 `.env.local` 填入与小程序关联的 `CLOUD_ENV_ID`，然后运行：

```sh
yarn verify
yarn dev:weapp
```

用微信开发者工具导入**仓库根目录**。`project.config.json` 指向小程序产物 `dist/` 和云函数 `cloudfunctions/`。日常修改 `miniprogram/`，构建脚本编译 TypeScript 并复制原生模板、样式和资源，不要直接编辑 `dist/`。前端没有运行时 npm 依赖，无需在开发者工具中额外构建 npm。

构建和云函数部署共用 `.env.local`，终端环境变量优先，可临时切换测试环境：

```sh
CLOUD_ENV_ID=your-test-env-id yarn dev:weapp
```

缺少云环境会使构建失败；离线预览需显式设置 `ENABLE_CLOUD=false`。`.env.local` 不入库。云端联调需要已关联的 AppID、已部署函数和相应集合。本地构建不会上传小程序、部署函数或修改云数据库。[本地开发指南](docs/local-development.md) · [云环境与部署](docs/cloud-deployment.md)

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `yarn typecheck` | 检查前端 TypeScript |
| `yarn test` | 运行本地自动化验证 |
| `yarn build:weapp` | 构建原生小程序到 `dist/` |
| `yarn build:release` | 构建发布产物，要求启用云开发并配置环境 |
| `yarn dev:weapp` | 监听源码并重新构建 |
| `yarn verify` | 依次执行类型检查、测试和构建 |
| `yarn cloud:preview <函数名>` | 只在本地预演云函数上传范围 |
| `yarn cloud:prepare <函数名>` | 准备当前云函数依赖，供开发者工具上传；不上传、不改部署缓存 |

## 代码与维护入口

| 路径 | 职责 |
| --- | --- |
| `miniprogram/app.*`、`miniprogram/pages/` | 原生应用入口、三个 Tab 页面及页面交互 |
| `miniprogram/state/` | 用户、作息和打卡记录的共享状态与订阅 |
| `miniprogram/services/` | CloudBase 业务调用与响应转换 |
| `miniprogram/utils/`、`miniprogram/types/` | 日期与统计规则、存储、分享和业务类型 |
| `miniprogram/config/`、`scripts/` | 云环境、构建与本地验证工具 |
| `cloudfunctions/` | 云函数、共享包 `common` 和部署脚本 |

- [架构说明](docs/architecture.md)：模块边界、原生生命周期和状态管理。
- [今晚关灯 v1.1 产品与施工架构](docs/product-plan-tonight-lights-out-v1.1.md)：后续重建的完整规格与验收标准，尚未实现；现有业务仍以当前架构和接口文档为准。
- [AGENTS.md](AGENTS.md)：后续开发的定位和验证约定。
- [打卡、心语与好友链路](docs/checkin-and-friends-backend.md)：当前业务行为和已知边界。
- [云函数与数据库](cloudfunctions/README.md)：函数入参、响应和集合。
- [原生迁移说明](docs/migration-native.md)：迁移范围、功能对应和微信端核验清单。

## 许可

本项目仅供学习与内部交流使用，如需商用请联系项目所有者。
