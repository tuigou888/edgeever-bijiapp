# 上游修复导入

[English](upstream-intake.md)

本仓库是独立二创分支，**不与 `upstream/main` 合并，也不 rebase 到上游版本**。上游 bug 修复按单个 commit 导入：独立分支、完整验证、记录台账，确认无误后才进入 `main`。

## 节奏

| 时间 | 做什么 |
| --- | --- |
| 每周 | 查看 `.github/workflows/upstream-intake.yml` 生成的报告，或运行 `bun run upstream:scan`。 |
| 每月 | 集中导入选定修复，每个逻辑修复一个独立分支。 |
| 每次导入 | 完整验证，在 `UPSTREAM_IMPORTS.md` 记录一行，然后合并。 |
| 紧急 | 安全或数据丢失修复立即移植，不受节奏限制。 |

每周工作流只读取上游并创建/评论 Issue，**不会 cherry-pick、提交、推送或合并**。

## 一次性准备

```sh
git remote add upstream https://github.com/tianma-if/edgeever.git
git fetch upstream main --tags
```

脚本会在缺少 remote 时自动添加。

## 每周扫描

```sh
bun run upstream:scan            # fix、perf、revert、安全类
bun run upstream:scan -- --all   # 所有类型，供每月集中审查
bun run upstream:scan -- --json  # 机器可读
```

扫描使用 `git cherry -v main upstream/main`，已经以补丁等价方式存在于本仓库的提交不会重复出现。用 `git show <sha>`、`git show --stat <sha>` 阅读改动。

永久忽略某个提交：

```sh
bun run upstream:scan -- --skip <sha> --reason "仅 Cloudflare 使用，本项目不需要"
bun run upstream:scan -- --list-skipped
```

忽略清单保存在 `.upstream-intake.json`，应随仓库提交。

## 哪些拿，哪些不拿

| 建议导入 | 建议跳过 |
| --- | --- |
| 安全、认证、权限、数据丢失修复 | 品牌、Logo、README、i18n 文案 |
| 同步冲突、导入导出、备份、附件 | 上游 Release 提交和 `release-summary.json` |
| 数据库一致性与迁移修复 | 上游 workflow、签名、商店交付 |
| 平台兼容与依赖安全升级 | 纯重构、大型组件重写 |
| 你实际发布的功能相关 bug | 你不需要的新功能 |

只有当你能说明“它解决了本项目的哪个真实问题”时才导入。

## 每月集中导入

```sh
git switch main
git pull origin main

bun run upstream:import -- --sha <sha> --name <short-name>
```

脚本会：

1. 要求工作区干净，创建 `upstream/<日期>-<sha>-<name>` 分支；
2. 执行 `git cherry-pick -x <sha>`，保留上游来源；
3. 运行 lint、两套 typecheck、Web 构建和非 E2E 回归测试；
4. 可选地用 `--record` 在 `UPSTREAM_IMPORTS.md` 追加一行；
5. 停在合并和推送之前。

如果发生冲突，脚本会停下并保留冲突现场：

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

对高度定制的文件，优先手工移植最小改动，不要硬解大量冲突。上游带回归测试时一并移植。手工移植后用下面命令记录，避免下次重复出现：

```sh
bun run upstream:scan -- --skip <sha> --reason "已手工移植为 <你的提交>"
```

## 验证

导入脚本会运行以下命令；手工修改后要重新运行：

```sh
bun run lint
bun run typecheck
bun run typecheck:mobile
bun run build:web
bun run test
```

按影响范围补充验证：

- **同步/冲突**：离线写入、冲突恢复、旧客户端配新服务端。
- **迁移**：用旧版本数据库启动新版本，而不只是全新安装。
- **认证**：登录、会话、Token scope、owner/member 边界。
- **资源**：上传、读取、删除、备份、恢复。

## 特殊文件

- **`package.json` / `bun.lock`**：只手工修改需要的依赖版本，运行 `bun install` 让 Bun 重新生成锁文件，不要手工合并 lockfile。
- **`migrations/`**：只增不改。编号空闲时保留上游原文件名；编号冲突时只给**尚未应用**的迁移重新编号。**已经执行过的迁移永远不要改名**，运行时会按文件名记录已应用状态。
- **`.github/workflows/`、发布脚本、`release-summary.json`**：导入时跳过。本仓库有自己的 CI 和发布链路。

## 合并与发布

```sh
git push -u origin <branch>
# 审查 PR 后：
git switch main
git merge --no-ff <branch>
git push origin main
```

bug 修复按 patch 版本发布。根 `package.json` 版本变化时必须同步 `release-summary.json`，否则 `bun run build:web` 会直接失败。

## 台账

`UPSTREAM_IMPORTS.md` 记录日期、上游提交、主题、方式、适配内容、验证结果和分支。请保持更新：它既是后续导入的审计线索，也是 AGPL 归属声明的一部分。
