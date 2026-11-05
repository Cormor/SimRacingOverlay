# Au-JC1972：固定光谱物理生成基准

状态：场景定义和生成源码已由root独审批准；2026-11-03完成唯一固定场景的离线生成。外观采用范围待负责人判断。原DIAGNOSIS.md及M2/M3记录保留，本稿不覆盖运行资产。

## 材料基准与工程选择

材料数据来自Johnson与Christy，1972，DOI https://doi.org/10.1103/PhysRevB.6.4370。使用refractiveindex.info维护者公开录入的Au/Johnson.yml，CC0、室温，不称实验室原始数据仓。原始URL为https://raw.githubusercontent.com/polyanskiy/refractiveindex.info-database/main/database/data/main/Au/nk/Johnson.yml；取得时记录时间、内容SHA256与能取得的仓库commit。波长µm乘1000转nm，完整n/k以线性插值光谱显式传入roughconductor；不以Mitsuba内置Au或手选RGB代替。

Mitsuba3.9.1、drjit1.5.0，llvm_ad_spectral CPU。GGX alpha=0.02、specular_reflectance=1。alpha是本次抛光工程选择，没有声称对应实测加工粗糙度；无AI纹理、颜色贴图、噪声法线或划痕。成熟路径追踪用于实测光谱和光输运积分，不据此否定旧模型已成立的GGX/PDF公式。

## 唯一固定场景

params.json为真实输入，脚本先读取它，再生成网格和实际场景；修改输入会进入对应构造，不再只写一个跑完才生成的参数记录。

- 物体投影目标120×22mm，厚0.8mm，圆角4mm，顶倒角宽0.8/高0.4mm，中央真平面。八个几何倒角分段与32个每角分段，显式顶点法线。先Y乘sec8°再绕X=-8°，保留正交投影比例；真实几何不靠图上白条表达。
- 正交前视，相机(0,0,0.20)m看向原点，上方+Y；视区横宽0.132m，纵向由960:176派生。
- 正面法线(0,sin8,cos8)，镜面方向(0,sin16,cos16)。在z=.25m灯面，片面理想镜面落点y约.0602–.0831m；主灯真实y边界.064–.100m穿入该范围。灯的投影远离相机视区，不挡住片面。
- 主D65面积灯中心(0,.082,.25)m，尺寸.140×.036m，朝-Z，scale1；副灯(.045,.072,.25)m，尺寸.015×.050m，朝-Z，scale.18；D65弱环境scale.02。
- 相机直接背景通过path的hide_emitters隐藏以保存物体覆盖alpha；反射路径仍采样灯和环境，不将光源调色画进表面。

几何尺寸、alpha、灯位/面积/相对强度、曝光与采样均为固定工程输入，不是材料测量结果或唯一审美答案。实测数据约束材料响应，固定场景提供可复现参考，真实实物/照明外观匹配仍需相应实测条件。

## 积分、输出与显示边界

960×176，1024spp，固定seed20261103，path max_depth8。总采样以16次64spp的同一场景线性film累计，pass seed为base+index；不是参数矩阵。box像素滤波与四倍级空间采样覆盖窄倒角，1024spp不保证无噪声。

保存float32线性RGBA EXR、实际解析后的场景字典、输入JSON、来源文件与生成脚本版本。EXR不做Reinhard、趋白、饱和度或辉光。显示固定0EV、标准sRGB；超出显示范围只作明确编码边界裁剪，线性EXR仍保留原值。

相机留10%视区边距。原尺寸240×44表面由投影正面矩形做线性辐亮度/覆盖面积滤波后，再解除预乘并编码sRGB；不平均gamma编码像素。大材质片保留960×176原始渲染视区，且注明边距；同一物体与固定灯/曝光，不另外换大块几何。

黑白上下文用原生SVG组合相同的原尺寸表面。UI外框、热区与hover辉光沿用既有原生定义，物理素材不烘焙UI发光。这里只交设计源和离线图，不改应用行为、算法或运行版。

## 来源与文件

- https://mitsuba.readthedocs.io/en/latest/src/generated/plugins_bsdfs.html#rough-conductor-material-roughconductor
- https://mitsuba.readthedocs.io/en/latest/src/generated/plugins_spectra.html
- https://raw.githubusercontent.com/mitsuba-renderer/mitsuba3/v3.9.1/src/sensors/orthographic.cpp
- https://raw.githubusercontent.com/mitsuba-renderer/mitsuba3/v3.9.1/src/integrators/path.cpp

最终源码在本目录；数据、中间网格及场景在E会话scratch/material-physical-v1，EXR和设计交付在deliverables/material-physical-v1。既有renderer-env只读取执行，不重装。E公共索引锁归属未知的例外沿用root既有记录，本任务不写共享索引。
## 离线计算与运行消费边界

本次为离线预计算：材质、局部几何和固定灯场景形成同一基准，运行只消费静态贴图并由原生控件负责几何、文字与状态。用户拖动布局不重新求光，渲染器不进入遥测或界面绘制时钟，也不引入实时shader。Mitsuba、DrJit、NumPy和8线程上限均为离线生成工具及资源选择，不是产品运行依赖。

本次生成240×44原尺寸表面、960×176大材质片和1200×780说明图，并保留线性EXR；生成后记录实际文件大小，供下游选择运行资产。仅少数主按钮按需采用金属表面，普通控件保持中性底。hover辉光是局部状态效果，不连续求光；focus保留原生outline。这里没有运行性能测量，不声称零成本或具体提速。

## 本次直接生成记录

实际工具版本为Mitsuba3.9.1、DrJit1.5.0、NumPy2.5.4；DrJit CPU线程上限8。1024spp分16次线性累计，积分步骤用时6.92秒；该时间仅为这一次离线运行，不代表产品运行成本。生成未报错，记录位于E会话deliverables/material-physical-v1/generation.json。

GitHub commit查询返回403限流，故commit如实记录为null。原始数据通过raw URL取得，UTC时间2026-11-03T07:59:32.933219+00:00，原字节SHA256为9f4bdab6bd49f7c6a1c48b5fb5482c7448caf4b6de39594a34ecd66dcf592774；原文件、许可和来源记录保存在scratch/material-physical-v1/data，不将取得失败的commit描述为已固定。

| 文件 | 大小（字节） | 用途 |
| --- | ---: | --- |
| surface-native.png | 10,937 | 240×44原尺寸透明表面 |
| render-display.png | 211,381 | 960×176含边距显示图 |
| render-linear.exr | 1,655,641 | float32线性RGBA |
| physical-study.png | 305,558 | 1200×780黑白上下文设计板 |
| physical-study.svg | 313,115 | 自包含设计板源 |

作者查看生成图后的判断：原尺寸较干净，正面具有左亮右暗与底部暗反射；整体仍偏柔和香槟色，大材质片可见细采样噪声。本结果建立了可追溯材料与实际光输运基准，没有因此自动满足用户要求的最终抛光金外观；采用或进一步调整由负责人基于这份图判断。

