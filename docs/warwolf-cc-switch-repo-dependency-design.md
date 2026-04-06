# Warwolf 依赖 CC Switch 仓库设计方案

## 1. 目标

目标不是“把 `cc-switch` 代码拷进 Warwolf”，而是建立一条长期可维护的上游依赖关系：

1. `cc-switch` 作为独立上游仓库持续演进
2. Warwolf 依赖 `https://github.com/wangedoo518/cc-switch`
3. 授权、账号池、provider 投影、proxy、takeover 等能力以 `cc-switch` 为准
4. Warwolf 不再自己维护第二套同构中台
5. 本地开发时可以直接联调：
   - `cc-switch` 本地源码：`/Users/champion/Documents/develop/Warwolf/cc-switch`
   - Warwolf：`/Users/champion/Documents/develop/Warwolf/open-claude-code`

这份文档讨论的是“仓库边界和依赖方式”，不是单点功能实现。

## 2. 现状判断

## 2.1 `cc-switch` 当前是单体桌面应用，不是现成 SDK 仓库

从本地源码看：

- 前端只有一个根包：[package.json](/Users/champion/Documents/develop/Warwolf/cc-switch/package.json)
- `pnpm-workspace.yaml` 为空包工作区：[pnpm-workspace.yaml](/Users/champion/Documents/develop/Warwolf/cc-switch/pnpm-workspace.yaml)
- Rust 侧也只有一个 Tauri crate：[Cargo.toml](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/Cargo.toml)
- 入口仍是 Tauri app builder：[lib.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/lib.rs)

这说明今天的 `cc-switch` 仓库虽然“代码很多、能力很全”，但并不是一个天然适合被 Warwolf 直接 `git dependency` 的模块化上游。

## 2.2 `cc-switch` 里已经有很强的可复用核心

虽然仓库形态是单体，但核心业务已经很清晰：

- provider/domain：
  - [provider.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/provider.rs)
- database / SSOT：
  - [database/schema.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/database/schema.rs)
- provider service：
  - [services/mod.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/services/mod.rs)
  - [services/provider/live.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/services/provider/live.rs)
- proxy / forwarding：
  - [proxy.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/services/proxy.rs)
  - [forwarder.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/proxy/forwarder.rs)
- auth center：
  - [commands/auth.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/commands/auth.rs)
  - [copilot_auth.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/proxy/providers/copilot_auth.rs)

一句话：

- `cc-switch` 现在已经有“中台核心”
- 但这个核心还没从“桌面壳层”里拆出来

## 2.3 Warwolf 当前不适合直接依赖整个 `cc-switch` app

Warwolf 自己也是桌面应用，而且已有自己的 Rust/前端壳层：

- 模型服务：[ProviderSettings.tsx](/Users/champion/Documents/develop/Warwolf/open-claude-code/apps/desktop-shell/src/features/settings/sections/ProviderSettings.tsx)
- Code Tools：[index.ts](/Users/champion/Documents/develop/Warwolf/open-claude-code/apps/desktop-shell/src/features/code-tools/index.ts)
- Tauri backend：[main.rs](/Users/champion/Documents/develop/Warwolf/open-claude-code/apps/desktop-shell/src-tauri/src/main.rs)

如果直接把 `cc-switch` 整个 Tauri app 当依赖，会立刻遇到问题：

1. Tauri app 不能自然嵌入另一个 Tauri app
2. `cc-switch` 的 UI、托盘、窗口、deeplink 生命周期不该混进 Warwolf
3. 数据目录、端口、全局状态、单例约束会冲突
4. Warwolf 会被迫依赖 `cc-switch` 的 UI 组织，而不是业务能力

所以：

- Warwolf 不应该直接依赖 `cc-switch` 整仓“应用态”
- Warwolf 应该依赖 `cc-switch` 仓库里拆出来的“core + daemon + client contract”

## 3. 推荐结论

推荐把 `cc-switch` 演进成“服务优先的上游 monorepo”，然后 Warwolf 依赖它的稳定子产物，而不是依赖整仓 app。

最终关系应该是：

- `cc-switch` 仓库 = 上游
  - `cc-switch-core`
  - `cc-switch-daemon`
  - `cc-switch-client`
  - `cc-switch-desktop`
- Warwolf = 下游消费者
  - 消费 `cc-switch-daemon` API
  - 或链接 `cc-switch-client` SDK
  - 不直接读 `cc-switch.db`
  - 不直接 import `src-tauri/src/lib.rs` 这种 app 入口

## 4. 仓库级架构设计

## 4.1 推荐目录演进

建议把 `cc-switch` 仓库逐步演进成下面的结构：

```text
cc-switch/
  packages/
    cc-switch-contract/
    cc-switch-client-ts/
  crates/
    cc-switch-core/
    cc-switch-daemon/
    cc-switch-client-rs/
    cc-switch-desktop/
  apps/
    desktop/            # 如果未来要把前端再整理
```

### `cc-switch-core`

职责：

- auth provider registry
- account store / binding
- provider projection
- proxy service
- takeover orchestration
- database / keychain abstraction
- model catalog discovery

约束：

- 不依赖 Tauri UI 生命周期
- 不直接暴露 Tauri command
- 可被 daemon 和桌面壳层复用

### `cc-switch-daemon`

职责：

- 把 `cc-switch-core` 能力暴露成稳定本地 API
- 管理本地单例进程
- 统一 socket/port
- 负责授权流程、账号状态、运行时 profile、proxy/takeover 控制

形式：

- 本地 HTTP API 或 Unix domain socket / named pipe

推荐：

- macOS/Linux：Unix socket 优先
- Windows：named pipe 或 localhost fallback

### `cc-switch-client-ts`

职责：

- 给 Warwolf 前端或任何 TS 客户端的类型和 API 封装

### `cc-switch-client-rs`

职责：

- 给 Warwolf Rust backend 的 daemon client

### `cc-switch-desktop`

职责：

- 保留当前 `cc-switch` 桌面应用
- 但它只是 `core + daemon` 的宿主 UI

这一步的意思是：

- `cc-switch` 自己继续能跑桌面应用
- Warwolf 同时可以依赖它的核心服务
- 两边共享同一套中台能力

## 4.2 为什么推荐 daemon，而不是让 Warwolf 直接 link `cc-switch-core`

理论上有两条路：

### 方案 A：Warwolf 直接链接 `cc-switch-core`

优点：

- 没有额外进程
- 调用成本低

缺点：

- Warwolf 和 `cc-switch` 桌面端会变成两份宿主
- 同时争夺 `~/.cc-switch` 状态、DB 连接、proxy 生命周期
- 版本升级和状态迁移更容易出宿主冲突
- 未来第三方消费者无法复用

### 方案 B：Warwolf 依赖 `cc-switch-daemon`

优点：

- 单一运行时宿主
- 单一 SSOT
- 单一 proxy / takeover 控制面
- Warwolf、`cc-switch` 桌面端、未来 CLI 或其他 app 都能复用
- 更符合“上游中台、下游消费”的关系

缺点：

- 多一个本地进程
- 需要 API 版本管理

推荐结论：

- `core` 必须拆
- 但 Warwolf 主要依赖 `daemon + client contract`
- 不建议让 Warwolf 直接嵌入 `cc-switch-core` 当第一形态

## 5. Warwolf 如何依赖 `cc-switch` GitHub 仓库

## 5.1 开发态依赖

开发时建议：

1. Warwolf 指向本地 `cc-switch` 源码目录
2. 启动 `cc-switch-daemon` 本地开发实例
3. Warwolf 通过环境变量连接这个实例

建议约定：

- `CC_SWITCH_DEV_REPO=/Users/champion/Documents/develop/Warwolf/cc-switch`
- `CC_SWITCH_API_ENDPOINT=unix:///...` 或 `http://127.0.0.1:xxxxx`
- `CC_SWITCH_API_VERSION=v1`

这样本地开发可以做到：

- 改 `cc-switch` 源码，Warwolf 立即联调
- 两个仓库独立提交
- 不需要把源码拷来拷去

## 5.2 生产态依赖

生产态建议分两层：

### 二进制依赖

Warwolf 打包时附带匹配版本的 `cc-switch-daemon`

来源可以是：

- GitHub Release artifact
- 或 Warwolf build pipeline 按固定 git rev 编译

### 协议依赖

Warwolf 只依赖：

- `cc-switch` API contract
- `cc-switch-client-rs`
- 或 `cc-switch-client-ts`

而不是依赖仓库内部路径和私有模块。

## 5.3 版本策略

推荐：

### 开发期

- Warwolf pin `cc-switch` git revision

### 稳定后

- Warwolf pin `cc-switch` semver tag

### 兼容保证

每个 Warwolf 版本明确声明兼容的：

- `cc-switch-daemon API version`
- `cc-switch core schema version`

## 6. API 合同设计

Warwolf 不应该直接调用 `cc-switch` 当前的 Tauri command 名称；应该依赖更稳定的 daemon API。

建议 API 分 4 组。

## 6.1 Auth API

职责：

- 官方授权
- 多账号
- 默认账号
- 刷新/删除/导入

建议：

- `POST /v1/auth/providers/{provider}/login/start`
- `POST /v1/auth/providers/{provider}/login/poll`
- `GET /v1/auth/providers/{provider}/accounts`
- `POST /v1/auth/providers/{provider}/accounts/{id}/default`
- `POST /v1/auth/providers/{provider}/accounts/{id}/refresh`
- `DELETE /v1/auth/providers/{provider}/accounts/{id}`

provider 先支持：

- `github_copilot`
- `codex_openai`
- `qwen_oauth`

## 6.2 Projection API

职责：

- 把托管账号投影成 Warwolf 可消费的 provider/runtime 视图

建议：

- `GET /v1/projections?tool=codex`
- `GET /v1/projections?tool=claude-code`
- `GET /v1/projections/{projectionId}`

返回：

- provider type
- protocol
- runtime target
- base_url
- models
- account binding
- capabilities

## 6.3 Launch Profile API

这是 Warwolf 最关键的依赖面。

建议：

- `POST /v1/runtime/launch-profile`

请求：

- `tool`
- `projection_id`
- `model_id`
- `account_id?`
- `working_directory?`

返回：

- `resolved_account_id`
- `proxy_base_url`
- `environment_variables`
- `placeholder_token`
- `protocol`
- `requires_takeover`
- `sync_plan`

Warwolf 拿这个结果去启动：

- `Codex`
- `Claude Code`
- `Gemini CLI`
- `OpenClaw`

## 6.4 Proxy / Takeover API

建议：

- `GET /v1/runtime/takeover/status`
- `POST /v1/runtime/takeover/apply`
- `POST /v1/runtime/takeover/release`
- `POST /v1/runtime/proxy/start`
- `POST /v1/runtime/proxy/stop`

## 7. 代码边界设计

## 7.1 `cc-switch` 内哪些代码应该进入 core

推荐进入 `cc-switch-core`：

- provider domain
- database
- auth managers
- projection resolver
- proxy service
- takeover service
- model discovery
- live config read/write adapters

对应今天的大致来源：

- [provider.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/provider.rs)
- [database/mod.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/database/mod.rs)
- [services](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/services)
- [proxy](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/proxy)
- [codex_config.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/codex_config.rs)
- [gemini_config.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/gemini_config.rs)

## 7.2 哪些代码必须留在 desktop 壳层

应该留在 `cc-switch-desktop`：

- Tauri builder / tray / window lifecycle
- deeplink UI handling
- setting panels / page components
- command 注册层

对应今天的大致来源：

- [lib.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/lib.rs)
- [main.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/main.rs)
- `src/` 下所有 React UI

## 7.3 哪些代码是 Warwolf 不该依赖的

Warwolf 不该：

1. 直接 import `cc-switch` React 组件
2. 直接调用 Tauri command 名称
3. 直接读 `~/.cc-switch/cc-switch.db`
4. 直接改 `~/.cc-switch` 下 JSON/TOML
5. 直接链接 `cc_switch_lib::run()`

## 8. Warwolf 集成方案

## 8.1 设置页

Warwolf 的模型服务页改成展示 `cc-switch` 的 auth/projection 数据，而不是自己维护官方账号池。

保留：

- Warwolf 的 UI 体验

迁移：

- OpenAI/Codex 账号来源改到 `cc-switch`
- Qwen 账号来源改到 `cc-switch`

## 8.2 Code Tools

Code Tools 不再自己拼 provider env，而是：

1. 向 `cc-switch-daemon` 请求 launch profile
2. 拿到 env/base_url/proxy 信息
3. 启动对应 CLI

这样 Warwolf 只管“启动”，不管“授权细节”。

## 8.3 OpenClaw

OpenClaw 也不应该成为新的授权宿主。

建议：

- 由 Warwolf 代表 OpenClaw 向 `cc-switch` 请求 runtime profile
- OpenClaw 启动时消费这个 profile

## 9. 发布与升级设计

## 9.1 `cc-switch` 上游发布

建议 `cc-switch` 仓库以后每次发布都产出：

1. `cc-switch-desktop`
2. `cc-switch-daemon`
3. `contract schema`
4. `client SDK`

## 9.2 Warwolf 升级方式

Warwolf 升级 `cc-switch` 依赖时：

1. 先 bump pinned revision/tag
2. 跑 contract compatibility tests
3. 跑本地 auth/proxy/takeover smoke
4. 再更新兼容矩阵

## 9.3 兼容矩阵

建议新增文档：

- `WARWOLF_CC_SWITCH_COMPAT.md`

至少记录：

- Warwolf version
- cc-switch daemon version
- contract version
- schema version

## 10. 迁移路线

### Phase 0：设计定版

产出：

- daemon API contract
- repo restructuring plan
- compatibility policy

### Phase 1：把 `cc-switch` 从 app-first 改成 core-first

产出：

- `cc-switch-core`
- `cc-switch-daemon`
- desktop app 改为依赖 core

### Phase 2：Warwolf 接入 daemon

产出：

- Warwolf backend daemon client
- Warwolf 设置页读 `cc-switch`
- Warwolf Code Tools 用 launch profile

### Phase 3：下线 Warwolf 重复能力

下线：

- Warwolf 内部官方 Codex 账号 SSOT
- Warwolf 内部独立 provider secret 管理的官方账号分支

### Phase 4：统一发布体系

产出：

- GitHub tag / release artifacts
- version compatibility matrix

## 11. 风险

## 11.1 直接依赖整仓的风险

如果 Warwolf 直接依赖今天的 `cc-switch` 仓库源码入口，会带来：

- Tauri 生命周期冲突
- 构建时间暴涨
- API 无稳定边界
- 版本升级高风险
- UI/壳层耦合

这是最应该避免的路线。

## 11.2 daemon 方案的风险

- 本地多进程管理更复杂
- socket/port 管理要做好
- 本地升级与自动恢复需要更多工程化

但这些风险是可工程化解决的，而且比“两个桌面 app 共享内部库状态”更容易控。

## 11.3 数据迁移风险

`cc-switch` 如果从 JSON/file store 收敛到统一 keychain + SQLite，会涉及：

- Copilot 账号迁移
- Codex profile 导入
- Qwen OAuth 凭据导入

需要一次性设计好 migration story。

## 12. 最终推荐

最终推荐方案很明确：

1. 不让 Warwolf 直接依赖今天的 `cc-switch` 单体 Tauri app
2. 让 `cc-switch` 仓库演进成“上游 monorepo”
3. 把 `auth/provider/proxy/takeover` 收束为 `cc-switch-core`
4. 把稳定本地 API 做成 `cc-switch-daemon`
5. 让 Warwolf 通过 `daemon + client contract` 依赖 GitHub 仓库
6. Warwolf 自己保留 UI、工作台和启动器，不再自持第二套官方授权中台

一句话总结：

Warwolf 依赖的应该是 `cc-switch` 的“核心服务能力和协议”，不是 `cc-switch` 今天这层桌面应用壳。
