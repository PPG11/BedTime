# 今晚关灯架构

M1 基线是原生微信小程序：今晚 / 我的两个 Tab，归档、回执详情和关于三个普通页面，业务动作由 `bedtimeNight` 承担。实现和实际验收的区别见 [交付记录](refactor-m1-delivery.md)。

后续新增独立的「关灯提醒」普通页面及 `bedtimeNight` 的三个提醒动作；`bedtimeReminderDispatch` 仅负责定时发送。具体契约、启用状态与验收见[提醒增量](reminder-development.md)。

M2 使用独立 `bedtimeGrowth`：`night-public` 负责匿名灯迹和公开卡，`night-growth-analytics` 负责首访渠道与管理员聚合，`night-growth-query` 负责有上界的完整扫描。新增 `n_cards / n_card_keys / n_attributions / n_channels` 四个私有集合。管理员白名单仅存在服务端；公开卡只返回安全投影，原私人记录仍不可公开读取。范围与数据规则见 [M2 补充规格](m2-development.md)。

```text
hold-button → HoldGesture → NightController → Ceremony / Navigation / Sound
                                   ↓
                              NightStore → nightApi → bedtimeNight
                                   ↓                       ↓
                     身份隔离的恢复标记          n_users / n_nights / n_phrases

NightEvents → 内存有界队列 → track → n_events
Receipt → Canvas 2D → 本地预览 → 主动授权保存相册
管理员 → 私有导出 → 只读报告 / 维护预演 → 明确范围执行 → 回读验证
```

## 模块边界

| 模块 | 职责 |
| --- | --- |
| `pages/night/night-controller.ts` | 手势后的交互、未知结果核对、前后台恢复、播放许可；演示独立分支 |
| `pages/night/night-view-model.ts` | 业务快照映射为 WXML 展示字段 |
| `pages/night/ceremony.ts` | 本机播放时钟；不拿服务端写入时间推算动画进度 |
| `state/create-night-store.ts` | 鉴权快照、单次显示并发合并、内存记录、原夜恢复、串行偏好 |
| `state/night-store.ts` | 真实服务与存储绑定；持久化键为 v11 + userId |
| `state/night-events.ts` | 内存最多 20 条；每批 10 条；一次前台重试；隐藏尽力发送一次 |
| `services/night.ts` | 六个业务动作的请求与严格响应校验；读 / 提交 8 秒未知阈值 |
| `utils/night-card.ts` | 1080×1440 本地 Canvas 导出；只使用已确认原句与夜晚日期 |
| `common/nights.js` | OPENID 内部归属、用户 / 夜签 / 偏好 / 分页事务 |
| `common/night-transaction.js` | 明确事务冲突最多 4 次外层尝试，指数退避；普通错误与未知提交不盲重发 |
| `common/night-events.js` | 白名单、去重、每人每夜 100 条预算，全部在事务内判定 |
| `pages/reminder/`、`services/reminder.ts` | 主动订阅、本人预约和取消；保存未知结果回读 / 同操作重试，身份与生命周期隔离 |
| `common/night-reminders.js` | n_users 内单条预约、版本比较、一次领取与不重发规则 |
| `bedtimeReminderDispatch` | 平台定时来源校验，领取后调用微信，六秒未知态；消息调用不进入事务 |

## 时间与成功条件

北京时间 20:00—次日 06:00，左闭右开；正午切换 nightId。关灯的非事务读只有“读到记录”能短路；读空必须在事务中再次检查原记录，只有确需新建才判断夜晚与窗口。每次重试重新取服务端时间。发布句、私人记录和首末夜摘要一起提交。

SDK 会注入 `userInfo` 和 `tcbContext`，只把它们作为保留的传输字段接受，不用于身份。身份只来自 `getWXContext().OPENID`。M1 原四集合与 M2 新四集合的客户端权限均为 false / false。云端并发冲突可能被 SDK 包装成 -501001；只匹配明确的冲突标识重试，不能把所有资源错误当成冲突。

只有本次新建且仍属于前台原交互，才播放成功声音 / 震动和仪式。已有记录、超时核对、后台返回不补播。提交超过 8 秒不能认定失败；查询原 nightId，查到原记录才解除未知。已有原夜记录在关窗或跨夜后仍返回原时间、方式和句子。

## 生命周期与隐私

Page data 仅包含可序列化视图。隐藏时停止手势、定时器和声音，恢复原生 Tab；卸载取消订阅。身份、可见上下文、请求与写入代际阻止旧响应覆盖新状态。冷启动在线鉴权前不展示私人缓存；不持久保存完整历史。

归档只列实际记录，默认每页 30 条，以最后一条 nightId 作游标。详情重新鉴权后读取本人记录。预览图片只在同一用户、同一夜晚的页面内存中保留；保存前检查微信隐私授权，再由用户主动授权相册。拒绝或取消不影响记录与预览。

演示不提交、不上报、不震动。观测只含固定枚举 / 布尔属性和接收日，不带原句、昵称、分享对象或客户端精确动作时间。真实记录才是人数与回访的统计来源。

## 构建与停用

`scripts/build.mjs` 编译 TypeScript 并复制资源到 `dist/`；构建锁避免监听和手动构建互相删除产物。构建和云部署共用 `scripts/cloud-env.cjs`。本地测试、模板编译、模拟器、实际云端与真机验收分别记录。

旧前端、旧领域服务和旧业务规则已移除。`bedtimeUser / bedtimeCheckin / bedtimeFriends / bedtimeGoodnight` 保留最小停用入口，不引入 SDK 或数据库访问。旧数据库不迁移，不在本轮删除。

2026-11-08 评审修复：关窗后成功查空按服务端时间解除恢复标记，迟到记录仍从正常回执 / 归档恢复。偏好超过 8 秒只改变等待提示，不释放写队列；保存失败后立即触发的回读保留说明，后续成功刷新（含重新进入页面）清除说明，不自动重试失败的修改。移除只写不读的本地偏好副本。保存取消不算权限拒绝，也不记录保存失败事件。
