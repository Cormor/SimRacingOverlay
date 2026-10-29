# Windows 构建

需要 Windows 10 / 11 x64、.NET Framework 4.8（系统组件）、PowerShell 5.1、Python（构建可选灯色观察器时）、已安装的 SimHub SDK。

1. 将 SharpDX 4.2.0 的 `SharpDX.dll`、`SharpDX.DirectInput.dll` 放入 `runtime`。
2. 从 Electron 官方发布页下载 `electron-v44.9.0-win32-x64.zip`，用同一发布页的 SHASUMS256.txt 核对，解压到 `runtime/electron`，保留 LICENSE 和 LICENSES.chromium.html。
3. 构建桥接与插件：

```powershell
.\tools\build.ps1 -SimHubPath 'C:\Program Files (x86)\SimHub'
```

4. 可选灯色观察器：在 Python 虚拟环境安装 `frida==17.2.17`、`pyinstaller`，执行：

```powershell
python -m PyInstaller --clean --onefile --noconsole --name MozaLedObserver --distpath runtime --workpath build/observer --specpath build --paths src src/led_tap.py
```

5. 安装器需要正式包的 `PAYLOAD.json` 文件清单；使用 `tools/package.py` 制作发行包。清单只涵盖发布文件，不包括个人配置与运行数据。完整源码被放入包内的 `source`，不依赖外部仓库持续可访问。

可运行 `node --test tests/public-portable.test.js` 检查新接入的纯计算逻辑。硬件协议和游戏数据是否可用仍需在目标电脑核对。

遥测变更的针对性检查：运行 `powershell -NoProfile -File tools/test-telemetry.ps1`，再运行 `node src/test_adaptive_telemetry.js`、`node src/test_assist.js` 和 `node src/test_realtime_response.js`。C# 检查产物仅写入被 Git 忽略的 `build/telemetry-tests`。

渲染与传输变更还需运行 `node src/test_dashboard_cache.js`、`node src/test_paint_opacity.js`、`node src/test_overlay.js`、`node src/test_overlay_stream.js` 和 `node src/test_telemetry_processor.js`。用项目 Electron 执行 `tools/test-renderer.cjs --pixels-only` 核对局部绘制及素材缓存；`--recovery-only` 核对浏览器传输恢复。完成 C# 遥测检查后，`--native-only` 使用无设备的独立测试进程验证原生事件流。基准与证据范围见 `docs/IRACING-PERFORMANCE.md`。

## GitHub 上生成安装包

在 Actions 中运行 **Package Windows release**，从当前提交构建桥接与启动器，再生成安装包并上传到指定草稿 Release。Electron、SharpDX、未变化的可选观察器及 SimHub 插件从校验过的基础包恢复；这些组件对应的源码须保持一致。修改过的原生 C# 组件在 Windows runner 上重新编译，`native-build.json` 将二进制与实际源码绑定。

打包包含运行时、PNG 轮盘、仪表样式、相对屏幕的布局预设和完整源码。检查针对账号路径、账户标识、密码、密钥与令牌；可分享的样式和配置不会因“个人偏好”被排除。发布前应在干净解压目录运行 `Start.cmd`，确认默认文件自动生成、当前包的桥接启动、图片加载、画面可见和中下方布局。

## 重新生成 README 展示图

在仓库根目录使用包内 Electron 执行：

```powershell
.\runtime\electron\electron.exe .\tools\render-readme.cjs
```

生成器在隐藏的离屏窗口中加载实际界面，注入固定随机种子的模拟数值，再由 `OffscreenCanvas.convertToBlob` 导出 `docs/images/overview.png`、`states.png` 和 `flags.png`，不调用截图接口。状态分别触发，展示用数据组合了不同数据源支持的能力；不会连接设备、实时桥接或修改用户布局。生成记录保存在被 Git 忽略的 `build/readme-render`。


1.3.0 的打包脚本会额外生成清单中的 `*.wheel.json` 与相应校验行，上传脚本将这些文件与主包一起上传到同一版本草稿。`wheel-packs/` 中的原创源素材和 `assets/wheel-packs/` 下载缓存均不进入主程序 ZIP；发布前核对包内默认只有原款。Windows界面验收可将独立盘面JSON作为显式输入，参见 [WHEEL-FACES.md](WHEEL-FACES.md)。
