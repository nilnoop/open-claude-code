# CC Switch 统一授权中台设计方案

## 1. 背景

当前 Warwolf 已经同时维护了两套相近但不一致的能力：

- `cc-switch` 更像“多 CLI 配置/代理中台”，已经有：
  - provider 数据库
  - live config takeover
  - 本地 proxy
  - `authBinding`
  - GitHub Copilot 的多账号托管授权
- `open-claude-code` 更像“桌面工作台”，已经有：
  - Code Tools 启动器
  - 模型服务 UI
  - Codex 官方登录/账号管理
  - 本地 provider hub

用户目标不是继续在 Warwolf 内部重复做官方授权，而是把 `cc-switch` 提升成统一授权与代理中台：

1. `Codex / Qwen Code` 官方授权由 `cc-switch` 统一获取和托管
2. 支持多账号、默认账号、账号切换、授权刷新
3. 通过统一 API 暴露给 Warwolf
4. 再由 Warwolf 用同一套能力供给给：
   - `Codex`
   - `Claude Code`
   - `Gemini CLI`
   - `OpenClaw`

这份文档给出推荐架构、数据模型、API、迁移路径和关键评审点。

## 2. 现状分析

### 2.1 `cc-switch` 已有的可复用能力

#### 2.1.1 已经存在“托管授权”抽象，但目前只落到 Copilot

前端已经有通用 managed auth API 和 hook：

- [auth.ts](/Users/champion/Documents/develop/Warwolf/cc-switch/src/lib/api/auth.ts)
- [useManagedAuth.ts](/Users/champion/Documents/develop/Warwolf/cc-switch/src/components/providers/forms/hooks/useManagedAuth.ts)

后端也已经有通用命令面：

- [auth.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/commands/auth.rs)

但 `ManagedAuthProvider` 当前实际上只支持一个值：

- `github_copilot`

也就是说，抽象已经在，注册表还没有真正做成“多授权提供方”。

#### 2.1.2 `authBinding` 已经是正确方向

`ProviderMeta` 已经支持：

- `authBinding.source = managed_account`
- `authBinding.authProvider`
- `authBinding.accountId`

见：

- [provider.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/provider.rs)
- [authBinding.ts](/Users/champion/Documents/develop/Warwolf/cc-switch/src/lib/authBinding.ts)

这说明 provider 和账号之间的关系，现有代码已经预留了标准表达方式，不需要再造一套并行 schema。

#### 2.1.3 本地 proxy + placeholder takeover 已经能承接“统一供给”

`cc-switch` 的 takeover 模式已经做了三件关键事：

- 接管 `Claude Code` live config
- 接管 `Codex` 的 `auth.json/config.toml`
- 接管 `Gemini CLI` 的 `.env/settings`

通过把真实密钥替换成 `PROXY_MANAGED`，然后让 proxy 在转发时动态注入真实凭据。

见：

- [proxy.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/services/proxy.rs)
- [forwarder.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/proxy/forwarder.rs)

这条链非常关键，因为它意味着：

- CLI 侧不必直接持有真实 refresh/access token
- 真实账号切换可以在 `cc-switch` 内完成
- Warwolf 只需要拿到“运行时供给信息”，不需要接触真实 secret

#### 2.1.4 Copilot 多账号是最佳参考实现

`cc-switch` 里目前最成熟的“托管 OAuth + 多账号 + 默认账号 + token 刷新 + 模型缓存”实现是：

- [copilot_auth.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/proxy/providers/copilot_auth.rs)

它已经完整解决了：

- 登录流程
- 多账号存储
- 默认账号
- 按账号取 token
- 模型列表缓存
- 运行时 token 刷新

这套模式不该只服务 Copilot，而应该抽象成通用 `ManagedAuthProvider` 框架。

### 2.2 `cc-switch` 当前的缺口

#### 2.2.1 Codex 仍然是“live file 同步”，不是托管授权

当前 `cc-switch` 对 Codex 的能力主要是：

- 读写 `~/.codex/auth.json`
- 读写 `~/.codex/config.toml`
- takeover 时把 `base_url` 改到本地 proxy

见：

- [codex_config.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/codex_config.rs)
- [live.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/services/provider/live.rs)

但它没有真正拥有：

- Codex OAuth 登录流程
- 多账号 profile store
- 默认账号选择
- 按账号刷新 access token

#### 2.2.2 Qwen OAuth 尚未接入

在 `cc-switch` 里目前没有 Qwen 官方 OAuth 的托管实现。

这部分必须新增，而不是“开个 UI 开关就行”。

#### 2.2.3 SSOT 宣称是 SQLite，但托管授权仍散落在文件

README 写的是：

- `~/.cc-switch/cc-switch.db` 是 SSOT

见：

- [README.md](/Users/champion/Documents/develop/Warwolf/cc-switch/README.md)

但 Copilot 实际账号存储仍在：

- `copilot_auth.json`

这与“统一授权中台”的方向不一致。Codex/Qwen 如果继续各自落 JSON 文件，会把问题继续扩大。

### 2.3 Warwolf 当前状态

Warwolf 当前已经自己做了一套 Codex 官方授权和模型服务：

- Codex 登录/导入/刷新： [codex_auth.rs](/Users/champion/Documents/develop/Warwolf/open-claude-code/rust/crates/desktop-core/src/codex_auth.rs)
- 模型服务 UI： [ProviderSettings.tsx](/Users/champion/Documents/develop/Warwolf/open-claude-code/apps/desktop-shell/src/features/settings/sections/ProviderSettings.tsx)
- Code Tools 入口： [index.ts](/Users/champion/Documents/develop/Warwolf/open-claude-code/apps/desktop-shell/src/features/code-tools/index.ts)
- 各 CLI 启动注入： [main.rs](/Users/champion/Documents/develop/Warwolf/open-claude-code/apps/desktop-shell/src-tauri/src/main.rs)

这意味着如果继续在 Warwolf 里补 Qwen OAuth、多账号、账号池、token 刷新，会和 `cc-switch` 形成第二套授权中台，不值得。

## 3. 目标

## 3.1 目标

1. `cc-switch` 成为唯一授权中台
2. 支持 `github_copilot / codex_openai / qwen_oauth` 三类托管授权提供方
3. 每类授权支持多账号
4. provider 通过 `authBinding` 绑定某个托管账号或某类默认账号
5. `cc-switch` 提供统一 API 给 Warwolf
6. Warwolf 只做 UI、工作台、CLI 启动和状态展示
7. 真实 secret 默认不离开 `cc-switch`

## 3.2 非目标

1. 第一阶段不要求把所有第三方 API Key provider 都迁入托管授权体系
2. 第一阶段不要求 Warwolf 完全替代 `cc-switch` UI
3. 第一阶段不要求 `OpenCode/OpenClaw` 也支持 `cc-switch` 的完整 takeover 语义
4. 第一阶段不要求完全删除 Warwolf 现有 provider hub，但要明确其降级为“投影/缓存层”

## 4. 推荐架构

### 4.1 角色划分

#### `cc-switch`

承担：

- 官方授权获取
- 多账号管理
- refresh/access token 生命周期
- 账号级模型目录发现与缓存
- provider 与账号绑定
- 本地 proxy 与协议转换
- 对外统一 API

#### Warwolf

承担：

- 桌面工作台 UI
- 模型服务页面展示
- Code Tools 启动器
- 与 `cc-switch` API 对接
- 基于 `cc-switch` 返回的 runtime profile 启动 CLI

一句话：

- `cc-switch` = control plane + auth broker + proxy
- Warwolf = desktop UX + launcher

### 4.2 核心抽象

#### 4.2.1 ManagedAuthProvider

统一抽象三类托管授权：

- `github_copilot`
- `codex_openai`
- `qwen_oauth`

每个 provider 都实现同一组能力：

- `start_login`
- `poll_login` 或 `complete_callback`
- `list_accounts`
- `set_default_account`
- `remove_account`
- `refresh_account`
- `get_valid_runtime_credential`
- `list_models`

#### 4.2.2 ManagedAuthAccount

账号元信息，不直接等于 provider：

- `id`
- `auth_provider`
- `subject/login/email/display_label`
- `plan/quota_tier`
- `is_default`
- `last_authenticated_at`
- `last_refresh_at`
- `status`

#### 4.2.3 ManagedCredentialBundle

真实凭据包，不暴露给前端：

- `access_token`
- `refresh_token`
- `id_token`
- `token_type`
- `expires_at`
- `resource_url`（Qwen 特有但抽象层允许可选）
- `raw_metadata`

#### 4.2.4 ProviderProjection

“账号”不直接喂给 CLI，而是先投影成可消费的 provider 视图：

- `provider_type`
- `runtime_target`
- `protocol`
- `base_url`
- `model_catalog`
- `auth_binding`
- `capabilities`

同一个账号可以被投影成多个运行时形态，例如：

- `codex_openai` 账号
  - Codex/OpenAI Responses 投影
  - Claude 兼容投影（经 proxy transform）
  - Gemini 兼容投影（经 proxy transform）
- `qwen_oauth` 账号
  - OpenAI-compatible 投影（来自 `resource_url`）
  - 其他兼容投影视 proxy 能力决定

#### 4.2.5 RuntimeLaunchProfile

Warwolf 不应直接请求 token，而应向 `cc-switch` 请求运行时启动信息：

- `tool`
- `provider_projection_id`
- `env`
- `base_url`
- `model`
- `proxy_origin`
- `placeholder_token`
- `account_label`
- `sync_mode`

这让 Warwolf 能启动 CLI，但不持有真正 secret。

## 5. 核心设计

### 5.1 统一账号存储设计

推荐把“账号元数据”和“secret”拆开存：

#### 元数据

存 SQLite：

- `managed_auth_accounts`
- `managed_auth_model_cache`
- `managed_auth_binding_overrides`

#### secret

推荐优先级：

1. OS Keychain / Keyring
2. 若平台不支持，则本地加密存储

不建议继续让：

- Copilot 放 `copilot_auth.json`
- Codex 放 profile JSON
- Qwen 放 `oauth_creds.json`

作为 `cc-switch` 的 SSOT。

CLI 自己的 home 文件只保留：

- 导入来源
- 向后兼容的 export/live projection
- takeover 期间的 placeholder

### 5.2 `authBinding` 继续复用，不再另起系统

provider 和账号的关系继续放在：

- `ProviderMeta.authBinding`

规则：

1. `source = provider_config`
   - 仍然表示 provider 自己带 API key
2. `source = managed_account`
   - 表示凭据来自托管授权中心
3. `accountId = null`
   - 表示跟随该 auth provider 的默认账号
4. `accountId != null`
   - 表示固定绑定到某个账号

这能覆盖：

- 官方账号池
- 默认账号切换
- 某个 provider 固定使用某个账号

### 5.3 token broker 从“Copilot 特判”升级成“通用托管凭据解析器”

当前 `forwarder.rs` 只对 `GitHubCopilot` 做特判。

推荐改成通用流程：

1. Adapter 解析 provider
2. 若 provider 带 `authBinding(managed_account)`
3. 交给 `ManagedAuthRegistry` 解析 runtime credential
4. 返回：
   - 真实 access token
   - 真实 base_url override（Qwen 需要）
   - 认证头策略
   - 账号上下文
5. forwarder 统一组装 headers 并发给上游

这样可以避免把：

- Copilot
- Codex
- Qwen

都做成 `if provider_type == ...` 的散落特判。

### 5.4 模型目录按账号发现，而不是按 provider 写死

#### Codex / OpenAI

建议模型目录来源：

1. 首选官方 `model/list`
2. 失败时退回静态 fallback

原因：

- 不同 Plus/Team/Enterprise 账号可能模型和配额不同
- Warwolf 之前已经证明这一步很重要，否则会出现“UI 只有一个模型”的历史问题

#### Qwen OAuth

Qwen OAuth 当前令牌会返回 `resource_url`，而 Qwen Code 实际用它作为 OpenAI-compatible endpoint。

见：

- [qwenOAuth2.ts](/Users/champion/Documents/develop/Golden/qwen-code/packages/core/src/qwen/qwenOAuth2.ts)
- [qwenContentGenerator.ts](/Users/champion/Documents/develop/Golden/qwen-code/packages/core/src/qwen/qwenContentGenerator.ts)

建议模型目录来源：

1. 优先探测 `resource_url` 对应 endpoint 的模型发现接口
2. 如果上游不提供稳定的模型列表，则使用 curated fallback
3. 每个账号单独缓存

## 6. 授权提供方设计

### 6.1 `codex_openai`

#### 6.1.1 登录来源

建议支持两种进入方式：

1. 浏览器 OAuth 登录
2. 导入现有 `~/.codex/auth.json`

浏览器登录可直接复用 Warwolf 现有实现思路：

- [codex_auth.rs](/Users/champion/Documents/develop/Warwolf/open-claude-code/rust/crates/desktop-core/src/codex_auth.rs)

#### 6.1.2 存储内容

- OpenAI subject/account id
- email/display label
- id token
- access token
- refresh token
- token expiry
- model cache
- last sync status

#### 6.1.3 供给方式

##### 对 Codex CLI

推荐模式：

- `config.toml` 指向 `cc-switch` local proxy `/v1`
- `auth.json` 写 placeholder
- 真实 token 仅在 proxy 内动态注入

##### 对 Claude Code / Gemini CLI / OpenClaw

通过 provider projection 暴露“OpenAI 官方 provider”，由 proxy 做协议适配和凭据注入。

### 6.2 `qwen_oauth`

#### 6.2.1 登录来源

Qwen 官方流程本质是 device flow。

参考：

- [auth.md](/Users/champion/Documents/develop/Golden/qwen-code/docs/users/configuration/auth.md)
- [qwenOAuth2.ts](/Users/champion/Documents/develop/Golden/qwen-code/packages/core/src/qwen/qwenOAuth2.ts)

建议 `cc-switch` 后端原生实现同等流程，不依赖解析 CLI 文本输出。

#### 6.2.2 存储内容

- access token
- refresh token
- id token
- expires_at
- `resource_url`
- profile/email
- quota tier
- model cache

#### 6.2.3 特别注意：`resource_url` 是关键

Qwen OAuth 不只是拿到 token，还拿到与该账号绑定的资源地址。

这意味着运行时不能只注入 Bearer token，还必须让 token 和 base URL 成对解析。

所以 `ManagedCredentialBundle` 必须允许：

- token refresh 后同时更新 endpoint

#### 6.2.4 供给方式

##### 对 Qwen Code

推荐模式：

- 仍优先通过 `cc-switch` proxy 统一供给
- 如果用户明确要求“官方独立运行”，再 export 到 `~/.qwen/oauth_creds.json`

##### 对 Codex / Claude Code / Gemini CLI / OpenClaw

以 `resource_url` 为上游 endpoint，作为 OpenAI-compatible provider projection 暴露，由 proxy 做必要的协议适配。

## 7. 对外 API 设计

## 7.1 授权中心 API

在现有 `auth_*` API 基础上扩展，不重做命名：

- `auth_start_login(authProvider)`
- `auth_poll_for_account(authProvider, deviceCode)`
- `auth_get_status(authProvider)`
- `auth_list_accounts(authProvider)`
- `auth_set_default_account(authProvider, accountId)`
- `auth_remove_account(authProvider, accountId)`
- `auth_logout(authProvider)`

新增：

- `auth_refresh_account(authProvider, accountId)`
- `auth_import_live_profile(authProvider)`
- `auth_list_models(authProvider, accountId?)`

### 7.2 运行时供给 API

这是 Warwolf 真正需要的新接口。

建议新增：

- `runtime_list_provider_projections(tool?)`
- `runtime_get_launch_profile(tool, projectionId, modelId, accountId?)`
- `runtime_get_sync_status(tool, projectionId)`
- `runtime_apply_takeover(tool, projectionId)`
- `runtime_release_takeover(tool)`

其中最关键的是：

- `runtime_get_launch_profile`

Warwolf 用这个 API 拿到启动 CLI 所需的最小信息，而不是自己拼 env。

返回示例字段：

- `tool`
- `projection_id`
- `resolved_account_id`
- `proxy_base_url`
- `environment_variables`
- `model_id`
- `protocol`
- `placeholder_token`
- `requires_takeover`

### 7.3 Warwolf 侧消费方式

Warwolf 不再自己维护官方授权 profile store，而是：

1. 设置页调用 `cc-switch` auth/provider API
2. 模型服务页展示账号池、默认账号、模型目录、同步状态
3. Code Tools 启动前调用 `runtime_get_launch_profile`
4. 用返回的 env/base_url 启动对应 CLI

## 8. 消费者接入设计

### 8.1 Codex

模式：

- 启动时从 `cc-switch` 获取 launch profile
- 注入 `OPENAI_BASE_URL` / `OPENAI_API_KEY` 或 takeover 配置
- 所有真实授权由 `cc-switch` proxy 解析

### 8.2 Claude Code

模式：

- `ANTHROPIC_BASE_URL -> cc-switch proxy`
- `ANTHROPIC_AUTH_TOKEN -> placeholder`
- 上游实际走 `codex_openai` / `qwen_oauth` / `github_copilot` 等投影 provider

### 8.3 Gemini CLI

模式：

- `GOOGLE_GEMINI_BASE_URL -> cc-switch proxy`
- `GEMINI_API_KEY -> placeholder`
- proxy 决定实际绑定的上游 provider/account

### 8.4 OpenClaw

推荐不要让 OpenClaw 自己接触官方 token。

有两种方式：

1. 由 Warwolf 启动 OpenClaw 时注入 `cc-switch` runtime profile
2. 或让 OpenClaw provider config 指向 `cc-switch` proxy，并带 `provider_handle`

推荐第一种，因为它更符合“Warwolf 作为桌面工作台”的角色，不需要 OpenClaw 直接依赖 `cc-switch` 内部 schema。

## 9. 迁移方案

### Phase 1：把 `cc-switch` 做成真正的授权中台

范围：

- 抽象 `ManagedAuthProviderRegistry`
- 新增 `codex_openai`
- 新增 `qwen_oauth`
- 保留 `github_copilot`
- 新增 runtime launch profile API
- 先不改 Warwolf UI，只提供 API

### Phase 2：Warwolf 改成消费 `cc-switch`

范围：

- 模型服务页切换到 `cc-switch` API
- Code Tools 启动走 `runtime_get_launch_profile`
- 保留 Warwolf 现有本地 provider hub，作为只读镜像/兼容层

### Phase 3：去掉 Warwolf 内部重复的官方授权逻辑

范围：

- 下线 Warwolf 自己的 Codex auth profile store
- 下线本地 OpenAI 官方登录持久化
- 模型目录以 `cc-switch` 为准

### Phase 4：统一 OpenClaw / 其他消费者

范围：

- OpenClaw 也走 `cc-switch` runtime profile
- 如有必要，再补充 per-tool projection 或 session lease

## 10. 风险与权衡

### 10.1 最大风险：`cc-switch` 既做桌面应用又做中台，复杂度会上升

解决方式：

- API 层和 UI 层彻底分离
- 把 auth/provider/proxy 做成真正 service-first
- Warwolf 只消费 API

### 10.2 Qwen 的 `resource_url` 可能是账号级动态资源

这意味着：

- 不能把 Qwen 仅建模成“Bearer token + 固定 base_url”
- endpoint 解析必须跟 token refresh 一起更新

### 10.3 现有 Copilot JSON store 会成为不一致来源

如果不改：

- `github_copilot` 继续走 JSON
- `codex_openai/qwen_oauth` 走 SQLite/keychain

最终会形成两套托管授权存储。

不建议这样长期存在。

### 10.4 Warwolf 与 `cc-switch` 的耦合方式要控制好

不建议：

- Warwolf 直接读取 `cc-switch.db`
- Warwolf 直接解析 `~/.cc-switch/*` 文件

建议：

- 只通过公开 API 交互

## 11. 关键评审决策

团队评审时最需要先拍板的是下面 6 件事：

1. 是否接受 `cc-switch` 成为唯一授权中台，Warwolf 不再维护官方账号 SSOT
2. 是否接受“真实 secret 默认不离开 `cc-switch`”，Warwolf 只拿 runtime profile
3. 是否接受把 Copilot 现有 JSON store 迁到统一托管存储
4. 是否接受 `authBinding` 继续作为 provider 与账号的唯一绑定表达
5. 是否接受 Qwen 按“token + resource_url 成对解析”建模
6. 是否接受 Warwolf Phase 2 之后下线内部 Codex 官方授权实现

## 12. 推荐结论

推荐采用这条路线：

1. 以 `cc-switch` 为唯一授权中台
2. 以 `ManagedAuthProviderRegistry` 为统一扩展点
3. 先把 Copilot 的单实现抽象出来
4. 先接 `codex_openai`
5. 再接 `qwen_oauth`
6. 再让 Warwolf 全面切到 `cc-switch` runtime API

最核心的设计判断只有一句话：

不要再让每个 CLI 或每个桌面壳层都各自保存一份官方账号文件；要把“账号、token、默认账号、模型目录、协议适配、运行时供给”全部收束到 `cc-switch`，Warwolf 只做消费与体验层。
