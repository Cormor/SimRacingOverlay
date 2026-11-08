# 组件算法与表现插件

本次目标是让同一组件的功能算法、显示形态、动画、配色独立组合，并将额外显示辅助单独选择，而不是把整份 HUD 算法脚本当作唯一可换单元。原有十四脚本 hotfix 继续兼容；组件包使用单独协议。

## 已有证据与设计取舍

真实油门和刹车组件是 `overlay.js` 的 `bar()` 与布局 ID `throttle` / `brake`；其边框消费 `PedalTraction.Observer` 的纵向响应观察。绿、黄、红来自可比输入下轮胎纵向力与滑移的变化，不是最优抓地力或应该收多少踏板的定量建议。原始踏板填充始终直接显示硬件输入。

职责分离依据是现有计算/准备/提交三时钟：只有新遥测推进物理历史；表现消费语义结果，动画消费结果的持续时间，主题只提供语义颜色。这样改变显示帧率不会改变判定，改变配色也不会改变事件。插件创建函数按组件实例创建状态，禁止跨组件共用观察器；换车、换源、stream epoch 和计算会话仍由既有模型生命周期重建。

## 四个独立契约

`ComponentRuntime.register(kind, definition)` 注册 `component`、`algorithm`、`presentation`、`animation`、`theme`。所有定义有唯一 ID、label、version；功能和消费者声明相同 contract 与 capabilities。当前契约为踏板响应 `pedal-traction.v1` 与原生显示适配 `hud-display.v1`，框架的注册表、选择器、实例管理不固定该契约，后续组件可注册其它契约。

- component：ID、label、contract、默认四维 selection；对应现有布局绘制位置。
- algorithm：contract、提供的 capabilities、输入 requires 与 `create({component})`；实例 `update({state,unloaded,now,baseline})` 返回结构化语义，`reset` / `dispose` 释放历史。正式车辆算法运行在唯一计算拥有者中；host固定适配器只读已有结果，预览的可选策略与演示模型具有私有状态。算法不拿 Canvas、不定时、不访问界面。
- presentation：contract、所需 capabilities、`draw({ctx,geometry,semantic,motion,tokens,scale})`。绘制范围受组件几何约束；原始踏板填充由宿主保留。踏板提供完整边框、侧向信号条和分段响应边框；原生显示组件提供原形态、实底和标注式呈现。
- animation：contract、所需 capabilities、`create()` 返回 `sample(semantic,now,reducedMotion)`。只返回透明度/辉光等表现值以及下一帧需要准备的时间；不修改语义、阈值或原始踏板。当前内置只提供即时跟随，输入、读数与状态本身的变化直接呈现。原无限呼吸、外框和行进光标没有增加可解释信息，已撤出正常目录及正式绘制；旧ID保留为即时兼容，不自动改用户配置。外部扩展仍可通过自己的表现消费有功能意义的动态。
- theme：contract、tokens。每组件提供标准、色弱配色（Protan/Deutan/Tritan独立子类型）和高对比配色；白金轨道保留兼容。配色只替换语义色值，不能改线宽、线型、透明度动画、几何或自动追加底板/标注。高对比配色本身不宣称具备完整可访问显示。

`pedal-traction.v1` 输出 `{contract, status, signal, observedAt, validUntil, eventId, reason, evidence}`；status 为 available / unavailable，signal 为 response-increasing / response-decreasing / response-plateau / sustained-slip / null。颜色只在主题中映射；旧Observer的state字段仅保留给旧路径。时间均是渲染器接收时钟，240ms 后过期；重复样本不能给观察续期。算法可提供事件身份和持续时间；动画自己决定波形，不让业务算法夹带颜色或帧序列。

默认算法 `pedal.observed-response` 逐字保留既有判定。第二策略 `pedal.force-response` 复用相同力响应计算，只关闭“严重滑移持续80ms可独立黄”的补充证据；这是更严格的证据选择，不新造赛车物理或换阈值。两种策略均可配三种踏板表现、即时跟随及上述三类主题，实际组合按契约判断。

## 选择、切换与持久化

`assets/components/active.json` 是原子快照，包含 schema、revision、generation、selection。selection 按组件 ID 保存原四维ID，另有可选assistance=none/colorblind/contrast。显示辅助仅在原图元可见时附着必要标记或紧贴实际文字的字底，不能把布局编辑bounds当成视觉卡片，不能覆盖已选的分段/整体样式及动画；配色选择不自动启用辅助。宿主验证完整组合后先保存当前布局，再一次写入并刷新唯一 HUD；失败不改选择。管理器的草稿与已生效选择分开。无文件时采用内置默认；非法文件给出诊断并显式使用默认，不悄悄把用户文件覆盖。

HUD 启动读取一次快照；worker URL 携同 generation 与 selection。worker 不另读可变 active；renderer 与 worker 固定同一插件代码和选择。正式应用通过重载重建计算与表现实例，不迁移未声明兼容的历史；预览纯表现/主题调整保留历史，换动画只重建对应动画实例，换算法重放同一预览历史。已在途旧页的结果由原有 session / feedEpoch 防止回写新页面。

## 本地组件包

JSON `{schema:1,kind:'simracingoverlay-components',id,version,apiVersion:1,files:{'plugin.js':'...'},entries:['plugin.js'],definitions:[{kind,id,label,version,contract,requires,provides}]}`。定义清单中的component还须包含defaults，theme还须包含tokens。入口仅用 basename、`.js`、无路径片段，每文件最多2MiB，总包最多12MiB；插件调用全局 `ComponentRuntime.register`。不覆盖内置ID，更新同一包时在新的不可变 generation 中替换整包。包可同时声明算法、表现、动画、主题与组件；默认组合仍可单独选择。算法与renderer会加载同一入口，因此入口顶层不能依赖 DOM；Canvas代码只在presentation.draw内执行。

导入是读包与兼容检查；应用时主进程只核对静态定义、保存新代际，并让HUD和worker载入受信任代码；普通目录读取不执行包入口。插件执行环境不是安全沙箱。包安装保留其他包、当前选择及内置定义；只有静态声明兼容完整组合才能发布，HUD/worker随后核对实际注册定义与声明；实际载入错误会恢复原选择并向管理器返回错误。恢复内置显式清除包列表与选择快照，保留下载包文件。完整程序升级保留用户目录，API不兼容包在目录中明确显示错误并要求重新导入兼容版本；不自动执行不兼容代码。

组件包新增功能需有宿主对应绘制位置与输入。当前18项真实HUD全部进入目录和实际绘制桥；油门/刹车具有两种响应策略，其余16项的host适配器读取已有结果，明确显示固定算法，不冒充新的车辆判定。适配器execution为host并声明components适用ID；物理计算拥有者跳过host适配器，场景准备阶段读取已有值，选择器与正式/预览运行均检查同一适用性。

## 使用与扩展示例

管理器的组件设置分别选择功能算法、显示样式、动画和配色，一次应用。默认组合等同现有静态边框。选择同一算法、侧向信号与即时跟随可改变显示形态而保留即时更新；改成仅轮胎力响应、相同信号与即时跟随，即比较不同算法共用表现。

完整可打包示例为 `examples/component-package/manifest.json` 与同目录 `plugin.js`；预生成可导入包为 `examples/pedal-motion.component.json`。制作命令：

```text
node tools/package-components.cjs --manifest examples/component-package/manifest.json --out examples/pedal-motion.component.json
```

该包保留为旧扩展API开发示例，不作为功能动画推荐。当前内置动态只提供即时跟随；已经导入的外部扩展按用户选择保留，不自动替换。示例不注入遥测，也不代表真实赛车判定结果。


30Hz是演示采样与表现准备的工程取值，不是车辆反应时间。额外动态必须说明它传达哪项输入变化、响应关系或状态转变；无明确用途就保留固定的即时跟随。开发包示例只说明扩展API，不作为内置功能动画的推荐。


## 18项实际内容与主题覆盖

标准保留当前外观；每项均可选Protan/Deutan/Tritan或高对比纯配色。配色在原绘制函数的画笔、渐变色标与内容层消费颜色令牌，不对整张画面施加滤镜，也不改变原分段线型或动画。非颜色辅助必须明确选择，并遵守原显隐和图元锚点；不存在的手刹/姿态提示不能因辅助而出现卡片。依据与工程色值见 `COMPONENT-ACCESSIBILITY.md`。

| 真实组件 | 实际主题作用与非颜色表达 |
| --- | --- |
| wheel | 原始照片、材质及真实灯光颜色保留；内嵌仪表、按键编号和旋钮读数消费配色，高对比辅助仅紧贴实际文字，不增加整盘卡片，不表示硬件灯色改变。 |
| brake、throttle | 原始踏板填充、百分比、标签、响应边框消费主题；显式显示辅助及新增分段样式以箭头、等号和感叹号标明响应，分段线型始终属于所选显示样式；标准默认保留当前外观，不解释为安全或驾驶指令。 |
| slip0、slip1、slip2、slip3 | 原始滑移条、百分比正负号、零线、锁止/卸载轮廓及渐变色标消费主题；附加轮位与原始百分比，未知仍为—。 |
| frontResponse、rearResponse | 原左右侧前后轮响应条、轨道、边缘与已有卸载状态消费主题；保留上前/下后，辅助仅在实际细条锚点标前/后，使用同一显示状态，不填充大交互区域。 |
| frontLateral、rearLateral | 原侧滑/侧偏角线条和中心消费主题；标示与原绘制使用相同的原生优先/估计备用取值，估计明确标注。 |
| handling | 原推头/甩尾/侧摆名称、框体和严重性图形消费主题，文本含义与触发判据保持。 |
| decel | 原实际减速数值、正负号、g单位和标签消费主题。 |
| handbrake | 原手刹标签、百分比及状态框消费主题；未触发时原内容保持不显示，辅助仅附着已显示的实际文字，手刹为0时不生成辅助卡片。 |
| statuses | 原ABS/TC/ESC及告警文字、图标、底板消费主题；适配器只读原绘制触发字段与暂停条件，设置值不能冒充触发。 |
| gBall | 原G球轨迹、包络、中心点、尺度和数值消费配色；原曲线线型不随配色变化。显式辅助叠加峰值三角与实时圆标记、横/纵g读数，不改峰值历史。 |
| flags | 原协议旗名、解释与旗语种类保留；文字、边界、底板消费主题，旗名提供稳定非颜色表达。 |
| dashboard | 原档位、RPM、速度、量程、指示位置和背景直接消费主题；独立与内嵌仪表用同一绘制实现。 |

## 当前与草稿的真实动态预览

管理器通过 `host.createComponentPreview()` 创建两份独立controller，同帧以相同time/source调用 `draw(ctx,{component,selection,time,width,height,source})`。共享provider仅生成一次不可变输入与原始scene闭包，两侧返回相同sampleId；右侧选择立刻重绘，不写选择文件、不重载正式HUD。暂停冻结时刻仍可换算法/表现/主题；更换算法使用同一有界输入历史预热，纯主题/表现调整保留算法与动画历史。

实际输入取自唯一正式HUD已经处理的快照；没有有效遥测或用户选择演示时，隔离的DrivingAssist.Model与无持久存储的GBall.Model消费明确标注的标准化演示输入。两种来源均调用原组件绘制函数，独立仪表即使布局中隐藏也可预览。演示不注入正式遥测、峰值或配置。

预览通过layout.collect隔离jobs并在finally恢复画笔、绘制参数与准备状态；轮盘预览绕过正式位图缓存，仪表采用同绘制算法的独立缓存实例。两侧各自拥有动画及可选策略状态；关闭释放，最后一个controller关闭时释放共享演示模型。`ComponentPreviewBridge.diagnostics()` 提供controller数量、实际draw/sample计数及最后sampleId，不存逐帧日志。

演示输入采用固定30Hz整数tick；provider按tick前进或重放，重复draw和左右两侧调用不会增加物理样本，不用RAF间隔生成可变步长。真实输入仅按已有样本身份保留历史。


## 独立显示辅助与兼容

`assistance`可取`none`（标准，无额外辅助）、`colorblind`（色弱显示辅助）、`contrast`（高对比显示辅助）。色弱子类型仍由独立配色ID表示；没有按三种色觉类型制造不同图形的依据，因此非颜色辅助统一使用明确标记。高对比辅助只给实际可见的文字提供紧贴字底，不创建整组件底板；原内容仍使用用户选择的配色；辅助不会替换原presentation的几何/分段线型，也不改变动画选择。

这是现有选择结构的可选字段扩展：schema/apiVersion、原四轴ID、旧组件包manifest/defaults和兼容矩阵均保持。旧配置或草稿缺少assistance时一律按none解释，不根据theme推断；读取仅返回归一化目录，不回写磁盘。只有用户明确应用才保存新字段。当前segmented+即时+Tritan等四轴值原样保留；改变theme只改变颜色，改变assistance只改变叠加辅助。辅助对三种配色都可独立启停。


## 当前演示与辅助的产品边界

默认演示按选中的组件生成连续有效输入，而不是等待所有组件共用的一条长时间轴。油门始终驱动、刹车与减速度始终制动、手刹独立非零变化、旗语持续有效单旗、状态持续至少一项实际触发、仪表与滑移/G持续有效。姿态提示用道路转角与车身yaw响应失配的标准化输入，让原v15算法得出推头提示；不直接填写最终提示。踏板的可比力响应使用2.4秒短周期，原始踏板始终可见；短暂缺少足够响应证据时仍按原算法不提示。

选择组件即重建私有演示并固定步长预热400ms，time0已有该组件内容；暂停时换组件也如此。两侧仍消费同一输入及sampleId。布局bounds只用于布局、命中和裁取，不证明应绘制整块视觉底板。原样式明确选framed/labelled时才出现它们自身承诺的外形，显示辅助不借用这些模板。全部旧选择ID继续有效，撤下的装饰ID仅即时兼容且明确显示兼容名称，读取不改用户草稿或配置。
