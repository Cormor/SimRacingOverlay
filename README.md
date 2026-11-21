# SimRacingOverlay

适用于 Windows 的赛车遥测叠加层。实时显示方向盘、踏板、车速、挡位和转速，也可按游戏提供的数据显示四轮滑移、转向趋势、辅助状态和 G 力。HUD 可以显示在桌面上，也可以作为 OBS 浏览器源使用。

[下载最新 Windows Setup](https://github.com/Cormor/SimRacingOverlay/releases/latest) · [版本记录](CHANGELOG.md) · [安装说明](docs/INSTALL.md)

## 安装与使用

1. 在 GitHub Release 的附件中下载 `SimRacingOverlay-<版本>-Setup.exe`。安装包包含所需运行环境，支持离线安装，可选安装目录。
2. 从 Windows 开始菜单启动 **SimRacingOverlay**。单击托盘图标可打开管理窗口，右键菜单可显示或隐藏 HUD、编辑布局或退出叠加程序。关闭管理窗口后，HUD 和采集服务继续运行。
3. 在「设备输入」里确认方向盘和踏板读数。需要绑定时，学习对应的轴，采用后保存设备设置。方向盘、踏板和手刹可以来自不同的 DirectInput 设备。
4. 按默认快捷键 **Ctrl+Alt+M** 进入或完成布局编辑。拖动、缩放或旋转组件，可按需调整显示器、显隐和透明度。「显示与连接」可修改或取消布局编辑、HUD 显隐和重置 G 峰值的快捷键，也可复制 OBS 浏览器源地址。

安装版和便携版共用 `%USERPROFILE%\.lixing\SimRacingOverlay`。首次使用共享目录时，旧设置、校准、布局、盘面和组件会迁入，已有共享配置优先。使用中的桌面 HUD 和 OBS 输出可独立显示。 [Windows 安装说明](docs/INSTALL.md)

## HUD 与盘面

- **驾驶数据**包括基础仪表、四轮滑移、前后轴响应、转向状态、减速度和 G 力。可显示的项目取决于游戏实际提供的数据。转向、踏板和仪表等常规读数短时缺样时保持最后一个有效值，最长 1 秒，新读数到达后立即更新。
- **布局编辑**支持多选、对齐、整体移动、复位以及布局 JSON 导入和导出。各组件可以独立移动、缩放、旋转、锁定、显隐和调整层级。
- **方向盘**可切换已安装盘面，下载可用的盘面，或按盘面单独设置按键映射。无屏盘面可搭配独立仪表。 [方向盘盘面](docs/WHEEL-FACES.md)
- **组件样式**可用同一输入并排对照当前效果和草稿，再应用当前组件。可选项因组件而异，包括显示样式、配色、显示辅助及适用的算法和动画。 [组件样式与扩展](docs/COMPONENT-EXPERIENCE.md)

下图由实际 HUD 离屏渲染，使用模拟数据展示布局与驾驶反馈。

![HUD 预览：轮盘、挡位、车速、转速、踏板、四轮滑移和 G 力](docs/images/overview.png)

[驾驶状态示例](docs/images/states.png) · [iRacing 旗语示例](docs/images/flags.png)

## 游戏与设备接入

| 来源 | 接入方式与显示范围 |
| --- | --- |
| Assetto Corsa Rally（ACR） | 自动读取本机共享内存，显示基础遥测和游戏提供的逐轮物理数据。 |
| iRacing | 自动读取本机 SDK 数据，支持基础遥测及中文旗语。部分轮胎响应使用车身运动和转向输入估计。 |
| F1 25 | 在游戏中选择 2025 UDP 格式，建议 60 Hz，并在 SimHub 增加转发目的地 `127.0.0.1:20778`。 |
| 其他 SimHub 支持的游戏 | 接入 SRO 的 SimHub 插件后，可显示游戏实际提供的仪表、踏板和运动数据。 |

方向盘、踏板和手刹可以独立于游戏遥测显示。支持相应灯光协议的 MOZA 设备可选用只读灯色观察。轮胎余量和推头、甩尾提示用于观察趋势。 [遥测接入与数据范围](TELEMETRY.md)

## 更新、卸载和数据

在管理窗口的「版本与更新」检查 GitHub 正式版本。应用先验证发行清单的签名，再核对下载文件的摘要。更新由用户确认，完整升级沿用原安装目录和共享配置。 [更新与本地扩展](docs/UPDATES.md)

在 Windows「已安装的应用」中卸载 SimRacingOverlay，用户设置和布局留在共享配置目录。采集服务仅监听本机，遥测保留在本机。分享故障材料时，请先检查其中的设备名称、路径和遥测。

## 支持开发与源码

管理窗口侧栏的「支持开发」提供自愿支持入口。 [支持开发](docs/SUPPORT-DEVELOPMENT.md)

[构建说明](docs/BUILD.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

自研部分采用 **Non-Commercial Source-Available License 1.0**，允许个人非商业使用，商业使用须获得授权。 [许可证](LICENSE) · [商业授权](COMMERCIAL-LICENSE.md)
