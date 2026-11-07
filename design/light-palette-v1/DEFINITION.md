# 白金浅色语义色对照

本次先保存公司palettes/clear-platinum-light.md/.json共享定义，再生成本实例。before来自本轮读取的ui-tokens/公司tokens与S01-light值；after是共享palette1.0的实例副本，未来颜色维护以公司JSON为准。

同文案、布局、字号、44px高/R8与固定金边轮廓，只换定义内11个light token；主次文字、白卡片/raised面、88主操作、144普通/hover/focus/selected和色样同场。SVG为原生rect/path/text，无image或位图。金边仅同几何示意，实际物理cache不参与本轮颜色变更；不改变Au/光场或黑金、状态规则。

draw_palette.py读取before/after，保存palette-comparison.svg与PNG设计预览。没有新测试、截图验收或参数扫描。图用于判断是否采用，实际tokens/运行由root接续；当前不修改已运行主题。
