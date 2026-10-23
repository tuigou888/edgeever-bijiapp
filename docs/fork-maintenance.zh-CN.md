# 独立 Fork 维护指南

[English](fork-maintenance.md)

本仓库是 [EdgeEver](https://github.com/tianma-if/edgeever) 的独立二创分支，**不合并 `upstream/main`，不 rebase 到上游版本，也不运行上游镜像更新器**。上游改动按单个 commit 审查，只有确实解决本仓库所发布功能的问题时才导入。

## 仓库模型

| Ref | 用途 |
| --- | --- |
| `origin` | 本 Fork（`tuigou888/edgeever-bijiapp`）。 |
| `upstream` | 只读参考（`tianma-if/edgeever`），永不合并。 |
| `main` | 可部署的产品分支。 |
| `upstream/<日期>-<sha>-<name>` | 每次导入一个独立分支。 |
| `vX.Y.Z` tag | 本 Fork 自己的发布版本，不跟随上游版本号。 |

原先的 `.github/workflows/sync-edgeever-upstream.yml` 镜像更新器已删除。它会用上游版本快照替换产品目录，与独立开发冲突。

## 节奏

| 时间 | 做什么 |
| --- | --- |
| 每周 | 查看 `Upstream intake` Issue，或运行 `bun run upstream:scan`。 |
| 每月 | 用 `bun run upstream:import` 集中导入选定的修复。 |
| 每次导入 | 一个独立分支、完整验证、一行台账，然后合并。 |
| 紧急 | 安全或数据丢失修复立即移植，不受节奏限制。 |

完整流程、选择标准、冲突处理和迁移规则见 [upstream-intake.zh-CN.md](upstream-intake.zh-CN.md)。

## 每周扫描

```sh
bun run upstream:scan
bun run upstream:scan -- --all    # 每月集中审查，包含所有提交类型
bun run upstream:scan -- --json   # 机器可读
```

扫描使用 `git cherry` 比较 `main` 与 `upstream/main`，已经以补丁等价方式存在的提交不会重复出现。明确不导入的提交记录在 `.upstream-intake.json`：

```sh
bun run upstream:scan -- --skip <sha> --reason "本项目不适用"
bun run upstream:scan -- --list-skipped
```

定时工作流 `.github/workflows/upstream-intake.yml` 只读取上游并创建/评论 Issue，**不会 cherry-pick、提交、推送或合并**。

## 每月集中导入

```sh
git switch main
git pull origin main

bun run upstream:import -- --sha <sha> --name <short-name>
```

脚本会：

1. 要求工作区干净；
2. 从 `main` 创建 `upstream/<日期>-<sha>-<name>` 分支；
3. 执行 `git cherry-pick -x <sha>`；
4. 运行 lint、两套 typecheck、Web 构建和非 E2E 回归测试；
5. 可选地用 `--record` 追加台账；
6. 停在合并和推送之前。

如果发生冲突，脚本会停下并保留现场：

```sh
git status
# 解决冲突
git add <paths>
git cherry-pick --continue
```

放弃本次导入：

```sh
git cherry-pick --abort
git switch main
git branch -D <branch>
```

验证通过后：

```sh
git push -u origin <branch>
# 审查 PR 后：
git switch main
git merge --no-ff <branch>
git push origin main
```

## 验证门禁

每次导入必须通过：

```sh
bun run lint
bun run typecheck
bun run typecheck:mobile
bun run build:web
bun run test
```

按影响范围补充：

- **同步/冲突**：离线写入、冲突恢复、旧客户端配新服务端。
- **迁移**：用旧版本数据库启动新版本，而不只是全新安装。
- **认证**：登录、会话、Token scope、owner/member 边界。
- **资源**：上传、读取、删除、备份、恢复。

## 发布与部署

- 版本号：根 `package.json`。
- `release-summary.json` 必须与版本号一致，并包含 `en-US` 条目；否则 `bun run build:web` 会失败。
- 移动端改动还需同步 `apps/mobile/app.json`（`expo.version`、`android.versionCode`）。
- Docker 部署使用 `compose.yaml` 加本 Fork 的 `compose.override.yaml`。
- **不要使用 `bun scripts/release.mjs`**：它默认指向上游仓库，会触发上游 Release 工作流、原生资产审计和签名检查。
- **不要运行上游的 Release、商店交付或镜像同步工作流**：它们依赖官方密钥和证书。

## 品牌与分发身份

优先修改用户可见品牌：

- `packages/shared/src/i18n/*.ts`（`appName` 及相关文案）
- `apps/web/index.html`
- `apps/web/vite.config.ts` 中的 PWA manifest
- `assets/brand/*`，然后运行 `bun run prepare:brand:icons`
- 默认笔记本、模板和 AI Prompt

如果本 Fork 要发布自己的桌面端或移动端，还要修改：

- `apps/desktop/electron-builder.yml`（`appId`、`productName`、`publish.owner/repo`）
- 桌面端更新与诊断 URL
- `apps/mobile/app.json`（name、slug、scheme、EAS owner/project、bundle ID、package、更新地址）
- `apps/mobile/src/lib/mobile-release.ts`（GitHub Release 源）
- iOS bundle identifier 与扩展商店元数据

保留 `EDGE_EVER_*` 环境变量前缀、表名、API 路径和存储键等内部标识。它们没有用户价值，改名只会增加维护成本。

## 许可证

项目使用 **AGPL-3.0**。保留 `LICENSE` 和版权声明，记录修改内容。如果将修改版作为网络服务提供，需要向使用者提供对应源码。建议添加 `NOTICE`，注明上游项目和本 Fork 的修改。

## 台账与状态文件

| 文件 | 用途 |
| --- | --- |
| `UPSTREAM_IMPORTS.md` | 人工审计记录：日期、上游提交、主题、方式、适配、验证、分支。 |
| `.upstream-intake.json` | 明确跳过的提交及原因。 |
| `docs/upstream-intake.zh-CN.md` | 详细的导入流程。 |

这两个文件都应提交，保证下一次导入从同样的决策出发。

## 紧急安全修复

1. 阅读上游提交及其测试。
2. 立即创建导入分支。
3. 如果 cherry-pick 冲突过多，手工移植最小逻辑，并补回归测试。
4. 运行完整验证，以及受影响区域的专项检查。
5. 在 `UPSTREAM_IMPORTS.md` 记录，合并并发布 patch 版本。

## 命令速查

```sh
# 每周
bun run upstream:scan
bun run upstream:scan -- --all
bun run upstream:scan -- --skip <sha> --reason "<原因>"

# 每月
bun run upstream:import -- --sha <sha> --name <short-name>
bun run upstream:import -- --sha <sha> --record

# 验证
bun run lint
bun run typecheck
bun run typecheck:mobile
bun run build:web
bun run test

# Docker 部署
EDGE_EVER_AUTH_PASSWORD='<strong-password>' \
  docker compose -f compose.yaml -f compose.override.yaml up -d --build
```
