# BedTime

BedTime「早睡助手」是一款微信小程序。用户可以设置目标就寝时间、记录每日打卡、查看好友的早睡状态，以及送出晚安心语。

当前版本把心语投稿和打卡奖励分开处理。投稿成功后显示「今日已分享」，打卡时尝试抽取一条其他用户的心语。产品设想中的「送出后收到一条」还没有接入投稿流程。

## 本地开发

在仓库根目录使用 Node.js 22 和 Yarn Classic 1.22.22 安装依赖，再用项目内的 Taro CLI 构建。

```sh
yarn install --frozen-lockfile
yarn typecheck
yarn build:weapp
# 日常开发可改用监听模式
yarn dev:weapp
```

用微信开发者工具导入**仓库根目录**。`project.config.json` 会从 `dist/` 读取小程序产物，并识别 `cloudfunctions/` 中的云函数。打卡、心语和好友功能依赖已关联并部署的微信云开发环境。H5 构建脚本保留用于界面检查，业务数据加载依赖微信小程序运行时。 [本地开发指南](docs/local-development.md)

## 项目结构

| 目录 | 用途 |
| --- | --- |
| `src/pages/`、`src/components/` | 「打卡」「好友」「我的」页面及 UI 组件 |
| `src/state/` | 用户、作息设置和打卡记录的共享状态 |
| `src/services/`、`src/utils/` | 云端调用、返回值转换、日期与统计工具 |
| `src/config/`、`config/` | 应用云环境和 Taro 构建配置 |
| `cloudfunctions/` | Node.js 云函数、共享包 `common` 和部署脚本 |
| `docs/` | 开发、部署和业务链路说明 |

## 维护入口

- [AGENTS.md](AGENTS.md) 记录后续代码迭代的入口和验证要求。
- [本地开发指南](docs/local-development.md) 说明工具链、微信开发者工具和本地检查。
- [云开发与部署](docs/cloud-deployment.md) 说明云环境、依赖打包和上线核验。
- [业务链路](docs/checkin-and-friends-backend.md) 说明打卡、晚安心语和好友功能的实现与已知边界。
- [云函数与数据库](cloudfunctions/README.md) 汇总数据库集合、云函数入参和返回值。

## 许可

本项目仅供学习与内部交流使用，如需商用请联系项目所有者。
