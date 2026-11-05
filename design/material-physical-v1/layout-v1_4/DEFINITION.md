# Au-JC1972：单凸半椭圆精抛边环 v1.4

状态：公司materials2.2候选定义（本地共享设计来源；仓库内输入见 design/README.md）经root独审先行保存，再建立本可移植源包；2026-11-03已生成纯SVG及唯一物理预览。2.1/sin²旧稿因用户反馈双带而未采用，原源/图保留。本次不扫描参数、不改生产CSS、运行版或旧2.0资产，采用范围待实际图与用户反馈判断。

## 设计缺口与唯一物理修正

用户指出边框像一深一浅两条色带没叠拢。现有合成中body与ring无整像素错位依据；旧sin²高度导数造成normal在跨宽内0→正→0→负→0折返，同一朝向多次出现，2CSSpx采样又会把窄亮暗区读成双边。本次不用平移贴图凑对齐，改为单凸半椭圆真实几何与一致法线。

设外到内跨宽w，t∈[0,π]：

`d=(w/2)*(1−cos t)`

`z=H*sin t`

`N=normalize(H*cos t*n_out_x, H*cos t*n_out_y, (w/2)*sin t)`

默认w=1mm=2CSSpx、H=.08mm。等距内缩圆角中心固定、半径R−d；跨截面16段，圆角32段/角，直边每段≤4CSSpx，薄壁和平底环z=−.10mm不变。t两端normal分别朝外/内壁，与竖壁C1相接；中间正对顶面，法线单调经过，不再折返。真实顶点及normal同步，中央无cap。薄底连接仍是硬边。w、H、R、厚度、分段和尺度为工程输入，不是Au材料测量值。

## 材料目标与固定条件

目标是洁净、新精抛亮面；α=.006保持以隔离几何，不冒称对应实际抛光工艺。roughconductor/GGX、specular_reflectance=1，没有diffuse项、RGB染金、AI纹理或划痕。Johnson–Christy1972 Auη/k原字节SHA256仍为9f4bdab6bd49f7c6a1c48b5fb5482c7448caf4b6de39594a34ecd66dcf592774，CC0许可与原provenance随包内data保存，不联网重新拉main。光谱基准不等于合金、涂层、氧化层或加工状态已经匹配。

共同布局144/240/376×44、中心(-.076,.037)、(-.052,0)、(-.018,-.037)m，共同Rx(-8°)@Ysec8@位置；相机、唯一D65灯center(.015,.140,.25)m/size(.400,.26163)m/Rz(-45°)/scale1、环境.02、0EV、1024spp、seed20261103、max_depth8、8线程均保持。下层body只作原生合成，未参与金属环的互反射，不声称完整产品联合光学复刻。

Fresnel/微表面机理依据沿用[PBRT导体反射](https://pbr-book.org/4ed/Reflection_Models/Conductor_BRDF)、[微表面理论](https://pbr-book.org/4ed/Reflection_Models/Roughness_Using_Microfacet_Theory)及[Mitsuba roughconductor](https://mitsuba.readthedocs.io/en/latest/src/generated/plugins_bsdfs.html#rough-conductor-material-roughconductor)。材料来源为[Johnson–Christy1972](https://doi.org/10.1103/PhysRevB.6.4370)，data中的维护者公开录入不称实验室原始仓。

## 源优先交付

物理权威源为本包算法、真实params、材料快照/许可/provenance和版本依赖。输入data默认相对params位置，不读取旧E会话或父目录；可按有效几何域的W/H/边宽/半径/位置重建。README给出参数关系和调用方式，requirements记录实际版本。真实OBJ、resolved场景、输入及所有源SHA保存。

draw_vector.py另生成真正的路径/椭圆弧/evenodd几何和渐变SVG，无image或data-PNG。SVG环路径是精确2D轮廓，截面使用精确半椭圆弧；渐变颜色来自公司令牌/工程边界，是可编辑近似，不是对PBR色阶采样或精确光谱解，不声称与物理预览像素等价。没有堆叠海量path矢量化PBR，也不为了格式降低物理算法准确性。

物理PNG只作效果预览或明确需要的后续缓存，线性EXR离线保留。1x/2x来自同一1024×512 HDR，先线性辐亮度/alpha覆盖面积滤波，再解除预乘、sRGB编码；无去噪、Reinhard、趋白、饱和度增强。物理预览合成SVG包含PNG，并显式标注位图合成角色，不归入纯矢量资源。

## 原生UI、成本及停止边界

中性body与少量primary填色/文字沿公司令牌，hover外辉光独立，不烘焙进ring；focus/disabled/loading、热区和键盘语义沿用组件定义。仅按固定参考布局物理生成，动态缩放/搬移继续用旧缓存仍属近似；SVG可重新构造几何，不因此承诺工程渐变等于真实共同光场。运行若后续采用只带必要SVG或缓存，Mitsuba/DrJit/NumPy/EXR均离线，不声称零解码/显存成本。单凸可避免normal折返，但不保证消灭合理暗侧或自动满足用户审美。

本轮公共定义→项目定义/源码→纯SVG→唯一物理预览，完成后交root/ux_review看单凸、源边界及双带表现；不连续自主微调。所有旧图和源保留。

## 直接生成记录

draw_vector已保存四份真正SVG资源。物理预览随后使用本完整源包中的relative数据成功生成，未报错、未联网；Mitsuba3.9.1/DrJit1.5.0/NumPy2.5.4，CPU线程上限8，总1024spp，积分步骤本次3.64秒。原材料SHA保持，真实输入、各算法源、mesh SHA及resolved场景由生成器保存；完整source/data/requirements也随物理预览保存。本次耗时仅离线记录，不推导运行性能。

| 资源及角色 | 实际大小（字节） |
| --- | ---: |
| svg/small-ring.svg，纯SVG几何/工程渐变 | 1,194 |
| svg/medium-ring.svg，纯SVG几何/工程渐变 | 1,196 |
| svg/wide-ring.svg，纯SVG几何/工程渐变 | 1,192 |
| svg/ring-section.svg，真实截面示意 | 1,018 |
| medium-ring-1x.png / medium-ring-2x.png，物理预览/可选缓存 | 2,815 / 9,764 |
| small-ring-2x.png / wide-ring-2x.png，物理预览/可选缓存 | 7,044 / 13,302 |
| render-linear.exr，离线辐亮度 | 411,476 |
| optical-ring-physical-preview.png，物理效果说明图 | 197,282 |

作者查看后的判断：2x边环相较旧sin²更像同一条连续凸边，重复normal形成的独立细带减轻；仍有合理内外明暗，小图差异不夸大。中央与文字保持原生填色，hover独立。单凸与源资源目标已形成实际产物，不能据此自动宣布“最靓丽”或用户审美已通过。源码/真参数/纯SVG为交付入口，PNG只按其预览角色使用。
