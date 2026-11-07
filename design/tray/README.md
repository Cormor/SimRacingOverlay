# 方向盘托盘Logo实例

采用公司方向盘图标1.0（本地共享设计来源；仓库内输入见 design/README.md），真实设计源和未来算法维护唯一入口为公司`design/icons/steering-wheel/`；本目录`wheel.svg`是本次同源灰白实例，项目`tray-wheel-icon.js`仅vendor公司纯`icon.js`，不另开未来维护源。灰白#D6D6D6/边#5B5B5B，已确认连接清亮金#F4D06F/边#876400；几何及16DIP多分辨率约定见公司定义。设计展示为公司同目录的preview.svg/png，包含深浅背景和两色。

运行图标由参数化几何一次生成双态 PNG，沿用原图标、菜单与提示样式。设备事实来自 Bridge 的唯一采集快照，HUD 汇总后经可信主 frame 发送给 `desktop-tray.js`。托盘不启动 PowerShell、不重新枚举设备，也不读取 settings.json。

金色表示原生快照中存在有效采样的方向盘：已明确绑定转向轴的设备优先，其次是 DirectInput Driving 类型及已确认产品 GUID 的 R25 Ultra FirstPerson 设备。设备目录中的存在记录不能单独证明在线；设备行需要自己的采集年龄小于 100 ms。灰白表示未确认、断开或状态中断，tooltip 说明原因。

## 状态接口

`createDesktopTray({Tray,nativeImage,tooltipSuffix,onChange})` 返回 `{tray,acceptState,invalidate,dispose,getStatus}`。主 HUD 每秒传递 `{sourceTimestamp,error,hardware,devices}`，其中包含原生采集的 epoch/sequence/有效期、转向绑定状态和每设备年龄，不传轴值、按钮或配置令牌。

HUD 在上报前将经过时间加到原生年龄上，已过期设备退出摘要。相同 epoch 的重复序号不能给采样续期，旧序号和已退出 epoch 被丢弃。相同序号的后续报告只允许移除已过期设备或增加错误，不能恢复连接。`sourceTimestamp` 仅保留为来源形状字段，不再用发送时钟证明硬件新鲜。

100 ms 是摘要生成时的采样有效期；托盘自身每秒消费状态，3 秒用于识别 HUD 进程通信中断，不能把这两种期限混为一谈。主进程验证可信 HUD 和当前 mainFrame 后接受摘要；导航和 renderer 退出使当前报告失效，实际退出时释放计时器与 Tray。取消退出不会提前销毁资源。

`getStatus` 仅返回 connected、reason、可选 confirmedName 和初始化图像非空标记；状态变化才更新图标、tooltip 与桌面状态文件。此处不生成逐帧日志。原生采集、前端摘要和托盘协议须随同一版本交付。
