---
name: bedtime-development
description: 在 BedTime 仓库开发今晚关灯原生微信小程序，维护单夜记录、恢复、私有夜签、导出、偏好与 CloudBase 契约。
---

# 今晚关灯开发与验收

## M2 增量（2026-11-10）

作者已要求完成公共灯迹、公开句子卡、渠道归因与管理员看板，具体以 docs/m2-development.md 为准。新增四页 lights/public-card/dashboard/channels 与独立 bedtimeGrowth；新增 n_cards/n_card_keys/n_attributions/n_channels，八集合客户端禁止直读写。M1 和提醒契约继续有效，M2 不加入关灯事务或沉浸完成态。

公共灯迹仅最近七个已经结束的夜晚，06:05 后可看；不足三人不公开人数或分布，相邻桶合并后每桶至少三人。公开卡主动创建、随机ID、同人同夜唯一、30天到期；撤销不复活，原私人记录删除后立即失效。来源固定第一次到达，24小时内首次关灯归因；不追踪分享者关系。管理员只取服务端哈希白名单，部署私有JSON和排除名单不入库，默认不授予任何账号权限。汇总扫描有固定上界和完整性校验，超限失败不返回部分统计。

页面夹具在 night-simulator.js 后注入 growth-simulator.js；完成后编译恢复真实云绑定。限时 tests/cloud/growth-acceptance.cjs 使用独立 namespace 与 1980 受控时间；scripts/night-growth-cloud-qa.mjs --prepare 只在仓库外生成受控包和权限 600 的会话，上传后按同一 session 依次 run、cleanup、retire。失败也清理，明确回读为空才可停用；pending 查询原任务，最终实际调用返回 RETIRED。运行完整 verify/release、准备 bedtimeGrowth 依赖，核对共享 common 与源码；云端验收和模拟器、真机、发布分开记录。

管理员配置必须来自已核对的微信账号，原 OPENID 只在仓库外计算 SHA-256，不输出到日志或提交。服务端 NIGHT_ADMIN_OPENID_HASHES / NIGHT_ANALYTICS_EXCLUDE_HASHES 为 JSON 哈希数组；未设环境变量时可用 bedtimeGrowth/private-config.json 的 adminHashes / excludeHashes。环境变量逐字段优先，显式 [] 也覆盖私有文件；坏管理员配置拒绝全部管理权限，坏排除名单拒绝看板，不能忽略后继续计算。准备依赖后从仓库外权限 600 的原件复制部署副本并保持 600；副本由 .gitignore 排除，准备依赖不自动生成授权。每次重新部署核对当前授权和文件，缺失不能假定上一云版本会保留。完整步骤见 docs/cloud-deployment.md。

归因窗口为 [arrivedAt, arrivedAt + 24 小时)，首次未知来源也不能后补；分享渠道 share 为内置保留标识，不包含分享者。看板 from/to 使用正午翻夜的公共 nightId，最多 31 夜；用户、夜签和首访各最多完整扫描 10,000 条，渠道最多 1,000 条。原始数据不发客户端，首末摘要不一致、读取中数据变化或扫描超限时返回错误。该读取重算不是跨集合数据库快照；不以部分结果解释指标。

个人删除现在必须重新导出 --all --growth 的六集合范围并生成 version 2 计划；原 version 1 三集合计划不得手改扩大授权。公共n_phrases与n_channels不随个人删除。

## 当前范围

先读根目录 AGENTS.md、docs/refactor-m1-delivery.md、docs/product-plan.md 和 docs/m2-development.md。M0、M1 第一段材料保留历史证据，不能用当时的未部署状态覆盖当前交付。M1 原有五页 night / me / archive / receipt / about；订阅提醒增加 reminder 页，bedtimeNight 增至九个动作，另有仅定时调用的 bedtimeReminderDispatch。M1 与提醒使用原四集合，M2 新增四集合后当前共八集合。提醒规格与实测状态见 docs/reminder-development.md。旧前端 / 业务已清理；四个旧领域入口仅返回 RETIRED，不做兼容或双写。

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
- 提醒只在用户点击后直接请求一次微信订阅；accept 后保存明确日期和时间。单用户只保留最新预约，requestId / revision 保证取消和重试幂等；未知写入先回读，不自动换日期或重新请求授权。定时任务先事务领取，再调用微信；领取或发送回执不明不重发，同夜最多一次尝试。发送入口必须无 OPENID，且平台环境为 TRIGGER_SRC=timer，或 TCB_SOURCE=wx_trigger 并存在 WX_TRIGGER_API_TOKEN_V0；微信工具定时器在本环境不使用通用 timer 值。客户端 event / tcbContext 不能提供这些信任条件，日志不能输出定时票据。
- 作者明确要求当晚快速测试时，可使用仓库外权限 600 的部署专用 quickTest（账号摘要 + 半小时截止时间）；只跳过本人当前夜的已关灯检查，仍由本人主动授权、同夜最多一次尝试。服务端标记 testMode，发送前再次检查许可；到期 / 撤销即跳过。测试消息明确标注并打开 developer，普通预约继续 formal；不得改写真实关灯记录。详情与本次失效时间见 docs/reminder-development.md。
- 事件只含白名单枚举 / 布尔值，内存队列有界且不阻塞业务。后台人数和 3/7 用真实记录与摘要。私有导出、OPENID 和清单必须在仓库外。

## 验证

1. Node 22、Yarn Classic；整体改动运行 yarn verify，上传前 yarn build:release。不要为低影响格式改动堆重复测试。
2. 后端覆盖日期边界、并发唯一、冻结句、未知回执、事务冲突和部分失败、归属、分页、事件去重与预算。客户端覆盖身份切换 / 跨夜 / 后台晚到、偏好队列与保存失败。
3. 页面必须在模拟器打开实际检查，含长句、有数据 / 空列表、图片失败。原生 v2 按钮显式宽度 / 外边距 / border-box，断点用 px。首页禁止滚动，原生 Tab 已占底部安全区；其它页面允许自然滚动。
4. 提醒页的 tests/fixtures/reminder-simulator.js 必须在 night-simulator.js 后注入，隔离微信订阅 / 云调用；验证拒绝、取消、结果不明和日期，再重新编译恢复真实绑定。tests/fixtures/night-simulator.js 仅为当前运行时注入内存服务，同时替换事件发送；不进入产品包。完成后重新编译恢复真实云绑定。样例排版不算真实落库。
5. tests/cloud/night-acceptance.cjs 和 scripts/night-cloud-qa.mjs 仅用于限时隔离云验收；独立身份、受控时钟、夜句前缀。结束清理并回读、停用临时函数，不把测试日期当真机夜间使用。
6. 明确区分类型 / 测试 / 构建、微信模板编译、模拟器、真实云库、两个微信账号、真机和公开发布。部署 Active 不替代真实接口调用。

## 云端与交付

作者已授权本地与云端完整开发 / 部署 / 权限 / 索引 / 必要联调，后续同范围 MCP 不逐项重新问；先前 read 是 ready 的误解。复用已确认 AppID wxd489f0523662b0ea 和环境 cloudbase-d0gcfmrvdb974536e。正式公开发布由作者操作。保留平台确认流程，不改全局安全开关。

构建和部署共用 scripts/cloud-env.cjs，终端 CLOUD_ENV_ID 优先 .env.local；无默认环境，离线须显式 ENABLE_CLOUD=false，禁止离线发布。提醒增量先 yarn cloud:preview bedtimeNight bedtimeReminderDispatch，再 yarn cloud:prepare bedtimeNight bedtimeReminderDispatch；准备只打包不上传，缺依赖停止。共享代码修改后检查部署包和来源，不能上传过时 node_modules。提醒先关闭开关部署，回读 n_users 复合索引，并单独上传权限和每分钟触发器；核对实际定时日志后启用。cloud_fn_deploy 成功不代表触发器生效。隔离云验收增加 remindersSchedule / remindersDispatch，发送替身不算真机收信。

数据维护见 docs/night-operations.md：导出 / 报告只读，维护默认预演、执行明确环境与清单；pending 保存原 taskId，回执不明先核对。本人删除核验身份、取消待发提醒、暂停使用并等待业务 / 发送在途结束，当前使用 version 2 清单处理本人 n_users / n_nights / n_events / n_cards / n_card_keys / n_attributions 六集合并逐一回读；不删除 n_phrases 或 n_channels。旧 version 1 清单仅允许原三集合，不手改版本扩大授权。每周事件清理是项目所有者人工职责，不冒称已有自动任务。

同步 README、架构、契约、部署和交付记录；阶段变化更新本文件。尊重用户暂存文件及无关工作区内容，未要求不提交、推送或公开发布。正式版通用码在首次公开发布后补入，首发采用规格规定的无码模板。
