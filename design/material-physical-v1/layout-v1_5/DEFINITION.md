# Au-JC1972：明亮环境边环 v1.5

状态：本次精确增量由root与ux_review独审批准；先补公司候选记录，再保存本定义/源和SVG双主题板，随后生成唯一PBR效果预览。保留v1.4，不改生产CSS、运行版、旧资源或算法几何，不预先宣布审美通过。

## 设计缺口与保持的几何

用户指出v1.4物理边框过黑。该图不消费工程SVG颜色，不能把SVG暗stop修改当物理修正。本次只改共同环境D65 scale .02→.16，保留以下单凸半椭圆；此前sin²法线折返已由v1.4改为单调截面，不继续微调几何、金谱或α。

设外到内跨宽w，t∈[0,π]：

`d=(w/2)*(1−cos t)`

`z=H*sin t`

`N=normalize(H*cos t*n_out_x, H*cos t*n_out_y, (w/2)*sin t)`

默认w=1mm=2CSSpx、H=.08mm。等距内缩圆角中心固定、半径R−d；跨截面16段，圆角32段/角，直边每段≤4CSSpx，薄壁和平底环z=−.10mm不变。t两端normal分别朝外/内壁，与竖壁C1相接；中间正对顶面，法线单调经过，不再折返。真实顶点及normal同步，中央无cap。薄底连接仍是硬边。w、H、R、厚度、分段和尺度为工程输入，不是Au材料测量值。

## 材料目标与固定条件

目标是洁净、新精抛亮面；α=.006保持以隔离几何，不冒称对应实际抛光工艺。roughconductor/GGX、specular_reflectance=1，没有diffuse项、RGB染金、AI纹理或划痕。Johnson–Christy1972 Auη/k原字节SHA256仍为9f4bdab6bd49f7c6a1c48b5fb5482c7448caf4b6de39594a34ecd66dcf592774，CC0许可与原provenance随包内data保存，不联网重新拉main。光谱基准不等于合金、涂层、氧化层或加工状态已经匹配。

共同布局144/240/376×44、中心(-.076,.037)、(-.052,0)、(-.018,-.037)m，共同Rx(-8°)@Ysec8@位置；相机、唯一D65灯center(.015,.140,.25)m/size(.400,.26163)m/Rz(-45°)/scale1、环境.16、0EV、1024spp、seed20261103、max_depth8、8线程均保持。下层body只作原生合成，未参与金属环的互反射，不声称完整产品联合光学复刻。

Fresnel/微表面机理依据沿用[PBRT导体反射](https://pbr-book.org/4ed/Reflection_Models/Conductor_BRDF)、[微表面理论](https://pbr-book.org/4ed/Reflection_Models/Roughness_Using_Microfacet_Theory)及[Mitsuba roughconductor](https://mitsuba.readthedocs.io/en/latest/src/generated/plugins_bsdfs.html#rough-conductor-material-roughconductor)。材料来源为[Johnson–Christy1972](https://doi.org/10.1103/PhysRevB.6.4370)，data中的维护者公开录入不称实验室原始仓。

## 本次唯一照明变化

面积灯radiance scale仍为1，D65环境.02→.16，名义灯/环境scale比50:1→6.25:1。它只表示场景辐亮度scale比，不是实测像素对比或亮度测量；最终反射取决于方向可见性与BRDF积分。用更亮的摄影棚周边反射抬高灯外暗部，也可能减弱明暗层次，按唯一新PBR图判断。不加diffuse、不提曝光、不改Auη/k。

工程SVG最暗色另由#94702D改为#B69142，另两色#E8C66A/#F4F1E8不变。它是独立工程近似，不是PBR拟合，不代替物理图。新增vector-theme-board.svg用原生path/arc/evenodd与use，黑金/白金各三宽，2px边宽/8px角半径，无任何位图。

## 源优先交付

物理权威源为本包算法、真实params、材料快照/许可/provenance和版本依赖。输入data默认相对params位置，不读取旧E会话或父目录；可按有效几何域的W/H/边宽/半径/位置重建。README给出参数关系和调用方式，requirements记录实际版本。真实OBJ、resolved场景、输入及所有源SHA保存。

draw_vector.py另生成真正的路径/椭圆弧/evenodd几何和渐变SVG，无image或data-PNG。SVG环路径是精确2D轮廓，截面使用精确半椭圆弧；渐变颜色来自公司令牌/工程边界，是可编辑近似，不是对PBR色阶采样或精确光谱解，不声称与物理预览像素等价。没有堆叠海量path矢量化PBR，也不为了格式降低物理算法准确性。

物理PNG只作效果预览或明确需要的后续缓存，线性EXR离线保留。1x/2x来自同一1024×512 HDR，先线性辐亮度/alpha覆盖面积滤波，再解除预乘、sRGB编码；无去噪、Reinhard、趋白、饱和度增强。物理预览合成SVG包含PNG，并显式标注位图合成角色，不归入纯矢量资源。

## 原生UI、成本及停止边界

中性body与少量primary填色/文字沿公司令牌，hover外辉光独立，不烘焙进ring；focus/disabled/loading、热区和键盘语义沿用组件定义。仅按固定参考布局物理生成，动态缩放/搬移继续用旧缓存仍属近似；SVG可重新构造几何，不因此承诺工程渐变等于真实共同光场。运行若后续采用只带必要SVG或缓存，Mitsuba/DrJit/NumPy/EXR均离线，不声称零解码/显存成本。单凸可避免normal折返，但不保证消灭合理暗侧或自动满足用户审美。

本轮公共候选记录→项目定义/源码→真正SVG双主题板→唯一PBR物理效果预览。主问题是物理边框过黑，最终用户看PBR新效果；SVG板是工程近似另件。完成后交root/ux_review只看照明与呈现差异，不连续自主微调。所有旧图和源保留。

