---
name: bedtime-development
description: 在 BedTime 仓库开发今晚关灯原生微信小程序，维护单夜记录、恢复、私有夜签、导出、偏好与 CloudBase 契约。
---

# 今晚关灯开发与验收

## 当前范围

先读根目录 AGENTS.md、docs/refactor-m1-delivery.md 和 docs/product-plan-tonight-lights-out-v1.1.md。M0、M1 第一段材料保留历史证据，不能用当时的未部署状态覆盖当前交付。当前五页 night / me / archive / receipt / about，唯一业务函数 bedtimeNight，六个动作和四集合。旧前端 / 业务已清理；四个旧领域入口仅返回 RETIRED，不做兼容或双写。

作者在 iPhone 体验和 Android 简测后已放行 M1：长按 800ms、暗屏 400ms、留白 800ms、出句 400ms；减少动效 800ms 黑色零过渡。常规字号、系统无衬线、正常动效；声音默认关闭，震动默认开启。250ms 是结束的原型模拟响应。演示标注、无记录 / 事件 / 震动，结束返回普通页；真实退出才调用退出 API。主流 iPhone / Android 竖屏优先，窄屏基本检查，极短屏不深入优化。

## 代码路径

- hold-button → HoldGesture → NightController → NightStore → nightApi → bedtimeNight → common/nights.js。
- 页面只协调交互 / 生命周期，data 只存可序列化视图；计时、音频、订阅、请求对象留在逻辑层。
- 共享状态负责身份、可见上下文、读取与写入代际隔离；冷启动鉴权前不显示私人历史。磁盘只存 v11 + userId 下的原夜恢复标记，不缓存整份历史。
- 北京时间 20:00—06:00，正午翻夜。closeLight 非事务读空必须进事务再读原记录；已有记录优先于窗口，确需新建才判时，每次重试重新取时。发布稿 / 记录 / 摘要同事务。
- SDK userInfo / tcbContext 仅为保留传输字段，身份只能取 getWXContext().OPENID。明确事务冲突用 night-transaction 有限退避，不能重试所有 -501001 或把未知提交当失败。
- 只有前台原交互的 created:true 播放仪式。超时核对、后台恢复、重进均显示普通回执；8 秒不取消事务，核对原 nightId，不能覆盖新夜。关窗后成功查空按返回服务端时间解除标记，查询失败保留；迟到记录仍走普通历史恢复。
- 偏好写入超过 8 秒只提示未确认，保留串行队列，不能用超时释放在途写。保存失败后立即触发的回读保留错误，后续成功刷新（含重新进入页面）清除，不自动重试失败修改。
- 归档每页 30 条，nightId 游标，私人字段投影。Canvas 1080×1440 导出只含原句 / 日期 / 品牌；隐私与相册授权均由主动保存触发，拒绝保留预览；取消单独说明，不误报为权限拒绝。
- 事件只含白名单枚举 / 布尔值，内存队列有界且不阻塞业务。后台人数和 3/7 用真实记录与摘要。私有导出、OPENID 和清单必须在仓库外。

## 验证

1. Node 22、Yarn Classic；整体改动运行 yarn verify，上传前 yarn build:release。不要为低影响格式改动堆重复测试。
2. 后端覆盖日期边界、并发唯一、冻结句、未知回执、事务冲突和部分失败、归属、分页、事件去重与预算。客户端覆盖身份切换 / 跨夜 / 后台晚到、偏好队列与保存失败。
3. 页面必须在模拟器打开实际检查，含长句、有数据 / 空列表、图片失败。原生 v2 按钮显式宽度 / 外边距 / border-box，断点用 px。首页禁止滚动，原生 Tab 已占底部安全区；其它页面允许自然滚动。
4. tests/fixtures/night-simulator.js 仅为当前运行时注入内存服务，同时替换事件发送；不进入产品包。完成后重新编译恢复真实云绑定。样例排版不算真实落库。
5. tests/cloud/night-acceptance.cjs 和 scripts/night-cloud-qa.mjs 仅用于限时隔离云验收；独立身份、受控时钟、夜句前缀。结束清理并回读、停用临时函数，不把测试日期当真机夜间使用。
6. 明确区分类型 / 测试 / 构建、微信模板编译、模拟器、真实云库、两个微信账号、真机和公开发布。部署 Active 不替代真实接口调用。

## 云端与交付

作者已授权本地与云端完整开发 / 部署 / 权限 / 索引 / 必要联调，后续同范围 MCP 不逐项重新问；先前 read 是 ready 的误解。复用已确认 AppID wxd489f0523662b0ea 和环境 cloudbase-d0gcfmrvdb974536e。正式公开发布由作者操作。保留平台确认流程，不改全局安全开关。

构建和部署共用 scripts/cloud-env.cjs，终端 CLOUD_ENV_ID 优先 .env.local；无默认环境，离线须显式 ENABLE_CLOUD=false，禁止离线发布。先 yarn cloud:preview bedtimeNight，再 yarn cloud:prepare bedtimeNight；准备只打包不上传，缺依赖停止。共享代码修改后检查部署包和来源，不能上传过时 node_modules。

数据维护见 docs/night-operations.md：导出 / 报告只读，维护默认预演、执行明确环境与清单；pending 保存原 taskId，回执不明先核对。本人删除核验身份、暂停使用，只处理本人三集合并最终回读，不删除公共夜句。每周事件清理是项目所有者人工职责，不冒称已有自动任务。

同步 README、架构、契约、部署和交付记录；阶段变化更新本文件。尊重用户暂存文件及无关工作区内容，未要求不提交、推送或公开发布。正式版通用码在首次公开发布后补入，首发采用规格规定的无码模板。
