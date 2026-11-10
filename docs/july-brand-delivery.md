# Dr. July 的早睡计划 · 品牌与项目复核

2026-11-10，北京时间。本轮将当前产品名称统一为「Dr. July 的早睡计划」，技术项目名仍为 BedTime，沿用原「今晚关灯」的业务规则。作者最终选择保留已经部署的提醒修复，并要求将品牌与修复代码提交、推送。本记录随本次改动归档；微信后台名称与头像未修改，小程序品牌版本尚未上传或公开发布。

## 当前项目状态

M1 核心闭环及一次性订阅提醒均已开发：真实单夜关灯、未知结果恢复、私人归档、夜签图片、偏好、隐私与数据删除联系入口、提醒预约／查询／取消及定时发送。此前已有真实云库联调和作者开发版真机收信、进入与退出确认，具体证据与边界沿用 [M1 交付记录](refactor-m1-delivery.md)和[提醒交付记录](reminder-development.md)。

本轮未发现首发范围中仍缺失的主要功能。公共灯迹、公开句子卡、渠道归因与运营看板属于需要独立决定的 M2 候选，不作为本轮遗漏补建。

## 品牌接入与素材

作者选择「困困月亮＋圆眼镜」：月亮呼应睡前的安静，圆眼镜保留为角色特征，沿用深梅紫与暖色。首页使用小图标和两行完整名称；关于页、个人页落款、添加小程序指引及夜签品牌同步。沉浸留白和原句不加入装饰，窗景与关灯操作保持原样。

| 位置 | 实现 |
| --- | --- |
| 名称与图标路径 | `miniprogram/config/brand.ts` 的 `BRAND` |
| 原图与平台图标候选 | `assets/brand/july-moon-master.png`、`july-app-icon-1024.png`、`july-app-icon-144.png` |
| 小程序包内图标 | `miniprogram/assets/brand/july-moon.png`，256×256 |
| 页面与导航 | `pages/night/`、`pages/about/`、`pages/me/`、`app.json`；导航使用短名 |
| 夜签导出 | `utils/night-card.ts`；保留原句、夜晚日期和品牌，不加入身份或个人关灯时间 |

品牌图由内置图像生成工具创建，完整提示词和来源见[图标生成记录](../assets/brand/README.md)。仅作等比例尺寸转换，原图保留。Canvas 品牌图加载失败时仍可导出完整文字署名，装饰失败不阻断夜签生成。窗景、Tab 与声音仍由原 Swift 脚本生成。

## 本轮补齐的提醒问题

原实现关闭提醒开关后会隐藏整个提醒入口，使已有预约的用户无法从正常导航查询和取消。现将“可以进入管理”与“允许新建”分开：配置开放或本人已有结构有效的最近预约时保留入口；停用或配置异常时仍可查看和取消已有预约，新建预约继续严格校验配置。没有本人预约时仍隐藏停用入口，身份隔离和发送规则不变。

改动位于 `cloudfunctions/common/nights.js`、`night-reminders.js`，契约和提醒规格已同步。回归覆盖关闭／配置异常、已有／无预约、他人隔离、可取消和禁止新建。

## 验证及云端状态

- 本地 `yarn verify` 通过：96 项自动检查、类型检查和原生构建；`yarn build:release` 通过。
- 微信模拟器 iPhone 16（393×852）已实际检查首页、关于、我的、空／有数据归档、40 字回执、1080×1440 PNG 夜签，以及拒绝保存后保留预览。提醒关闭时仍显示已有预约，并可取消。上述功能与排版场景使用内存隔离样例，不是本轮真实落库、订阅或收信验证。
- 320×568 窄屏与 Pixel 9（412×923）均实际检查了首页、40 字回执和操作区；标题与长句完整，操作可见。320px 页面高 514px，操作区底边 506px，滚动 500px 后 scrollTop 仍为 0；iPhone 首页高 770px，操作区底边 758px，scrollTop 为 0。完成后恢复原 iPhone 16 设备。
- 云端实际顺序为：`bedtimeNight` common 修复增量部署成功（12 文件、约 14 KB）→ 按中途“仅本地”选择恢复旧 common 成功（12 文件、约 13.8 KB）→ 按作者最新“保留已经部署的提醒修复”选择再次部署修复成功（12 文件、约 14 KB）。三次回执均为 success，最终云端保留提醒修复。
- 本轮仅更新 `bedtimeNight`，最终回读 Active、15 秒超时；未更新发送函数、配置、索引、权限或触发器，未执行数据库维护。两个本地准备包的 12 份 common 与源码一致；云端发送函数仍保留原部署包，本轮变动的查询／取消代码不属于其发送入口。品牌页面和图标已在工作区实现、尚未上传小程序；代码推送和云函数部署均不代表小程序品牌已发布。
- 最终模拟器已重新加载并恢复真实云连接：night/reminder 夹具与相册替身均不存在，首页 ready=true；真实 `getReminder` 返回 OK、enabled=true、testUntil=null，console error 查询为空。停用分支由本地回归与隔离页面验证，没有为验收关闭正式提醒服务。
- 本轮新品牌未完成真机复核，不将此前旧界面或提醒 developer 入口的成功扩写为新版全部验收通过。

名称最终确定为「Dr. July 的早睡计划」后，通过发布构建，并在 iPhone 16 模拟器复核[首页](evidence/july/rename-home.jpg)、[关于](evidence/july/rename-about.jpg)与重新生成的[夜签 PNG](evidence/july/rename-night-card.png)。名称调整共用品牌常量，未改业务或云端；本次未重复整套自动测试。完成后重新编译清除内存样例。

以下模拟器截图和 PNG 为更名前的功能与尺寸验证证据，画面中的旧名称不代表当前命名。

更名前模拟器证据：[首页](evidence/july/home-fixture.jpg)、[关于](evidence/july/about.jpg)、[我的](evidence/july/me.jpg)、[空归档](evidence/july/archive-empty.jpg)、[有记录归档](evidence/july/archive-record.jpg)、[40 字回执](evidence/july/home-long-receipt.jpg)、[夜签预览](evidence/july/receipt-card.jpg)、[实际 PNG](evidence/july/night-card.png)、[保存拒绝](evidence/july/receipt-save-denied.jpg)、[提醒停用](evidence/july/reminder-disabled.jpg)、[停用后取消](evidence/july/reminder-disabled-cancelled.jpg)。

更名前尺寸证据：[320px 首页](evidence/july/home-320.jpg)、[320px 长句](evidence/july/long-receipt-320.jpg)、[Pixel 9 首页](evidence/july/home-pixel9.jpg)、[Pixel 9 长句](evidence/july/long-receipt-pixel9.jpg)。

## 下一步

1. 本次提交仅收录品牌改造、提醒修复和相关验证记录，保留原有 11 份历史方案暂存项；后续进行新版真机复核。
2. 作者确认新版后，在微信后台更新名称与头像，并在真机复核首页、夜签保存及提醒管理；后台配置尚未修改。
3. 按作者决定上传、提审与公开发布。首次发布前继续使用无码夜签；正式发布后获取真实 release 通用码（`scene: "0"`、`page: "pages/night/index"`），接入夜签并检查最终导出图片的扫码效果。
4. 正式发布后验证普通预约的 formal 消息落地页；此前 developer 测试通知不代替这项。双账号真机按作者既定决定暂缓，其余两端异常细项按原交付清单补证。
5. 按[维护指南](night-operations.md)执行每周人工事件清理，继续实际使用和成熟样本观察。维护脚本已有，不宣称已安排自动任务或已验证留存效果。
