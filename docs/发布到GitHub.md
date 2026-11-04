# 发布与安装（私有仓库 + 自建索引）

目标：代码留在私有 GitHub 仓库；同事的 DSH 里出现一个「内容生产」安装入口，点一下就装好、能更新。

## 1. 私有代码仓库

把 `content-studio/` 推到私有 GitHub 仓库，例如：

```bash
git remote add origin https://github.com/your-org/content-studio.git
git push -u origin main
```

`package.json` 已经声明：

- `dsh.bundle.patch` → `cordis.patch.yml`
- `dsh.client` → `client.js`
- `engines.dsh` → `>=0.2.1-rc.4 <0.3.0`
- `@ffmpeg-installer/ffmpeg` / `@ffprobe-installer/ffprobe` 依赖

安装时 pnpm 会按平台装好 ffmpeg，不需要同事手动放二进制。

## 2. 公开的 metadata 索引仓库

新建一个**公开**仓库（只放索引，不放代码），例如 `content-studio-index`：

```
content-studio-index/
├─ index.json
└─ icon.svg        # 可选；脚本默认把 icon 内联成 data URL
```

开启 GitHub Pages（Settings → Pages → Deploy from branch → `main` / `/`）。

## 3. 生成索引

先在代码仓库提交并推送，拿到 40 位 commit：

```bash
git rev-parse HEAD
```

在 `content-studio/` 下生成索引：

```bash
node tools/make-index.mjs \
  --repo https://github.com/your-org/content-studio \
  --commit <40位commit> \
  --output ../content-studio-index/index.json
```

把 `index.json` 提交到公开索引仓库。索引里只有插件名、描述、图标和私有仓库地址；**代码和 key 都不会公开**。

## 4. 同事安装

1. 打开 DSH 的 **插件 → 发现**（旧版本在 **设置 → 插件**）。
2. **添加索引源**，填 GitHub Pages 地址：
   `https://your-org.github.io/content-studio-index/index.json`
3. 搜索「内容生产」，点 **安装**。
4. 左侧栏出现「内容生产」，点开就是总控台。

私有仓库需要同事的 Git 凭证可访问；如果 Git 没配置凭证，安装会明确失败。

## 5. 升级

改代码 → 提交推送 → 用新 commit 重新生成 `index.json` → 推索引仓库。
同事的插件页会出现「有新版本」，点更新即可；`~/.content-studio` 里的批次和配置保留。

## 6. 排查

- 安装失败先看 DSH 的插件日志；索引源页面会显示格式错误和具体 JSON 路径。
- `engines.dsh` 与当前 DSH 不匹配时，市场会拒绝安装；先升级 DSH。
- 索引文件必须是 UTF-8 JSON，`format` 为 `1`，通过 https 返回，不能重定向。
