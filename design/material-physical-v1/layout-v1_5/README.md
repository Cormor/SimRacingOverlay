# 单凸精抛边环：明亮环境源包 v1.5

主要交付是可参数化算法、真实输入、材料快照和纯SVG，PNG为物理效果预览。v1.5保留旧稿，只将环境反射下限.02→.16；工程SVG另将最暗色调整为#B69142，不能用它代替物理效果判断。公司materials2.2候选定义先于本包保存；本包不接入生产CSS或运行版。

- `ring_mesh.py`：真实单凸半椭圆截面、等距圆角、闭合侧壁/底环。
- `render_layout.py`：读取JSON，使用包内Au数据建立共同场景，离线积分和导出。
- `core_physical.py`：v1已审线性滤波、显示编码、场景序列化和预览导图函数；无联网、旧E盘或父目录依赖。
- `draw_vector.py`：只依赖Python标准库的SVG几何/截面生成器。
- `svg/*-ring.svg`：真正path/arc/evenodd孔与少量工程渐变，无位图。
- `svg/ring-section.svg`：精确椭圆弧的截面定义；渐变只示意体积。
- `svg/vector-theme-board.svg`：真正path/arc/evenodd的黑金/白金双主题设计板，三种宽度；仅为工程视觉近似，无位图。
- `params.json`、`data/`、`requirements.txt`：实际输入、原材料数据/CC0许可/provenance和实际工具版本。

SVG颜色映射为本候选暗部工程边界`#B69142`、accent令牌`#E8C66A`及text令牌`#F4F1E8`，明确是可编辑视觉近似，没有从PBR图拟合或证明误差。PBR物理权威源仍为算法+Au谱+真实场景。预览合成SVG内含PNG，文件名带`physical-preview`，不能当纯矢量源。

## 生成

在本包目录执行以下命令；脚本默认从自身目录读取params，不要求固定工作目录。可将完整包复制到其它位置，保留包内相对结构，再提供新的输出目录。

```sh
python draw_vector.py --output-root svg
python render_layout.py --work-root /absolute/path/to/scratch --output-root /absolute/path/to/physical-preview
```

纯SVG生成不需要渲染器。物理生成使用本次环境Python3.14、Mitsuba3.9.1、DrJit1.5.0、NumPy2.5.4、CPU LLVM21；实际pip依赖见requirements.txt。预览合成图导出另使用系统librsvg-2、cairo、gobject-2.0；它们只负责说明图，不参加光谱积分。这里没有为资源交付新安装依赖或运行测试。

`data.snapshot_directory`默认是相对params文件的`data`，只读包内快照，不联网。输出带同一JSON/数据和源码，能以其params继续重新生成。resolved scene中的绝对OBJ路径用于记录本次实际执行对象，不是移动源包后的输入；重新执行会在新work-root生成新OBJ和对应场景。

## 参数与适用范围

可改controls中的W/H/位置、geometry的边宽/峰高/圆角/分段，以及画板、相机和共同灯。几何有效域为`0<边宽<圆角半径`、`2R≤min(W,H)`，冠高为正、底面在0下方；中央始终无金属面。半椭圆公式见DEFINITION。改变W/H或R后重新生成SVG，不通过缩放现成SVG来拉伸圆角和边宽。

画板CSS坐标按metres_per_pixel映射到世界，camera.frame_width_m应等于board.width×metres_per_pixel，film与board宽高比一致。移动控件或改变共同灯后，用相同参数重新烘焙才能得到新参考布局的光输运；继续使用旧缓存只是视觉近似。PNG输出尺寸按CSS宽高及所选1x/2x取整，物理几何保留输入尺寸。

α=.006保持，v1.4到v1.5唯一物理变化为环境照明。洁净、新精抛亮面是目标，α和工艺未实测匹配。单凸不等于没有暗侧，不能把正确公式写成用户审美已通过。运行若后续采用，只携带必要的SVG或明确缓存，离线渲染工具/EXR不进入运行。

## 本次照明取舍

D65环境从.02改为.16，单一面积灯scale仍为1。50:1→6.25:1只是场景辐亮度scale比，不是像素对比或实测亮度；反射由方向可见性和BRDF积分决定。抬高摄影棚周边亮度可以减少灯外暗反射，也可能减弱体积层次，按唯一新PBR图判断。Au、α、半椭圆、灯位尺寸、0EV和采样保持，不加diffuse或改光谱。

## 实际生成结果

本次唯一稿生成未报错。8线程、1024spp，积分步骤用时3.65秒，仅为本次离线记录，不代表运行性能。主要文件大小：纯SVG双主题板vector-theme-board.svg为3,452字节；medium-ring.svg为1,214字节；物理效果预览PNG为70,125字节，240环2x PNG为9,609字节，线性EXR为407,067字节。

root与ux_review直接看图后的共同判断：环境提亮后，近黑反射段提升为暖棕/暗金，2x左下内沿仍较深；不称暗边消失或最终审美通过。纯SVG双主题板是独立工程近似，不能用它替代PBR图对过黑问题的判断。源角色与几何成立，可作为阶段结果交用户反馈，不作生产采用；本轮停止自主调参。
