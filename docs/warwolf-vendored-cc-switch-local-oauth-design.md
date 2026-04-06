# Warwolf 内嵌 CC Switch + 本机多账号 OAuth 设计方案

## 1. 前提

这版方案基于新的明确前提：

1. `cc-switch` 代码直接并入 Warwolf 仓库
2. `Codex OAuth` 与 `Qwen Code OAuth` 的多个账号都在同一台电脑上完成授权
3. 不再引入“另一台授权机”或“服务端下发 OAuth 信息”作为主链路
4. Warwolf 本机同时承担：
   - 授权宿主
   - 账号存储
   - 本地 proxy/runtime
   - CLI 启动器

因此，这版方案的核心问题变成：

- 怎么把 `cc-switch` 的核心能力并入 Warwolf
- 怎么在本机完成 `Codex + Qwen` 的多账号授权
- 怎么让这些账号统一供给给 `Codex / Claude Code / Gemini CLI / OpenClaw`

## 2. 总体结论

推荐路线是：

1. 把 `cc-switch` 的后端核心能力 vendored 进 Warwolf
2. 由 Warwolf 成为唯一桌面壳层
3. 在本机建立统一的“本地账号库”
4. `Codex OAuth` 与 `Qwen OAuth` 都接成 `ManagedAuthProvider`
5. 账号和 provider 之间继续用 `authBinding`
6. CLI 侧统一通过 `proxy + placeholder + 动态注入` 运行

一句话：

不要让每个 CLI 自己各管一份官方账号文件，而要让 Warwolf 内嵌的 `cc-switch runtime` 成为本机统一授权与运行时中台。

## 3. 为什么这次方案比“异地下发”更简单

同机授权意味着：

- 不需要远端账号控制面
- 不需要 lease / bundle / device key
- 不需要跨设备分发 refresh token
- 不需要服务端审计与分配体系

但仍然保留两个复杂点：

1. 多账号
2. 多 CLI 供给

所以系统仍然需要本地中台，但不再需要远端控制面。

## 4. 现状分析

## 4.1 `cc-switch` 已有的关键能力

本地可直接复用的核心主要来自：

- provider/binding：
  - [provider.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/provider.rs)
- auth command：
  - [auth.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/commands/auth.rs)
- Copilot 多账号托管实现：
  - [copilot_auth.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/proxy/providers/copilot_auth.rs)
- proxy/takeover：
  - [proxy.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/services/proxy.rs)
  - [forwarder.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/proxy/forwarder.rs)
- live config 写入：
  - [codex_config.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/codex_config.rs)
  - [gemini_config.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/gemini_config.rs)

`cc-switch` 的问题不是没有核心，而是这些核心还混在单体 Tauri app 里。

## 4.2 Warwolf 已有的关键能力

Warwolf 当前本地也已经有很强的承接面：

- 桌面聚合状态：
  - [desktop-core/lib.rs](/Users/champion/Documents/develop/Warwolf/open-claude-code/rust/crates/desktop-core/src/lib.rs)
- provider hub：
  - [provider_hub.rs](/Users/champion/Documents/develop/Warwolf/open-claude-code/rust/crates/desktop-core/src/provider_hub.rs)
- 本地 HTTP API：
  - [desktop-server/lib.rs](/Users/champion/Documents/develop/Warwolf/open-claude-code/rust/crates/desktop-server/src/lib.rs)
- Code Tools 启动：
  - [apps/desktop-shell/src-tauri/src/main.rs](/Users/champion/Documents/develop/Warwolf/open-claude-code/apps/desktop-shell/src-tauri/src/main.rs)
- 现有 Codex OAuth：
  - [codex_auth.rs](/Users/champion/Documents/develop/Warwolf/open-claude-code/rust/crates/desktop-core/src/codex_auth.rs)

所以本地方案真正要解决的是“收敛”，不是“从零开始”。

## 5. 推荐架构

## 5.1 角色划分

这次只需要 3 层：

### 1. Warwolf Desktop Shell

职责：

- UI
- 模型服务页
- Code Tools 页
- 账号管理页

### 2. Warwolf Embedded CC Switch Runtime

职责：

- 多账号授权
- provider projection
- auth binding
- proxy/takeover
- live config sync
- runtime launch profile

### 3. CLI Consumers

- Codex
- Claude Code
- Gemini CLI
- OpenClaw

## 5.2 核心设计原则

1. 本地只有一个账号 SSOT
2. 多账号统一由 Warwolf 管理
3. CLI 不直接成为账号真相来源
4. 本地 OAuth 成功后，账号写入统一账号库
5. CLI 运行时只消费 launch profile / proxy

## 6. 仓库组织方案

## 6.1 推荐 vendor 结构

建议使用“双层结构”，而不是直接打散代码。

```text
open-claude-code/
  vendor/
    cc-switch-upstream/
      src/
      src-tauri/
  rust/
    crates/
      ccswitch-vendored-core/
      desktop-core/
      desktop-server/
```

## 6.2 `vendor/cc-switch-upstream`

职责：

- 保留上游源码快照
- 方便后续对比和同步
- 不直接进入主构建

## 6.3 `ccswitch-vendored-core`

职责：

- 从 `cc-switch` 抽取可复用 Rust 核心
- 去掉 Tauri/tray/window/deeplink 壳层
- 提供 Warwolf 可直接调用的本地 runtime API

建议吸收：

- provider
- services
- proxy
- live config adapters
- auth managers

## 6.4 Warwolf 现有模块怎么调整

### `desktop-core`

负责：

- 组合 `ccswitch-vendored-core`
- 暴露 Warwolf 语义化桌面接口

### `desktop-server`

负责：

- 提供本地 HTTP API 给前端

### `apps/desktop-shell`

负责：

- 前端交互与状态展示

## 7. 本地统一账号库设计

## 7.1 为什么不能继续用各 CLI 自己的 home 目录做 SSOT

如果继续这样：

- Codex 用 `~/.codex/auth.json`
- Qwen 用 `~/.qwen/oauth_creds.json`

会带来问题：

1. 多账号切换难统一
2. Warwolf 无法统一展示和管理
3. `Claude/Gemini/OpenClaw` 很难复用这些账号
4. 不同 CLI 会互相覆盖或漂移

所以本地必须建立统一账号库。

## 7.2 统一账号库存什么

建议统一本地账号库存两层：

### 元数据

建议存 SQLite：

- `managed_auth_accounts`
- `managed_auth_model_catalogs`
- `managed_auth_bindings`

### 敏感凭据

建议优先存系统 keychain / keyring。

回退方案：

- 本地加密文件

不推荐把 refresh token 明文存进 JSON。

## 7.3 账号模型

统一账号结构建议：

- `id`
- `auth_provider`
- `subject`
- `email`
- `display_label`
- `plan_label`
- `status`
- `is_default`
- `created_at`
- `updated_at`
- `last_refresh_at`

敏感字段单独存：

- `access_token`
- `refresh_token`
- `id_token`
- `expires_at`
- `resource_url`（Qwen）

## 8. ManagedAuthProvider 统一抽象

## 8.1 目标 provider

本地第一阶段统一支持：

- `codex_openai`
- `qwen_oauth`
- `github_copilot`

其中：

- `github_copilot` 用现有实现做参考
- `codex_openai` 复用 Warwolf 现有 `codex_auth.rs`
- `qwen_oauth` 新增实现

## 8.2 统一接口

每个 provider 实现：

- `start_login()`
- `poll_login() / complete_login()`
- `list_accounts()`
- `set_default_account()`
- `remove_account()`
- `refresh_account()`
- `get_runtime_credential()`
- `list_models()`

这会把 Copilot 现有“单独实现”提升成统一框架。

## 9. Codex OAuth 方案

## 9.1 授权方式

Codex 仍然走浏览器 OAuth，本机完成。

现有可复用逻辑：

- [codex_auth.rs](/Users/champion/Documents/develop/Warwolf/open-claude-code/rust/crates/desktop-core/src/codex_auth.rs)

建议把现有实现从 `desktop-core` 中抽出来，迁到 `ccswitch-vendored-core` 的 `managed_auth/codex_openai.rs`。

## 9.2 多账号支持

当前 Warwolf 已经有 profile store 形态，但定位偏“本地导入/激活”。

这次要升级成真正多账号：

- 多个 profile 并存
- 明确 default account
- 允许 provider 绑定到指定账号
- 支持 refresh、remove、reactivate

## 9.3 模型目录

Codex 模型目录建议：

1. 优先用官方 `model/list`
2. 失败时 fallback 到静态 catalog

每个账号单独缓存。

原因：

- 不同账号可能模型目录不同
- Warwolf 之前已经踩过“只显示一个模型”的坑

## 10. Qwen OAuth 方案

## 10.1 授权方式

Qwen 使用 device flow，本机完成。

参考：

- [auth.md](/Users/champion/Documents/develop/Golden/qwen-code/docs/users/configuration/auth.md)
- [qwenOAuth2.ts](/Users/champion/Documents/develop/Golden/qwen-code/packages/core/src/qwen/qwenOAuth2.ts)

推荐本地在 `ccswitch-vendored-core` 里原生实现，不依赖解析 CLI 文本输出。

## 10.2 多账号支持

Qwen 官方 CLI 默认是单凭据文件模式。

Warwolf 需要在本机账号库上把它升级成：

- 多账号
- 默认账号
- 指定账号运行
- 按账号刷新 token

## 10.3 `resource_url` 是关键

Qwen 不能只存 token，还必须存：

- `resource_url`

因为 Qwen Code 实际会把 `resource_url` 当作 OpenAI-compatible endpoint 使用。

参考：

- [qwenContentGenerator.ts](/Users/champion/Documents/develop/Golden/qwen-code/packages/core/src/qwen/qwenContentGenerator.ts)

因此 Qwen runtime credential 必须是：

- `access_token + resource_url`

而不是只有一个 bearer token。

## 11. Provider Binding 设计

provider 和账号的关系继续推荐使用 `authBinding`。

绑定规则：

1. `source = provider_config`
   - provider 自己带 API key
2. `source = managed_account`
   - provider 凭据来自统一账号库
3. `account_id = null`
   - 使用该 auth provider 的默认账号
4. `account_id != null`
   - 固定绑定某个账号

这能覆盖：

- Codex OpenAI 官方账号
- Qwen 官方账号
- 未来 Copilot 账号

## 12. 统一供给给 4 个 CLI

## 12.1 核心策略

所有 CLI 最终统一通过本地 embedded runtime 供给。

这意味着：

- 账号不直接“属于” CLI
- 账号属于 Warwolf 本地账号库
- CLI 只是消费 runtime profile

## 12.2 Codex

推荐：

- `~/.codex/config.toml` 指向本地 proxy `/v1`
- `~/.codex/auth.json` 写 placeholder
- 真实 token 由 runtime 注入

## 12.3 Claude Code

推荐：

- `ANTHROPIC_BASE_URL` 指向本地 proxy
- `ANTHROPIC_AUTH_TOKEN` 用 placeholder
- 上游实际由绑定的 managed account 决定

## 12.4 Gemini CLI

推荐：

- `GOOGLE_GEMINI_BASE_URL` 指向本地 proxy
- `GEMINI_API_KEY` 用 placeholder
- 上游 provider/account 由 runtime 决定

## 12.5 OpenClaw

推荐：

- 不让 OpenClaw 自己成为账号宿主
- 启动时由 Warwolf 注入 runtime launch profile

## 13. Launch Profile 设计

这是本地 runtime 最关键的输出。

Warwolf 启动任意 CLI 前，统一调用：

- `build_launch_profile(tool, projection, model, account?)`

返回：

- `tool`
- `resolved_account_id`
- `protocol`
- `base_url`
- `environment_variables`
- `placeholder_token`
- `requires_takeover`

这让 Warwolf 启动器完全不需要理解 OAuth 细节。

## 14. 本地 API 设计

基于 [desktop-server/lib.rs](/Users/champion/Documents/develop/Warwolf/open-claude-code/rust/crates/desktop-server/src/lib.rs) 建议新增一组本地接口。

## 14.1 账号接口

- `GET /api/desktop/auth/providers`
- `GET /api/desktop/auth/providers/{provider}/accounts`
- `POST /api/desktop/auth/providers/{provider}/login`
- `GET /api/desktop/auth/providers/{provider}/login/{id}`
- `POST /api/desktop/auth/providers/{provider}/accounts/{id}/default`
- `POST /api/desktop/auth/providers/{provider}/accounts/{id}/refresh`
- `DELETE /api/desktop/auth/providers/{provider}/accounts/{id}`

## 14.2 Projection 接口

- `GET /api/desktop/runtime/projections`
- `GET /api/desktop/runtime/projections?tool=codex`

## 14.3 Launch Profile 接口

- `POST /api/desktop/runtime/launch-profile`

## 14.4 Takeover / Proxy 接口

- `GET /api/desktop/runtime/takeover`
- `POST /api/desktop/runtime/takeover/apply`
- `POST /api/desktop/runtime/takeover/release`

## 15. UI 设计

## 15.1 模型服务页

模型服务页建议拆成两层。

### 账号层

展示：

- Codex OpenAI 账号列表
- Qwen 账号列表
- 默认账号
- 账号状态
- 模型目录

### 运行层

展示：

- 哪个 tool 绑定哪个 projection
- proxy 是否运行
- 当前生效模型
- takeover 状态

## 15.2 Code Tools 页

用户选择：

- CLI 工具
- 账号
- 模型

然后 Warwolf：

1. 请求 launch profile
2. 启动 CLI

UI 不直接操作 OAuth token。

## 16. 迁移方案

### Phase 1：vendor `cc-switch` 核心

目标：

- 建立 `vendor/cc-switch-upstream`
- 建立 `ccswitch-vendored-core`
- 接通 proxy/takeover 能力

### Phase 2：统一本地账号库

目标：

- 新建统一账号存储
- 从 Warwolf 现有 Codex profile store 迁移
- 为 Qwen 引入多账号结构

### Phase 3：接 Codex OAuth 多账号

目标：

- Codex 登录迁到统一框架
- 模型目录按账号发现

### Phase 4：接 Qwen OAuth 多账号

目标：

- Qwen device flow 本地接入
- `resource_url` 成对管理

### Phase 5：Code Tools 统一走 launch profile

目标：

- 4 个 CLI 都不再自己拼 credential env
- 都走 embedded runtime

## 17. 风险

## 17.1 代码并入后升级上游困难

解决方式：

- 保留 `vendor snapshot`
- 业务改造放在 `ccswitch-vendored-core`

## 17.2 同机本地存多账号凭据的安全性

风险依然存在。

所以必须：

- 优先系统 keychain
- 回退到本地加密存储
- 不推荐明文 JSON 做长期 SSOT

## 17.3 Qwen 本地多账号比官方默认行为更复杂

这是预期复杂度。

因为官方默认是单凭据文件，Warwolf 必须在本地中台层把它升级成多账号模型。

## 18. 关键评审点

最需要先拍板的是：

1. 是否接受 `cc-switch` 代码 vendored 进 Warwolf
2. 是否接受 Warwolf 成为本机唯一账号中台
3. 是否接受 `Codex/Qwen` 的账号都进入统一本地账号库
4. 是否接受 CLI 统一走 `proxy + placeholder + 动态注入`
5. 是否接受 Qwen 按 `token + resource_url` 成对管理
6. 是否接受现有 Warwolf `codex_auth.rs` 逐步下沉到 vendored runtime，而不是继续单独长大

## 19. 推荐结论

这版方案下的最优路径是：

1. 把 `cc-switch` 的核心后端代码并入 Warwolf，但保留 vendor snapshot
2. 把 Warwolf 现有 Codex OAuth、本地 provider hub 和 `cc-switch` proxy/runtime 收敛成统一本地账号中台
3. 在本机完成 `Codex + Qwen` 多账号授权
4. 用同一套本地 runtime 把这些账号统一供给给 `Codex / Claude Code / Gemini CLI / OpenClaw`

一句话总结：

既然多个账号都在同一台电脑授权，那就不要再引入远端控制面，直接让 Warwolf 内嵌的 `cc-switch runtime` 成为本机唯一的 OAuth、多账号、provider projection 和 CLI 供给中台。
