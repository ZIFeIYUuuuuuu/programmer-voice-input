# Voice Input

一个轻量级的 Tauri + React 桌面语音输入悬浮窗，面向程序员在写 prompt、issue、review comment 时快速口述文本。

应用默认只显示一个置顶悬浮 HUD。通过快捷键或按钮开始说话，实时显示识别文本，结束后按设置复制或自动粘贴到当前输入位置。

## 下载

Windows 安装包可在 [GitHub Releases](https://github.com/ZIFeIYUuuuuuu/programmer-voice-input/releases/latest) 下载。

- 推荐普通用户下载 `Voice.Input_0.1.0_x64-setup.exe`。
- 需要 MSI 部署时下载 `Voice.Input_0.1.0_x64_en-US.msi`。

当前版本安装包未做代码签名，Windows SmartScreen 首次运行时可能提示风险。请只从本仓库 Releases 页面下载。

SHA-256：

```text
Voice.Input_0.1.0_x64-setup.exe     7F9CBE81A508D0292C00C72E1AF0DB8853FDD35AA2FC27C28E5714238A7AFC95
Voice.Input_0.1.0_x64_en-US.msi     9FD34AE4B6D9299DC06688B0782D30A57A9EC2C75AD16A695048BC1F6CA26715
```

## 功能

- 桌面悬浮窗：轻量、置顶、可拖动。
- 实时语音转文字：使用阿里云 DashScope Qwen ASR realtime 模型。
- 可选润色：默认关闭，低延迟优先。
- 自动粘贴：写入剪贴板后尝试模拟 `Ctrl+V`。
- 最近记录：最多保留最近 20 条，可在隐私设置里关闭跨重启保存。
- 剪贴板日志：默认关闭；开启后追加写入安装目录下的 `logs/clipboard-history.jsonl`。
- 本地设置：API Key 只保存在本机应用数据目录，不写入源码。

## 环境要求

- Windows 10/11
- Node.js 22 或更高版本
- npm
- Rust toolchain
- Visual Studio C++ Build Tools
- 阿里云 DashScope API Key，并开通 Qwen ASR 权限

## 本地运行

一键启动：

```text
start.vbs
```

`start.vbs` 不会显示终端窗口，适合日常使用。需要查看开发日志时再使用：

```bat
start.cmd
```

如果已经有 release 构建，脚本会启动：

```text
src-tauri\target\release\voice.exe
```

如果 release 构建不存在，脚本会回退到 Tauri dev 模式。

开发模式：

```bat
dev.cmd
```

## 配置 API Key

1. 启动应用。
2. 右键悬浮窗，打开 Settings。
3. 在 `DashScope API Key` 输入框粘贴你的 key。
4. 点击 Save。

不要把真实 API Key 写进 `.env`、README、issue、截图或提交记录。设置页只显示 `Saved locally`，不会展示 key 的前后缀。

## 构建

```bash
npm run lint
npm run build
npm run tauri build
```

Windows 上如果 `cargo` 或 MSVC linker 不在 `PATH`，先加载 Visual Studio build environment，或直接使用仓库里的 `scripts/start-dev.ps1` 作为参考。

构建产物位于：

```text
src-tauri/target/release/bundle/
```

更多发布步骤见 [docs/RELEASE.md](docs/RELEASE.md)。

## 开源发布

仓库已经包含：

- MIT License
- GitHub Actions release workflow
- `.env.example`
- `SECURITY.md`
- `CONTRIBUTING.md`
- 本地隐私清理脚本

发布到 GitHub 时建议：

1. 初始化 Git 仓库并提交源码。
2. 确认没有真实 API Key、音频、转写记录或构建产物。
3. 推送 tag，例如 `v0.1.0`。
4. 在 GitHub draft release 中检查 Windows 安装包。

当前 Windows 安装包未签名，首次运行可能触发 Windows SmartScreen 提示。面向更多用户分发前，建议购买代码签名证书并接入签名流程。

## 隐私

- 音频会流式发送到 DashScope 做实时识别。
- 应用默认不保存音频文件。
- “不保存历史”开启时，最近记录只保留在当前运行会话。
- “保存剪贴板日志”开启时，每条转写结果会追加到 `logs/clipboard-history.jsonl`。
- API Key 存在本机应用数据目录的 `settings.json` 中，不会提交到仓库。
- 本地 key、history、session storage 可通过脚本清除：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/clear-local-secrets.ps1
```

## 故障排查

### 麦克风权限被拒绝

打开 Settings，点击 `打开 Windows 麦克风权限设置`，确认 Windows 允许桌面应用访问麦克风。

### 自动粘贴到了错误位置

自动粘贴依赖当前 Windows 焦点窗口。即使粘贴失败，文本也会尽量保留在剪贴板里。

### 实时输出太敏感

提高 VAD threshold，例如从 `0.30` 调整到 `0.45`。

### 一句话结束太慢

降低 silence duration，例如从 `600` ms 调整到 `400` ms。这个值只控制实时识别分段，不会自动停止录音；录音会一直持续到你手动停止。
