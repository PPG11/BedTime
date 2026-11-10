# M2 模拟器证据

2026-11-10，微信开发者工具 iPhone 16 竖屏。此目录的图片均使用 `tests/fixtures/night-simulator.js` 与 `growth-simulator.js` 的受控样例，数字和长句不是真实业务数据，样例写入不访问云库。完成后重新编译恢复真实云绑定。

| 证据 | 实际检查 |
| --- | --- |
| lights.jpg、lights-choices.jpg | 实际点击日期入口，展开最近七夜并选择；人数、合并时间段与本人状态分开 |
| lights-suppressed.jpg、lights-error.jpg | 少于三人隐藏人数和分布；读取失败保留重试 |
| public-card.jpg | 40 字长句换行、公开范围说明、勾选后才可创建 |
| card-unknown.jpg、card-active.jpg | 模拟创建已完成但丢失回执，回读得到唯一活动链接 |
| card-revoked.jpg、card-unavailable.jpg | 撤销后本人提示与访客失效页；分享路径只含随机 cardId 和 ref |
| dashboard.jpg、dashboard-empty.jpg、dashboard-denied.jpg | 有数据、操作方式、无成熟样本、管理员拒绝 |
| channels.jpg | 建立样例渠道；另实际调用停用并核对入口仅带渠道 ref |

未点击微信发送分享，未向他人发送内容。真机分享接收、正式版落地与两个真实微信账号测试不由这些截图证明。后端真实云验收、权限探测与部署结果见 [M2 交付记录](../../m2-development.md#本轮交付记录)。
