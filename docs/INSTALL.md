# Windows 安装与复建

正式入口是 `SimRacingOverlay-1.4.1-Setup.exe`。双击后选择安装目录并安装；默认位置为当前用户文档目录下的 `AI\Apps\SimRacingOverlay`，无需管理员权限。完成后在开始菜单打开 **SimRacingOverlay**，默认进入管理窗口。安装界面与启动入口均不显示控制台。

日常使用开始菜单和托盘。重复的 `Start.cmd`、`Setup.ps1` 手动入口已移除；升级会删除本安装旧清单已登记的这两个文件。`Start-Overlay.ps1`、`Stop-Overlay.ps1` 是启动器及集成的内部依赖，继续保留。

安装器完全离线，内嵌程序文件、Electron 运行环境和卸载器。它在当前用户的 Windows“已安装的应用”中登记 SimRacingOverlay，版本沿用包内 `VERSION`。安装器不修改 OBS 场景、SimHub 插件或第三方设置，也不新增开机启动；已有属于本应用的开机启动项会保留并指向安装目录。

安装或升级先通过应用自身的退出协议保存并关闭桌面叠加层，再停止本应用的桥接、观察器与启动监视器。若桌面仍需用户处理未完成编辑，安装会显示实际错误并停止。

## 用户数据与旧入口迁移

升级保留 `settings.json`、`assets/layout.json`、`assets/wheel-packs/`、`runtime/desktop.json`、`runtime/desktop-profile/`、`runtime/integration.json` 和暂停自启动标记。安装目标已有的数据优先；迁移源只补充不存在的文件。新安装使用 `defaults/` 中的初始设置和布局。

如果安装目录原来是指向源码的目录联接，安装器会先确认联接实体，停止该实体的运行进程，仅移除联接本身，再创建独立的安装目录并迁移上述数据。源码目录及其内容保留。显式指定的迁移源必须与联接原目标一致。

从 Windows“已安装的应用”卸载时，仅删除安装登记的程序文件、开始菜单入口与属于本目录的开机启动项，保留设置、布局、盘面、桌面配置和诊断记录。保留的数据身份记录支持日后在原目录重新安装。卸载不撤销第三方 OBS/SimHub 集成。

## 从已有程序包复建

在 Windows PowerShell 5.1 中执行。构建使用系统 .NET Framework 的 C# 编译器，不下载依赖。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\build-installer.ps1 `
  -Payload 'E:\AI\release\SimRacingOverlay' `
  -OutputPath 'E:\AI\release\SimRacingOverlay-Setup.exe' `
  -ScratchPath 'E:\AI\build-scratch'
```

`-Payload` 接受已解压的应用根目录或 ZIP。ZIP 可直接包含应用文件，也可包含单个顶层应用目录。根目录至少包含 `VERSION`、`defaults/`、应用前端文件、`assets/app.ico`、`tools/Lifecycle.ps1` 以及完整 `runtime/`（包括 `SimRacingLauncher.exe`、`SimRacingBridge.exe`、`OverlayLifecycle.dll`、所需原生依赖和 `electron/`）。目录联接须在准备包时实体化；安装包不包含本机设置、布局、下载盘面、Electron 用户配置、凭据或现场日志。

构建器复制输入文件，在副本中补入当前安装和卸载脚本，生成卸载器，再将文件压缩并嵌入独立 Setup。构建不改变输入包。`-ScratchPath` 省略时使用输出目录旁的 `.installer-build`，每次构建的独立子目录在结束时清理。

## 指定路径与自动安装

```powershell
# 显示安装界面，预填安装路径和迁移来源。
$installRoot = Join-Path $env:USERPROFILE 'Documents\AI\Apps\SimRacingOverlay'
.\SimRacingOverlay-1.4.1-Setup.exe --root $installRoot `
  --migration-source 'C:\work\SimRacingOverlay'

# 自动安装：调用者等待进程结束，退出码 0 表示完成，1 表示失败。
$p = Start-Process .\SimRacingOverlay-1.4.1-Setup.exe -Wait -PassThru `
  -ArgumentList ('--quiet --root "' + $installRoot + '"') `
  -RedirectStandardError .\install-error.txt
$p.ExitCode
```

`tools/Install-App.ps1` 也支持 `-Payload <已解压根目录>`、`-InstallPath` 和 `-MigrationSource`；直接调用时程序包必须已包含构建器生成的 `runtime/SimRacingUninstall.exe`。通常使用独立 Setup 即可。静默调用失败的错误写入标准错误流；界面调用失败时直接显示错误。

## 管理窗口启动确认

启动入口等到管理窗口创建、页面加载并确认导航结果后才报告已打开。重复启动复用同一桌面会话；保存失败或设备页拒绝离开时，保留当前编辑并返回具体原因。最近一次开窗请求的标识、动作、结果与错误保存在 `runtime/desktop-status.json` 的 `lastOpenRequest`，用于区分页面加载问题与真实编辑拒绝。
