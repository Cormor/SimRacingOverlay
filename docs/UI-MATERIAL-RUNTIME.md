# UI材质2.3运行映射

2026-11-04。公司materials2.3与v1.6物理图已采用；现行浅色为tokens2.1.0清亮白金及S02，原S01保留其时点事实。本记录对应源码接入；本机启动、实际视觉与交互结果由UI-DELIVERY中的后续记录分别说明，不以设计批准或文件保存声称运行已生效。

## 权威源、设计与运行资源

公司唯一未来维护源为gold-ring（本地共享来源；公开快照见 [设计源](../design/README.md)）及source-manifest（本地共享来源；公开快照见 [设计源](../design/README.md)），版本2.3，生成基准`Au-Johnson-Christy-1972-common-finite-soft-screen-v1.6`。真实参数、软屏、几何、光谱生成、Au数据快照/许可/provenance、依赖与SVG几何均在该包内；本项目[layout-v1_6](../design/material-physical-v1/layout-v1_6/DEFINITION.md)仅为本次实例快照，不另开未来算法维护源。

设计输入为公司materials2.3（本地共享来源；公开快照见 [设计源](../design/README.md)）、清亮白金定义（本地共享来源；公开快照见 [设计源](../design/README.md)）及[S02现行状态](../design/light-palette-v1/S02.md)。S02从真实tokens读取深浅颜色，覆盖88/144/240/376×44与完整状态，仍共用同一240缓存九宫格；[原S01](../design/material-physical-v1/layout-v1_6/S01.md)保留初次采用记录。状态SVG包含必要物理缓存，不称纯矢量；独立draw_vector的真正SVG仅为几何/工程近似，不能冒称与物理像素等价。

运行只增加[gold-ring-static@2x.png](../assets/materials/gold-ring-static@2x.png)，9420字节、480×88物理像素对应240×44逻辑尺寸@2x。直接采用已批准同场透明环原字节，非从含body/文字的板图抠图。缓存来源摘要为`54c7515e1815e46b36c75d61579cb34128b96f90820e8198b147b6d761c6f15b`，身份与几何/场景/材料来源按公司既有元数据保留；项目[meta](../assets/materials/gold-ring-static@2x.meta.json)仅调整维护引用的相对根并注明追溯角色。摘要来自已审源记录，不代表本次另跑哈希验收。

[ui-materials.css](../ui-materials.css)为公司materials.css2.3的本地vendor副本，保持相同相对资源路径。manager/setup加载顺序继续为ui-tokens、ui-foundation、ui-materials、manager.css；运行不读取公司目录、meta中的源引用、渲染器、EXR或会话临时目录。meta用于离线维护追溯，不用于定位执行依赖。

## 几何与适配

物理金属仅闭合2CSSpx边环，primary中央为主题accent-fill/on-accent-fill回退accent/on-accent的原生填色/文字，不称完整物理金属面。圆角R8、可见环2；缓存2x下分别为16/4源像素。`border-image-slice:16`对应8CSSpx角区/条带，`border-image-width:8px`仅作用绝对定位装饰层。直边条带外侧2CSSpx为可见环，向内6CSSpx透明，中心不fill，无烘焙辉光/外留白。

四角保持固定取样，直边只沿自身边长stretch。PNG alpha自身形成R8，不依赖border-image遵循border-radius；伪元素inset补偿宿主1px或1.5px border后对齐border-box。宿主border-width、padding、44px最小高和热区保持。W/H≥16CSSpx仅为该资源几何有效域，真实交互目标仍沿组件定义；88px短按钮与流动宽度均使用同一规则。

1–2x显示密度使用单张2x缓存，更高DPI仅为栅格放大近似。固定角照明及直边反射拉伸，不等于对任意尺寸、位置重新求共同光场；精确新W/H/位置可由权威算法重建。运行没有ResizeObserver、逐帧求光、第二套遥测模型或新调度。

## 控件范围与状态

仅显式采用材质的C02 .lx-button消费。概览编辑布局、完成编辑、设备保存和五类轴学习的采用为primary；原有普通显式操作仅hover细边，持续edge仅供明确强调。窗口控制、Disclosure、导航、卡片及HUD不铺材质。兼容保留lx-material-gold类名，其现义为原生primary填色加物理边环，不代表金属顶面。

默认primary/持续edge显示环，普通edge-on-hover中性。环可见时宿主border-color透明，避免原有边界在物理环半透明/抗锯齿像素下叠深线。enabled hover按显式类显示环，primary取消旧currentColor装饰内黑线，独立glow类提供外辉光。focus沿用3px outline、3px offset；hover+focus并存，辉光不替代焦点。

enabled active按住时暂隐物理环，恢复accent原生边界；不调暗主填色或物理像素，不移动控件。aria-pressed=true为持久选中，暂隐环、accent边界并保留完整3px底标记：中性按钮用accent，primary用on-accent-fill/on-accent，区别于已取消的普通hover装饰黑线。selected+hover仍保持底标记，辉光独立。

native及ARIA禁用统一整体.45透明度/not-allowed，body冻结在surface或primary语义填色，不产生基础hover背景/旧内线及新增hover/active装饰切换。原default已有primary/持续edge环与宿主一起变淡，普通hover环关闭；disabled-selected保留持久选中底标记。所有新hover/active装饰开关都排除native及ARIA禁用。loading沿用原控制器禁用与文案，不增加事件或状态机。

禁用freeze规则以同级、后加载方式覆盖基础primary:hover；selected持久规则在freeze后，保留禁用选中语义。宿主border颜色采用状态变量，避免基础active边色穿过可见环。装饰伪元素不命中、不参与无障碍内容，不取消原生outline。

## 替代与维护边界

旧M3c运行gold-surface.svg已清退，不继续加载1.58MB AI位图。原material-v2研究、公司2.0历史资产及2.1/2.2研究均保留，历史交付记录不改写。本次实现仅材料CSS、缓存/meta、HTML来源注释及维护说明，原布局/控件几何、算法、阈值、采集、插值、时钟、配置和输入输出语义保持。

运行依赖为既有CSS/脚本及这张本地PNG；无需安装渲染库。具体点实测/语法检查/截图验收未由本次接入追加，源码与设计交接为独立语义复核；本机启动和进程登记由root沿既有入口统一处理。
