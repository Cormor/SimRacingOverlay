# Au-JC1972：闭合微曲面金属边环 v1.3

状态：公司materials2.1候选光学边框profile（本地共享设计来源；仓库内输入见 design/README.md）已先行定义并由root独审批准，2026-11-03按该定义完成唯一离线边环设计。保留v1.1/v1.2，不改运行版、生产CSS、公司2.0资产或算法，不预告审美通过。

## 用途、材料与机理

用户要求边缘使用边框通宽微曲面，让光照自然流转，作为边框纹理。本次真实金属只存在于闭合边环；中央不建金属面且alpha透明。下层原生中性body、少量primary填色、文字和独立hover外辉光仅为SVG合成，不参与环的互反射，不声称完整产品的联合光学复刻。

Johnson–Christy1972 Auη/k快照、GGX α=.006、specular_reflectance=1沿用。roughconductor是导体镜面/微表面反射，不含diffuse项，也没有RGB染金、AI贴图或划痕。此前柔和/平涂不能单凭视觉就归为“材质错”，材料谱、粗糙度、宏观几何、灯的空间分布及显示共同决定外观；当前η/k对应特定Au样本，α未测量加工工艺，不代表合金/涂层/氧化层已匹配。原始材料来源、许可与原字节SHA保留，不能仅凭n/k正确认定目标工艺或审美正确。

## 唯一边环几何

0.5mm/CSSpx；外尺寸144/240/376×44，外radius8CSSpx=4mm。跨宽w=2CSSpx=1mm，d从外缘到内缘，h(d)=.08mm*sin²(pi*d/w)，h'(d)=.08mm*pi/w*sin(2pi*d/w)。圆角中心固定，各环半径R−d；顶点z=h(d)，normal=normalize(h'(d)*n_out_x,h'(d)*n_out_y,1)。内外缘高度、斜率均为0，真实顶点与一致法线一起改变。

跨宽16段、圆角32段/角，直边每段不超过4CSSpx。顶面相邻轮廓以真实三角环带连接，底面为z=−.10mm的平底环，薄内/外侧壁连接顶和底，形成闭合环体；中央孔没有顶面、底面或隐藏cap。尖锐壁边使用分离法线保留硬边，几何位置连续。高度、底厚、段数与尺度均为工程选择，不声称实物制造测量。

## 保持场景与实际输入

params.json从v1.1真实输入继承同布局、相机、共同全局变换、唯一D65大灯、JC快照、α、环境.02、0EV、1024spp、seed20261103、max_depth8和8线程。只将被照物从整片顶面改为闭合边环，移除不适用的整片厚度/倒角参数并加入边环截面字段。144/240/376×44的中心仍为(-.076,.037)、(-.052,0)、(-.018,-.037)m，全局Rx(-8°)@Ysec8@translate，灯center(.015,.140,.25)、size(.400,.26163)、Rz(-45°)、朝-Z、scale1不变；不为每条边独立补亮。

原dataset SHA256为9f4bdab6bd49f7c6a1c48b5fb5482c7448caf4b6de39594a34ecd66dcf592774，不联网重新拉main。原许可与provenance记录包含原URL、取得时间及commit未取得事实。生成保留真实JSON、resolved场景、OBJ、源版本及SHA。

1024×512单一HDR积分、16×64spp线性累计，保存线性RGBA EXR；从同HDR线性辐亮度/alpha覆盖面积滤波后编码sRGB，导出每个尺寸1x/2x透明ringPNG。1024spp不保证无噪。中央透明来自没有几何和hide_emitters背景，不用后期擦除、RGB阈值或AI编辑。

## 原生合成、主题和成本边界

设计图展示黑/白主题下全部尺寸的显式强调中性body+ring，以及普通默认、少量primary、强调hover。普通默认不加载金属环；中性body/文字使用公司surface/text，primary用accent-fill/on-accent-fill或对应深色语义。hover外辉光是独立SVG状态效果，位于body背后，不写入ringPNG，不把纹理称为发光材质。focus/disabled/loading沿用组件定义，状态不改变热区、命令或键盘语义；视觉层不拦截指针、不参与无障碍内容。2x辅助视图仅放大查看同一资源，不重新配灯。

该固定布局是光学基准；任意动态搬移/缩放后继续使用烘焙贴图属于近似。未来若消费先定义原生裁切/分片，保持2px边宽和圆角，不拉伸环截面。运行若采用只携带必要静态资源，Mitsuba/DrJit/NumPy、EXR和研究片均离线保留；纹理内存/解码仍有成本，生成后记录实际资源大小，不声称零运行开销。本次没有生产CSS或运行接入。

## 来源与文件

- https://doi.org/10.1103/PhysRevB.6.4370
- https://raw.githubusercontent.com/polyanskiy/refractiveindex.info-database/main/database/data/main/Au/nk/Johnson.yml
- https://mitsuba.readthedocs.io/en/latest/src/generated/plugins_bsdfs.html#rough-conductor-material-roughconductor

本目录DEFINITION/params先保存，再由render_layout.py调用ring_mesh.py构造真实闭环，ring_presentation.py只进行原生SVG合成。复用v1已审光谱/线性滤波/编码路径，源码随交付保存。输出位于E会话deliverables/material-physical-v1/layout-v1_3，中间OBJ/场景位于对应scratch子目录。

## 本次直接生成记录

生成未报错。实际Mitsuba3.9.1、DrJit1.5.0、NumPy2.5.4，CPU线程上限8，16×64累计1024spp，积分步骤本次3.84秒；只记录本次离线执行，不作运行性能或与旧版速度对比结论。三个网格分别为4784/5842/7406顶点、7904/9652/12236三角形，跨宽16段。真实OBJ的SHA在生成后作为几何来源记录补入generation.json；没有为此重渲染或改物理图/生成源码。

| 产物 | 实际大小（字节） |
| --- | ---: |
| small-ring-1x.png / small-ring-2x.png | 2,069 / 7,077 |
| medium-ring-1x.png / medium-ring-2x.png | 2,824 / 9,891 |
| wide-ring-1x.png / wide-ring-2x.png | 3,545 / 13,367 |
| render-linear.exr | 414,219 |
| optical-ring-study.png / .svg | 191,792 / 83,428 |

作者查看生成图后判断：中性中心保持，细边上可见亮暗反射流转，整面金色被限制为少量原生primary填色；同一环资源可与原生body和独立hover外辉光组合。图中白色body可从环的内部显现，透明中央没有被金属顶面覆盖。它展示了这份候选的几何/合成效果，最终审美与采用范围仍由负责人结合用户反馈判断，不因物理基准成立直接宣布通过。
