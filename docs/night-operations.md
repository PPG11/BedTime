# 今晚关灯数据维护

M1 由项目所有者负责人工维护，反馈邮箱为 **luolie0577@gmail.com**。不部署定时统计函数。每周至少一次清理超过 30 个北京日历日的原始事件，实际保留不超过 37 天；执行结果须保存。私人记录和偏好长期保留，按核验后的本人申请删除。

订阅提醒增量在 n_users 中仅保留最近一次预约和最近尝试发送的夜晚，不新增个人集合。提醒定时发送与 M1 的人工统计 / 清理职责分开；部署、停用和投递边界见 [提醒交付记录](reminder-development.md)。

导出包含私有标识，只能放在仓库之外。脚本拒绝仓库内路径及指向仓库的软链接，文件权限 600。报告只输出聚合值，作者 / 测试账号须显式排除。不要把原始导出、排除名单、维护计划或临时令牌放进 Git、截图或公开报告。

## 只读导出与 3/7 报告

下例是参数示意，日期、环境和私有目录按实际分析期填写。导出和报告命令不修改云数据。

```sh
yarn night:export --env cloudbase-d0gcfmrvdb974536e --appid wxd489f0523662b0ea --from 20261108 --to 20261114 --events --out /tmp/night-export-20261115
# 在仓库外创建 exclude.json，内容是作者 / 测试 OPENID 的 JSON 数组
yarn night:report --input /tmp/night-export-20261115 --from 20261108 --to 20261108 --as-of 2026-11-15T06:00:00+08:00 --exclude /tmp/night-private/exclude.json --out /tmp/night-report-20261115
```

导出逐集合按 `_id` 游标分页，记录字段、条数、SHA256、环境和起止时间。报告要求完整用户摘要及激活夜 A 至 A+6 的完整范围，检查摘要与记录一致性；不一致时比例为空并返回非零状态。并发使用期间的导出不是数据库快照，一致性失败时重新导出，不能补造记录。

3/7 的分母只包含 A+6 夜在次日 06:00 已结束的激活用户；期间有至少三条真实夜签为达到，按激活周分组。未成熟用户单列，空样本不给百分比。它衡量当前 M1 组合的复用，不证明入睡。事件只按接收日筛选最近 30 天，末日样本截至导出时刻；不把它解释为精确小时统计或完整行为漏斗。

## 每周事件清理

先完整导出，再预演，审阅环境、日期边界和条数后执行同一清单：

```sh
yarn night:export --env cloudbase-d0gcfmrvdb974536e --appid wxd489f0523662b0ea --all --out /tmp/night-maintenance-export
yarn night:maintenance --input /tmp/night-maintenance-export --env cloudbase-d0gcfmrvdb974536e --action expire-events --as-of 2026-11-08T16:00:00+08:00 --out /tmp/night-private/expiry-plan.json
yarn night:maintenance --execute --env cloudbase-d0gcfmrvdb974536e --appid wxd489f0523662b0ea --plan /tmp/night-private/expiry-plan.json
```

2026-11-08 的边界为删除 `receivedDateKey < 20261010`，保留含当日在内的 30 个日历日。脚本只删除清单内 ID，并再次加日期条件；每批最多 100 条。平台返回 pending 时保存 taskId，确认后重跑同一个执行命令，只查询原任务，不重复提交。若上次回执不明、拒绝或失败，先人工核对，不盲重发。

最后查询是否仍有范围内记录。只有 `verified-empty` 才表示本次清理通过；`remaining-data` 表示仍有漏项或并发新增，需要重新导出核对。保留清单中的完成状态、时间和条数作为执行记录。

## 本人数据删除

1. 邮箱仅接收申请，不能凭邮件地址、昵称或自称 OPENID 判断本人。先通过已核对的微信身份 / 受信联系渠道确认申请人与目标账号一致；无法核验则不删除。
2. 请本人先取消待发提醒，再暂停使用、关闭小程序；等待在途业务和提醒发送调用结束，确认要删除的唯一 OPENID 和环境。已进入微信的消息无法撤回。
3. 以 `--all --growth --uid <已核对的OPENID>` 导出该用户的 n_users、n_nights、n_events、n_cards、n_card_keys、n_attributions，再用 `--action delete-user --uid <同一OPENID>` 生成 version 2 六集合计划。缺少任一集合时拒绝生成。
4. 审阅后执行时加 `--owner-paused`。先删除本人公开卡及归因，再删除原三集合，公共 n_phrases 和 n_channels 不动。旧 version 1 清单仍只允许原三集合，不可手改版本扩大授权；须重新导出和预演。
5. 回读六集合均为空后通知申请人；重新使用会重新建档，已删除历史不恢复。本地恢复标记不含句子，不能据此补造云记录。若仍有在途写入，继续保持停用并重新核对。公开卡还会核对原夜签及确认时间，删除原记录后立即拒绝访问，不因同夜再次建档复活。

## 本轮演练记录

2026-11-08：真实只读导出得到 1 个用户、0 条私人夜签（临时云验收数据已另行清理）；聚合报告一致性通过、没有成熟样本。过期事件预演为 0 条，执行不发起删除，只回读验证。具体完成状态见 [交付记录](refactor-m1-delivery.md)。

个人删除的范围限制、分批、pending 恢复、错误停止与最终回读已自动化测试；本轮没有删除真实用户档案。公开发布前将每周人工维护纳入项目所有者日程，不能将文档中的约定当作已运行的自动任务。
