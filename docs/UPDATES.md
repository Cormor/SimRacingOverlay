# 更新、hotfix 与本地模块

管理窗的“版本与更新”页可检查正式版本、下载完整更新或 hotfix、导入本地盘面和算法包。检查只更新页面状态和托盘右上角的更新标记，不自动安装、不弹通知窗口。后台启动 15 秒后检查，此后每 6 小时检查；页面也可主动检查。

正式来源固定为 [Cormor/SimRacingOverlay Releases](https://github.com/Cormor/SimRacingOverlay/releases)。预发布和草稿不参与版本提醒。下载通过 Electron 的系统代理通道。客户端从公开 Release 信息取得资产编号，经固定仓库的官方资产 API 下载清单、完整包和 hotfix；此公开接口无需用户提供 token 或 key。每项资产仍须符合本次 Release 的 tag 和文件名，API 下载以 `Accept: application/octet-stream` 接收文件或其官方重定向；不依赖 `github.com` 的浏览器下载入口。完整包、hotfix 和清单必须来自同一 Release；每项资产按清单 SHA-256 检查，重定向仅接受 GitHub 的 Release 资产服务。此哈希保证下载与该仓库发布清单一致，不能当作第三方作者签名。

更新清单 schema 1 的可选 `releaseNotes: [{version, notes}]` 由仓库 `CHANGELOG.md` 生成。发现新版本时，客户端按实际完整安装版本筛选 `(当前版本, 目标版本]` 的各版日志，并从旧到新分组显示；例如从 1.4.0 升级到 1.6.3，会依次列出该区间内的改动。历史日志缺失或格式异常时，页面保留最新版本说明并提示历史未能读取，仍可检查版本和安装有效更新。已安装当前版本时继续显示该版说明。检查确认本机与最新正式版本一致时显示“已是最新”，本机高于公开版本时显示“无需更新”；安装完成回执保留在诊断记录中，不在页面重复播报版本与重启过程。

## 完整更新

点击“更新并重启”后，应用从正式 Release 下载并校验更新，保存当前编辑，后台升级同一安装目录并自动重新启动。已下载的更新会直接进入升级。无需选择安装目录，也没有第二个安装按钮；保存拒绝或失败会保留编辑。

更新页显示下载字节数、准备与退出阶段。替换运行文件时应用会短暂关闭；更新器记录真实完成的文件复制数量，启动新版后由应用核对实际 VERSION 并显示完成结果。启动更新进程或 Launcher 只表示接续发生，不视为更新完成。错误和最后阶段保存在当前安装的 `runtime/updates/install-state.json`，重开应用后可在更新页查看；每次尝试由独立 attemptId 与目标版本关联。

应用内升级使用专用后台入口。v1.6.0 / v1.6.1 原更新入口传入的 `--root` 与 `--restart` 组合，仅在安装记录真实存在且根路径一致时识别为原位后台升级，保留旧客户端已有的下载和应用中提示；旧客户端没有新版阶段界面。重复更新进程由同一安装根的原生互斥保护，不覆写正在执行的回执。普通双击 Setup 的首次安装继续显示目录选择界面；后台升级及 PowerShell 均不打开终端或安装向导。

完整更新适用于 Electron、桌面宿主、原生采集、UI 结构或算法接口不兼容的变更。升级继续使用同一开始菜单身份，保留设置、布局、盘面、桌面配置与组件目录。完整升级后清除旧传统算法的活动选择，以新完整版本内置算法为起点；已导入包文件保留。

## 盘面替换

本地导入接受现行 `.wheel.json` / JSON 盘面：schemaVersion 1、1315×1197 PNG、既定中心、控件和灯位数据。导入不执行代码。点击应用后，盘面设置可选择新 ID；导入已有 ID 会替换该 ID 的盘面，既有布局绑定沿用。清单区分本地来源与官方来源。

盘面保存于 `assets/wheel-packs/<id>.json`；`local-index.json` 记录已导入盘面的名称、来源和内容哈希。自行替换应使用“导入本地包”，使清单和资源一起更新；只改一个缓存文件不会形成完整导入。

官方也可发布单盘面 hotfix：更新清单的 `hotfix.kind` 为 `wheel`，指向同一 Release 的盘面 JSON。它使用盘面数据协议，不要求算法 baseVersion。

## 传统算法 hotfix

算法包包含会执行的 JavaScript，仅应用你信任的来源。用户主动选择文件后，页面先展示包内容和来源，点击“应用”才写入。可以选择版本号低于当前值的本地实验包；本地实验版本不提高已安装的官方版本，也不会屏蔽未来正式更新提醒。

包格式：

```json
{
  "schema": 1,
  "kind": "simracingoverlay-hotfix",
  "version": "1.5.1",
  "baseVersion": "1.5.0",
  "files": {
    "steering-advisor.js": "实际完整模块源码"
  }
}
```

`baseVersion` 必须精确匹配当前完整应用的 VERSION。支持替换的现有算法模块为：`telemetry-context.js`、`tyre-response.js`、`steering-advisor.js`、`reserve.js`、`grip.js`、`handling.js`、`legacy-chassis-response.js`、`chassis-response.js`、`suspension-contact.js`、`realtime-response.js`、`feedback-research.js`、`pedal-traction.js`、`assist.js`、`g-ball.js`。这是现有算法的兼容更新格式；桌面宿主、preload、HTML、原生 EXE 和用户配置不能通过该格式覆盖。

多模块更新先写入 `assets/modules/<内容哈希>/` 的完整算法代际，再原子切换 `active.json`。一个 HUD 及其 Worker 在整个运行期间使用同一代际。导入本地部分算法时，其余算法继承当前代际；官方算法包以完整应用内置算法为基础，避免将本地实验代码标成官方来源。当前编辑保存成功后才切换并重载。恢复内置算法只清活动选择，保留导入文件。

开发者可从现有源码生成可直接导入的完整基线包：

```text
python tools/package-hotfix.py --base-version 1.5.0 --version 1.5.0 --output baseline.hotfix.json
python tools/package-hotfix.py --base-version 1.5.0 --version 1.5.1 --files steering-advisor.js assist.js --output patch.hotfix.json
```

这里的版本号应按实际完整版本填写。包作者负责算法之间的接口兼容，客户端会检查包结构、文件边界、基础版本和 JS 语法，但不会替作者证明算法语义正确。

## 发布者资产

常规 Windows 打包工作流会在 Setup 生成后产生 `update-manifest.json`，并与 Setup 一起上传到既有草稿 Release。可选 workflow 输入 `hotfix_base` 会将当前算法打成适配该精确完整版本的 hotfix；发布者应先确认未修改模块接口。留空只发布完整更新元数据。

手动生成清单：

```text
python tools/package-hotfix.py --setup dist/SimRacingOverlay-1.5.1-Setup.exe --version 1.5.1 --output dist/update-manifest.json
python tools/package-hotfix.py --setup dist/SimRacingOverlay-1.5.1-Setup.exe --version 1.5.1 --hotfix patch.hotfix.json --output dist/update-manifest.json
```

`--hotfix` 同时接受现行盘面 JSON，自动输出 `kind: wheel`。hotfix、Setup 与清单必须作为同一正式 Release 的资产发布。不得为了检查更新功能创建公开假版本。

## 组件、算法、表现、动画与主题扩展

`simracingoverlay-components` 包使用独立的组件 API v1，可以声明组件、算法、显示样式、动画和配色定义。它通过同一“导入本地包”入口预览，页面列出定义类型、标签和脚本文件；点击应用才安装，并等待 HUD 和 Worker 确认实际注册；加载失败时恢复原组合。主进程读取定义元数据和脚本语法，包脚本在实际 HUD / 计算 Worker 所属环境执行，不能通过这个入口覆盖桌面宿主或任意安装文件。组件选择及兼容要求见 [COMPONENT-PLUGINS.md](COMPONENT-PLUGINS.md)。

组件包及活动选择保存于 `assets/components/`。完整升级保留这些文件和选择；API 或能力组合不兼容时，组件页面给出明确错误，由用户调整兼容组合或恢复内置组件。更新页“恢复内置”同时恢复传统算法与组件；包文件保留。“组件”页的选择应用只刷新组件/HUD，并保留管理窗草稿。

官方 Release 可将组件包作为 hotfix，清单中为 `hotfix: {name, sha256, kind: "components", moduleVersion}`；`moduleVersion` 对应组件包自身版本，组件包的 API 和定义能力负责兼容性。发布者仍可用 `tools/package-hotfix.py --setup ... --hotfix <组件包.json> --output dist/update-manifest.json` 生成清单，并与包一起上传到同一 Release。
