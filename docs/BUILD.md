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
