# combinewrt-packages

CombineWRT 的签名 apk 软件源与包目录站点，由 GitHub Pages 托管。

## 稳定地址

- 软件源索引：`https://wuyuzaddd.github.io/combinewrt-packages/x86_64/packages.adb`
- 签名公钥：`https://wuyuzaddd.github.io/combinewrt-packages/keys/combinewrt-feed.pub.pem`

这两个路径是其它项目（主站、安装脚本）引用的接口，发布流程不会改变它们。

## 工作方式

1. `combinewrt-build` 仓库用 ImmortalWrt 25.12.2 x86_64 SDK 构建 6 个包，上传 `packages-build` artifact（`manifest.json` + `apks/`）。
2. 本仓库的 `publish` workflow 下载该 artifact，应用 `hide.json`，生成目录数据和静态页面，把 apk 复制到 `x86_64/`。
3. 用 apk-tools 3.0.9 的 `mkndx` 以 EC P-256 私钥签名索引，随后整体通过 `actions/upload-pages-artifact` + `actions/deploy-pages` 部署。
4. 页面与索引来自同一份 catalog；被 `hide.json` 隐藏的版本两边都不会出现。

## 发布与验证

- 手工发布：`gh workflow run publish.yml -f build_run_id=<combinewrt-build run id>`。构建仓库成功后也可以用 `repository_dispatch`（`packages-built`，payload 里带 `build_run_id`）自动触发。
- 有包构建失败时默认拒绝发布；仅在明确接受残缺源时传 `allow_partial=true`。
- 客户端验证：`gh workflow run feed-test.yml`（默认取最近一次成功构建）。它在一次性 ImmortalWrt 25.12.2 rootfs 中用 apk 3.0.9 安装 6 个包，然后用一次性密钥构造三种负例：改一个字节的索引、用未知密钥重签的索引、改一个字节的 apk，三者都必须失败。
- 密钥：生产私钥只在 Actions Secret `FEED_SIGNING_KEY`；`PACKAGES_TOKEN` 用于跨仓库下载 `packages-build` artifact（只读构建产物）。
- `pages-fixture-preview` workflow 只用于手工预览 fixture 页面，不能用它覆盖生产源。

## 本地开发

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run fixture -- --out site
```

`npm run fixture` 用 `fixtures/manifest.fixture.json` 渲染一份完整的站点到 `site/`，不需要网络或 apk 工具。

生产发布只能在 CI 中完成：签名私钥只存在于 Actions Secret `FEED_SIGNING_KEY`，任何人都不能把它写进仓库或日志。

## 目录

- `src/` — TypeScript 生成器（manifest → catalog → 静态站点）
- `fixtures/` — 测试用 manifest
- `keys/` — 公开的签名公钥（私钥永不入库）
- `hide.json` — 隐藏/保留策略输入
- `.github/workflows/` — CI、fixture 页面部署、生产发布

## 许可与独立性

本仓库是 CombineWRT 的社区构建产物，与 OpenWrt、ImmortalWrt、LuCI 项目没有隶属关系。各软件包保留其上游许可证；每个包的来源仓库与 commit 会显示在详情页和目录数据中。
