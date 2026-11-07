# 打卡、晚安心语与好友链路

本页记录当前代码实现。云函数接口与集合字段见[云函数与数据库](../cloudfunctions/README.md)。

## 用户初始化

`AppDataProvider` 加载当前用户、今日状态和打卡历史，首页与个人页通过 `useAppData` 共享数据。新用户由 `userEnsure` 根据微信上下文中的 `OPENID` 创建档案，并分配用于添加好友的短 `uid`。昵称和目标就寝时间通过用户服务保存，公开资料由资料服务刷新。 [共享状态](../src/state/appData.tsx) · [用户服务](../src/services/user.ts) · [公开资料](../src/services/profile.ts)

## 打卡

1. 首页根据目标就寝时间计算按钮可用状态、`date` 和 `hit` 或 `late`。默认开放区间为目标时间前 12 小时至后 6 小时。 [打卡窗口](../src/utils/checkin.ts)
2. 点击打卡后，首页尝试抽取一条心语，再调用 `checkinSubmit`，可携带抽中的消息 ID。服务端在无消息 ID 时也会尝试抽取。 [首页操作](../src/pages/home/index.tsx) · [提交函数](../cloudfunctions/checkinSubmit/index.js)
3. `checkins` 的常用记录按 `{uid}#{yyyymmdd}` 保存，包含打卡状态、时间戳及可空的 `gnMsgId`。服务端另外更新 `users` 的打卡摘要。历史和今日状态由 `checkinRange` 和 `checkinStatus` 提供。旧部署还可能使用 `{uid}` 文档中的 `info[]`，前端服务保留了兼容分支。 [打卡服务](../src/services/checkin.ts) · [打卡数据模型](../cloudfunctions/common/checkins.js)

已知边界包括跨午夜时首页周期与统计日期不一致、云端直接接受客户端提供的日期和状态，以及记录和统计分别写入导致部分失败后的重试无法补齐统计。改动打卡时应同时验证跨午夜、重复请求和旧格式数据。

## 晚安心语

- **投稿**由 `gnSubmit` 按用户和日期保存到 `goodnight_messages`。前端限制 80 字并展示已投稿内容，当前后端会截取到 240 个 UTF-16 码元并直接标为 `approved`。投稿完成后只更新投稿状态。 [心语交互](../src/pages/home/useGoodnight.ts) · [投稿函数](../cloudfunctions/gnSubmit/index.js)
- **收到心语**当前是打卡奖励。抽样默认按目标就寝时间的半小时时段筛选，带有作者避让和最低分条件，可能返回空。前端会用打卡记录里的 `gnMsgId` 恢复奖励。若记录最初没有消息 ID，后续补抽的内容可能只展示在当次会话，当前正常查询路径不会回写这条消息 ID。 [抽样逻辑](../cloudfunctions/common/goodnight.js) · [打卡服务](../src/services/checkin.ts)
- **投票**由 `gnReact` 写入待消费增量，`gnReactionsConsume` 汇总后清理记录。去重只在待消费记录存在期间有效。 [投票函数](../cloudfunctions/gnReact/index.js) · [消费函数](../cloudfunctions/gnReactionsConsume/index.js)

产品设想中的「送出一条后收到一条」仍需单独实现。迭代时关注空池、重复投稿、重新进入后的奖励恢复，以及服务端授权。当前 `databaseProxy` 允许更改部分应由服务端维护的字段，并会返回原始心语文档，相关权限仍需收紧。 [代理权限](../cloudfunctions/databaseProxy/index.js)

## 好友互助

1. 好友页输入对方 `uid` 后调用 `friendRequestSend`，在 `friend_requests` 中创建申请。
2. 接收方通过 `friendRequestUpdate` 接受或拒绝。接受时写入 `friendships`，无向关系使用排序后的双方 UID 组成主键。发送方读取已接受的申请时可调用 `friendFinish` 补写关系。
3. `friendsPage` 从 `users` 批量读取好友与申请相关用户的展示字段。好友页用这些数据展示作息与打卡状态，备注保存在本机。解除好友关系调用 `friendRemove`。

[好友页](../src/pages/friends/index.tsx) · [好友服务](../src/services/friends.ts) · [接受申请函数](../cloudfunctions/friendRequestUpdate/index.js) · [好友列表函数](../cloudfunctions/friendsPage/index.js)
