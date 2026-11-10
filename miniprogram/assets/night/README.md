# 早睡计划的窗景与声音素材

本目录的窗景 PNG、Tab 图标与 WAV 由本项目 `scripts/generate-night-assets.swift` 生成：几何建筑、窗形与人形 Tab 图标、短正弦合成音。没有下载照片、外部音效或字体包，素材沿用仓库许可。

「Dr. July 的早睡计划」的困困月亮与圆眼镜品牌图由内置图像工具生成，原图及平台图标位于仓库根目录 `assets/brand/`，小程序内使用 `miniprogram/assets/brand/july-moon.png`。品牌名称和资源路径统一由 `miniprogram/config/brand.ts` 管理；品牌图不由上述 Swift 脚本生成。使用位置与交付情况见 [July 品牌交付记录](../../../docs/july-brand-delivery.md)。

| 文件 | 尺寸 / 内容 | 用途 |
| --- | --- | --- |
| sky.png | 720×660，夜空渐变 | 首页与夜签背景 |
| distant.png | 720×660，透明远楼 | 与夜空同尺寸对齐 |
| facade.png | 720×660，透明近楼 | 与前两层对齐 |
| tab-night*.png / tab-me*.png | 81×81，常态 / 选中态 | 两个原生 Tab |
| light-off.wav | 单声道 22050Hz，约 180ms | 用户主动开启声音后播放 |

窗景按首页剩余高度等比例容纳，三层保持 720:660；灯光在同一内层按素材百分比定位，触控区保持 64×76px。夜签采用同一素材的等比例居中裁切。正式夜签由 `utils/night-card.ts` 使用 Canvas 生成 1080×1440 图片，系统无衬线，只含原句、夜晚日期与品牌；不再打包 M0 静态样张。历史样张与排版截图保留在 `docs/evidence/`。

声音默认关闭。静音、外部音频和实际音量仍需在对应真机确认；本地文件生成、模拟器播放不替代真机检查。
