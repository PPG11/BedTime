# Dr. July 的早睡计划 · 图标

2026-11-10，作者选择「困困月亮＋圆眼镜」。月亮呼应睡前的安静，圆眼镜保留为角色特征。沿用深梅紫夜色与暖色窗光，不引入医疗符号。

- `july-moon-master.png`：内置图像生成工具输出原图，保留以便后续调整。
- `july-app-icon-1024.png`：1024×1024 方形图标，用于审阅与后续平台素材制作。
- `july-app-icon-144.png`：144×144 方形头像候选，供微信后台选择；未上传或修改后台头像。
- 小程序内使用 `miniprogram/assets/brand/july-moon.png`，256×256，约 61KB。
- 图像仅做等比例尺寸转换，未重绘主体。首页、关于页、夜签落款使用同一图标；沉浸仪式不放品牌装饰。

名称常量位于 `miniprogram/config/brand.ts`。页面使用完整名称分行显示，原生导航使用短名。源代码更名不等于微信公众平台已更名。

## 生成记录

使用内置图像生成工具，非命令行 API；无参考图。以下原始提示词保留当时的命名与设计要求，仅用于追溯素材来源，不代表当前产品名称。当前名称为「Dr. July 的早睡计划」，图标继续使用。

```text
Use case: logo-brand
Asset type: Production app icon for a quiet Chinese bedtime mini program named 七月（July）博士的早睡计划.
Create ONE square app icon, flat full-bleed very dark warm aubergine background #140F1E, not a mockup or presentation board. Center a single sleepy crescent moon character in soft warm ivory and muted amber. The moon has perfectly simple round wire glasses and two gently closed eyes, a tiny peaceful smile. The glasses signal a thoughtful friendly scholar ("博士"), never a medical doctor. Minimal carefully shaped 2D editorial mascot, elegant and calm, friendly to adults, crisp strong silhouette that reads at 40 pixels. The crescent silhouette can subtly suggest a J but do not draw any letters. Soft curved corners and confident simple clean contours, no hard highlights, no gradients or textures, no 3D. Icon mark fills about 68% of the square with ample breathing space. Use ONLY dark aubergine, warm ivory, soft muted amber. No text, no stars, no sparkles, no hats, no medical symbols, no borders, no rounded-square container. No giant eyes, no childish cartoon, no watermark. High quality vector-like raster illustration.
```
