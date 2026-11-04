# ffmpeg 作为 npm 平台依赖

市场安装走 pnpm，不适合在插件包里塞 200MB 的 Windows 二进制。决定依赖 `@ffmpeg-installer/ffmpeg` 与 `@ffprobe-installer/ffprobe`，由 npm 按平台安装；解析顺序仍优先显式配置、环境变量和 PATH，便于 IT 用更新版本覆盖。

**Consequences**：随包的 ffmpeg 是 4.x，需要回归字幕、混音、循环和淡入淡出；安装体积增大，但运营无需额外步骤。
