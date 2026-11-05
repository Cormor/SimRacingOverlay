# 设计源与复用

本目录保存管理窗页面、深浅主题、方向盘托盘图标及金属边环的可编辑设计源和历史研究。运行时使用仓库根目录 CSS、tray-wheel-icon.js 与 assets/materials 的小型缓存，无需本机共享目录。

- `ui-v3/design.py` 使用同目录 `tokens.json` 颜色快照与 `assets/wheel.png` 生成页面 SVG，PNG 为预览；导出预览需要系统 librsvg、cairo、gobject。
- `light-palette-v1` 保存前后配色输入、现行 S02 状态及生成源。
- `material-physical-v1/layout-v1_6` 是可独立使用的物理生成源包，包含真实参数、Au 光学数据、来源和 CC0 许可。依赖和生成命令见其 README。v1.1–v1.3 为历史方案，共用 v1.6 附带的数据快照；旧比较预览路径仅记录比较意图，原预览不作为生成输入。
- `material-v2` 保留已停用方案与原始生成图；`tray/wheel.svg` 与运行模块保留托盘几何实例。

文档中的 SoftwareCompany 指开发者本地维护的共享设计来源，独立克隆不需要该目录。当前可复用输入、算法快照、运行 CSS、素材与许可均保存在本仓库；历史方案的说明不表示它们仍被运行版采用。
