# 连续柔光金边：可参数化源包 v1.6

主要源为ring_mesh.py真实几何、light_field.py有限软屏分布、render_layout.py光谱生成、params.json真实输入及包内data。draw_vector.py提供真正路径/渐变SVG，只有工程近似；PNG只作物理效果预览或明确缓存。源不依赖旧E路径或父目录。

```sh
python draw_vector.py --output-root svg
python render_layout.py --work-root /absolute/scratch --output-root /absolute/physical-preview
```

Python3.14、Mitsuba3.9.1、DrJit1.5.0、NumPy2.5.4、CPU LLVM21沿用现成环境，pip版本见requirements。SVG生成只需stdlib；说明图导出使用系统librsvg/cairo/gobject，均不参加物理积分。data相对params位置读取，输出目录可另外指定。

共同有限软屏S=.16+.34B+.50K、D65环境.16；坐标/窗口参数与能量边界见DEFINITION及真实JSON。light_field生成单通道raw EXR作为离线缓存，D65嵌套相乘保谱，原生area/bitmap负责采样与PDF，不写新光源插件，不走RGB重建。输入data/许可/provenance、source/meshSHA和resolved场景随交付保留。

控件88/144/240/376×44在同一场景，原三位置不变，88按已见“采用”需求放入。源可按实际宽高/位置/边宽/圆角重建，不把四宽cache当任意布局精确解。物理仅边环，primary内面原生金填色；普通默认中性、hover环与独立辉光，完整状态另按正式定义接续。SVG板与PBR预览分角色，旧AI位图不作为本包源。

运行若采用只消费必要原生SVG或小缓存，不带光屏EXR/渲染器。9slice和动态尺寸复用是需要明确的几何/光场近似，不能靠拉伸圆角或边宽迎合cache。实际图将用于继续推进采用判断，仍有差距会据因果分析继续处理。

## 实例快照与共享唯一源（2.3）

本目录保留本次v1.6已生成的研究/输入实例及原源码，不作为第二个未来维护源。后续算法、相对Au数据、参数化软屏和状态设计源统一维护在公司gold-ring源包（本地共享设计来源；仓库内输入见 design/README.md），身份见其source-manifest.json。运行缓存与元数据由公司design/assets/materials维护，项目只按正式版本vendor。

v1.6实际积分步骤4.58秒，88/240/376的2x透明环分别5274/9420/12941字节。root与独立审查已批准其作为2.3实现基础：近黑宽段改善为暖金细沿，四宽连续，2x仍保留体积层次；不冒称工艺实测或用户最终审美批准。公司共享定义先保存，S01完整状态图随后形成，运行切换由项目另记。
