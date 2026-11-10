# 今晚关灯云函数契约

核心业务函数为 `bedtimeNight`，M2 独立使用 `bedtimeGrowth`。请求为 `{ action, ...fields }`，成功 `{ code: 'OK', data }`，失败 `{ code, message, data? }`；成功 data 均含 `serverNow`。运行配置与已部署证据见 [云部署](../docs/cloud-deployment.md)。

## M1 核心动作与提醒增量

以下六个为 M1 核心动作。后续一次性提醒新增 getReminder / scheduleReminder / cancelReminder，详见[提醒契约](../docs/reminder-development.md#接口与存储)。getState 另返回 reminderAvailable：配置开放或本人已有有效预约时保留管理入口，不代表允许新建；停用 / 配置不可用时已有预约仍可查询、待发预约仍可取消，提醒响应 enabled=false。无预约且未开放时隐藏入口。原有动作的语义保持不变。

| action | 参数 | 返回字段（另含 serverNow） |
| --- | --- | --- |
| getState | 无 | userId、nightId、phase、窗口起止 / 下次开启、本夜 / 最近记录、prefs、首末 nightId、reminderAvailable |
| closeLight | clientNightId、method: hold / tap | record、created、isFirstEver |
| getNight | nightId | record 或 null；未来日期拒绝 |
| getArchive | cursor?、limit?（1—30，默认 30） | items、nextCursor；按本人 nightId 倒序，多取一条判断续页 |
| setPrefs | prefs 部分字段 | 合并后的完整 sound / haptics / reduceMotion |
| track | events（1—10 条） | acceptedIds、duplicateIds |

所有身份只取微信上下文 OPENID，不接受客户端 uid。允许微信实际注入的 userInfo / tcbContext 传输字段，但不从中鉴权；其它额外字段拒绝。总请求不超过 16KiB，事件属性不超过 256B，日期须是有效公历 YYYYMMDD。

私人记录投影只有 nightId、confirmedAt、method、phraseId、phraseText、phraseVersion。客户端拿不到内部用户、事件或发布稿文档。

## 存储与一致性

| 集合 | 文档 ID | 用途 |
| --- | --- | --- |
| n_users | OPENID | 偏好、首末夜、当夜事件预算、最近一次提醒与最近尝试发送夜晚 |
| n_nights | uid_nightId | 不可变的个人单夜记录与句子快照 |
| n_phrases | nightId | 首次提交冻结的公共当夜稿 |
| n_events | uid_eventId | 接收夜 / 北京日历日和固定枚举属性 |

`closeLight` 先读原记录；非事务读空后进入事务再读，已有记录优先于窗口 / 跨夜判断。确需新建才取当前服务端时间；冻结稿、私人记录和摘要同事务提交。异常后只有真实读到原记录才能恢复为 created:false。客户端 8 秒等待上限不取消事务。

`night-transaction.js` 处理实际 SDK 包装的明确事务冲突，最多 4 次外层尝试，40 / 80 / 160ms 加抖动退避。每次执行完整事务并重新读取，不重试普通资源故障、超时或未知提交。

客户端对 M1 原四集合与 M2 新四集合均不可直读 / 直写，见 [规则文件](night-database-rules.json)；规则须在云控制台应用，函数部署不会自动设置。索引见 [索引文件](night-database-indexes.json)：原有关灯、事件、提醒索引之外，M2 增加 n_nights 的 nightId ASC + _id ASC，以及 n_cards / n_card_keys 的 uid ASC。

## 事件与维护

提醒增加 n_users 的 reminder.status ASC + reminder.dueAt ASC 索引，不开放集合权限。独立函数 bedtimeReminderDispatch 只接受可信平台定时来源且无小程序身份的调用，兼容 SCF timer 与持有平台定时票据的微信 wx_trigger；权限只有 subscribeMessage.send。配置、每分钟触发器及回退见[增量部署流程](../docs/reminder-development.md#启用与回退)。不能将客户端 event.Type 或 tcbContext 当成可信触发来源。

仅接收 night_view、ceremony_start、ceremony_done_view、exit_tap、receipt_view、card_export_result，具体属性白名单见 common/night-events.js。按 uid + eventId 去重，单人每夜最多 100 条新事件；超过额度整批拒绝，重复事件不消耗新额度。业务记录不依赖事件成功。

30 句固定轮换，锚点 20261107，版本 1。历史句子不回算；池更新须增加未来生效版本，不修改冻结文档。来源与审阅见 [内容记录](../docs/night-content-review.md)。

导出、3/7 汇总、30 天事件清理与本人删除见 [维护指南](../docs/night-operations.md)。M1 没有定时统计云函数、公开记录或分享归因。

## M2 扩展

`bedtimeGrowth` 提供 getLights、getOwnedCard、createPublicCard、getPublicCard、revokePublicCard、captureEntry、getGrowthAccess、getChannels、saveChannel、getDashboard。完整输入与语义见 [M2 契约](../docs/m2-development.md#接口与数据)。不把私人记录读取接口改为公开接口，不在 closeLight 中追加统计、分享或来源写入。

`n_cards / n_card_keys` 同事务创建唯一公开卡；`n_attributions/{uid}` 首次写入后来源冻结；`n_channels/{code}` 仅管理员修改。八集合客户端均禁读写。管理权来自服务端 SHA-256 白名单，默认无人获权；配置异常不能退化为允许所有人。部署专用 `bedtimeGrowth/private-config.json` 不入库，环境变量优先。看板不返回逐人数据，扫描不完整拒绝返回部分统计。

## 已停用入口

bedtimeUser、bedtimeCheckin、bedtimeFriends、bedtimeGoodnight 仅返回 RETIRED，不加载 SDK、不读写数据。旧 database-rules.json / database-indexes.json 留作历史资源清点参考，不是新产品配置。更早的代理与定时任务见部署记录，不能恢复为通用数据库代理。
