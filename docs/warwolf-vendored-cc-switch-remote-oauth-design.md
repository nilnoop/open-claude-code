# Warwolf 内嵌 CC Switch + 异地 OAuth 下发设计方案

## 1. 新前提

这版方案明确接受两个前提：

1. `cc-switch` 代码不再作为外部依赖仓库消费，而是直接拷进 Warwolf 仓库
2. `Codex OAuth` 与 `Qwen Code OAuth` 的账号授权不在当前用户电脑完成，而是在另外一台受信任电脑上完成授权，然后由服务端统一下发多个账号的 OAuth 信息

因此，这版方案不再追求“Warwolf 依赖外部 `cc-switch` 仓库”，而是追求：

- `cc-switch` 核心能力被 vendored 到 Warwolf
- Warwolf 自己成为最终产品宿主
- OAuth 的真正来源是远端账号控制面
- 本地客户端消费“服务端下发的账号与运行时凭据”

## 2. 方案目标

1. 把 `cc-switch` 的 provider/auth/proxy/takeover 核心能力并入 Warwolf
2. Warwolf 统一承载：
   - 模型服务
   - Code Tools
   - 本地 proxy
   - CLI 启动与注入
3. 远端服务统一管理：
   - Codex OAuth 多账号
   - Qwen OAuth 多账号
   - 账号可见范围
   - 模型目录与配额元信息
   - 运行时凭据下发
4. 本地普通使用机默认不直接跑官方浏览器登录
5. 授权与使用解耦：
   - 授权机负责拿账号
   - 服务端负责托管与分发
   - 使用机负责消费和运行

## 3. 当前代码现实

## 3.1 `cc-switch` 当前可复用的核心

`cc-switch` 今天虽然是单体 Tauri 应用，但其后端已经包含完整的中台骨架：

- provider/domain：
  - [provider.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/provider.rs)
- auth command：
  - [auth.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/commands/auth.rs)
- Copilot 多账号托管授权：
  - [copilot_auth.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/proxy/providers/copilot_auth.rs)
- proxy/takeover：
  - [proxy.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/services/proxy.rs)
  - [forwarder.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/proxy/forwarder.rs)
- live config 写入：
  - [codex_config.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/codex_config.rs)
  - [gemini_config.rs](/Users/champion/Documents/develop/Warwolf/cc-switch/src-tauri/src/gemini_config.rs)

这些模块天然适合被并入 Warwolf。

## 3.2 Warwolf 当前已有可承接面

Warwolf 当前已经有自己的桌面工作台和本地 API 层：

- 桌面状态与后端聚合：
  - [desktop-core/lib.rs](/Users/champion/Documents/develop/Warwolf/open-claude-code/rust/crates/desktop-core/src/lib.rs)
- 模型服务与 provider hub：
  - [provider_hub.rs](/Users/champion/Documents/develop/Warwolf/open-claude-code/rust/crates/desktop-core/src/provider_hub.rs)
- 本地桌面 HTTP API：
  - [desktop-server/lib.rs](/Users/champion/Documents/develop/Warwolf/open-claude-code/rust/crates/desktop-server/src/lib.rs)
- Code Tools 启动器后端：
  - [main.rs](/Users/champion/Documents/develop/Warwolf/open-claude-code/apps/desktop-shell/src-tauri/src/main.rs)
- 现有本地 Codex OAuth：
  - [codex_auth.rs](/Users/champion/Documents/develop/Warwolf/open-claude-code/rust/crates/desktop-core/src/codex_auth.rs)

也就是说，Warwolf 今天缺的不是壳层，而是：

- 统一的远端账号控制面
- 本地 vendored `cc-switch` runtime
- 服务端下发凭据后的安全消费链路

## 4. 关键设计判断

这次最重要的判断有 4 个：

1. `cc-switch` 代码可以拷进 Warwolf，但不能原样整坨混用，必须拆成“vendor snapshot + Warwolf 适配层”
2. OAuth 多账号的 SSOT 必须放在服务端，而不是每台使用机本地
3. 服务端默认不应该把长效 `refresh_token` 明文发给每台使用机
4. 本地 CLI 仍然通过 `proxy + placeholder + 动态注入` 运行，这是最稳的消费方式

第 3 点尤其重要。

如果服务端直接把每个 `Codex/Qwen` 账号的长效 refresh token 明文下发到所有使用机，本质上等于把账号密钥横向扩散，风险非常高。  
所以虽然用户目标是“服务端下发多个账号的 OAuth 信息”，但推荐实现应分层：

- 下发账号元信息：可以广泛同步
- 下发短期运行时租约：默认模式
- 下发受设备公钥加密的离线 bundle：仅在受信任设备上开启

## 5. 目标架构

推荐架构拆成 4 个角色。

## 5.1 授权机（Auth Station）

这是“另外一台电脑”。

职责：

- 管理员或运营在这台机器上完成 `Codex OAuth` / `Qwen OAuth`
- 拿到官方账号的初始授权结果
- 上传到远端服务
- 必要时刷新、移除、禁用账号

推荐做法：

- 这台机器也跑 Warwolf，只是进入“授权机模式”
- 授权机模式下启用 vendored `cc-switch` auth center
- 授权结果不再本地长期持有，而是上传到服务端

这样可以最大化复用 `cc-switch` 的 auth 流程代码。

## 5.2 远端账号控制面（OAuth Control Plane）

这是新增服务端。

职责：

- 存储 OAuth 账号
- 管理多个账号
- 按组织/团队/用户分配可见账号
- 维护默认账号策略
- 缓存模型目录
- 维护 token 生命周期
- 向客户端下发账号信息和运行时凭据

这是新的 SSOT。

## 5.3 Warwolf 使用机（Worker Client）

这是普通用户使用 Warwolf 的机器。

职责：

- 从服务端同步账号目录和投影信息
- 本地运行 vendored `cc-switch` proxy/takeover/runtime
- 启动 Codex / Claude Code / Gemini CLI / OpenClaw
- 不默认持有长效 refresh token

## 5.4 本地 vendored `cc-switch` runtime

这是并入 Warwolf 仓库的核心能力层。

职责：

- provider projection
- auth binding
- proxy token injection
- live config takeover
- tool-specific env generation

一句话：

- 服务端决定“用哪个账号、给什么凭据”
- 本地 vendored `cc-switch` 决定“怎么把它喂给各个 CLI”

## 6. 仓库组织方案

## 6.1 不建议直接把 `cc-switch` 源码散拷到现有目录

如果直接把 `cc-switch/src-tauri/src/*.rs` 和 `src/*.tsx` 打散到 Warwolf 现有目录，会出现：

- 上游来源不可追踪
- 后续升级困难
- 本地改造和上游 diff 混在一起
- 评审边界模糊

## 6.2 推荐仓库组织

建议在 Warwolf 内采用“双层 vendor”结构。

```text
open-claude-code/
  vendor/
    cc-switch-upstream/
      src/
      src-tauri/
      package.json
      ...
  rust/
    crates/
      ccswitch-vendored-core/
      remote-auth-client/
      desktop-core/
      desktop-server/
  apps/
    desktop-shell/
```

### `vendor/cc-switch-upstream`

职责：

- 保留上游原始代码快照
- 便于追踪来源与后续同步
- 默认不直接参与 Warwolf 主构建

### `rust/crates/ccswitch-vendored-core`

职责：

- 从 upstream snapshot 中抽取可复用的 Rust 核心
- 删除 Tauri app/window/tray/deeplink 壳层依赖
- 只保留 domain/service/proxy/live-config/runtime 部分

建议主要吸收：

- `provider.rs`
- `services/*`
- `proxy/*`
- `codex_config.rs`
- `gemini_config.rs`
- 未来新增的 `codex_openai` / `qwen_oauth` remote provider 适配器

### `rust/crates/remote-auth-client`

职责：

- 与远端 OAuth 控制面通信
- 设备注册
- 账号目录同步
- 租约申请与刷新
- 本地加密缓存

### Warwolf 现有 `desktop-core`

职责调整为：

- 聚合本地桌面状态
- 把 `ccswitch-vendored-core + remote-auth-client` 组合成 Warwolf 的模型服务能力

## 7. 服务端设计

## 7.1 服务端职责

远端服务建议明确拆成下面 5 个模块：

### 1. Account Vault

存储：

- `codex_openai` 账号
- `qwen_oauth` 账号
- 账号元数据
- token/refresh token/id token
- 资源地址
- 账号状态

### 2. Auth Operator API

供授权机使用：

- 上传新账号
- 刷新账号
- 删除账号
- 标记默认账号
- 指定账号可见范围

### 3. Account Catalog API

供普通使用机读取：

- 哪些账号可见
- 每个账号的显示信息
- 每个账号的模型目录
- 每个账号支持哪些 tool/runtime projection

### 4. Credential Lease API

供使用机申请短期运行时凭据：

- launch lease
- proxy lease
- token renew

### 5. Audit / Policy API

职责：

- 审计谁用了哪个账号
- 哪个工具在什么时候消费了哪个账号
- 配额告警
- 撤销与封禁

## 7.2 数据模型

### `oauth_accounts`

字段建议：

- `id`
- `provider_kind`：`codex_openai | qwen_oauth`
- `subject`
- `email`
- `display_label`
- `plan_label`
- `status`
- `created_at`
- `updated_at`
- `last_refresh_at`
- `last_error`

### `oauth_credentials`

字段建议：

- `account_id`
- `access_token_enc`
- `refresh_token_enc`
- `id_token_enc`
- `token_type`
- `expires_at`
- `resource_url`
- `raw_payload_enc`

### `account_model_catalogs`

字段建议：

- `account_id`
- `version`
- `models_json`
- `fetched_at`

### `account_assignments`

字段建议：

- `principal_type`：`user | team | org | project`
- `principal_id`
- `account_id`
- `priority`
- `default_for_tool`
- `enabled`

### `credential_leases`

字段建议：

- `lease_id`
- `account_id`
- `device_id`
- `tool`
- `projection_kind`
- `issued_at`
- `expires_at`
- `scope`
- `revoked_at`

## 8. 两类下发模式

## 8.1 推荐默认模式：下发“短期运行时租约”

这是推荐方案。

服务端不把长效 refresh token 下发给使用机，而是给一个短期 lease。

### 对本地客户端返回的内容

- 账号 id
- 工具类型
- provider projection
- proxy base url
- 短期 access token 或等价运行时 token
- 过期时间
- lease id

本地 vendored `cc-switch` proxy 用这个 lease 去跑实际请求。

优点：

- 风险最小
- 服务端可随时撤销
- 账号集中管控

缺点：

- 本地运行更依赖网络
- 需要续租机制

## 8.2 可选模式：下发“设备加密的账号 bundle”

只在明确受信任设备上开启。

流程：

1. 使用机首次注册时生成设备公私钥
2. 服务端只用设备公钥加密 OAuth bundle
3. 使用机本地解密后保存到系统 keychain 或加密文件

bundle 可包含：

- refresh token
- access token
- id token
- resource_url
- TTL

适合场景：

- 需要离线运行
- 受控开发机
- 内网/实验环境

不适合：

- 普通分发终端
- 无法信任的共享设备

## 8.3 兼容结论

因此“服务端下发 OAuth 信息”最终建议支持两档：

1. `lease mode`
   - 默认
   - 不发长效 refresh token
2. `encrypted bundle mode`
   - 仅 trusted device
   - 支持短期离线

## 9. Codex OAuth 方案

## 9.1 授权机如何获取

建议复用 Warwolf 当前已有的本地 Codex 登录实现思路：

- [codex_auth.rs](/Users/champion/Documents/develop/Warwolf/open-claude-code/rust/crates/desktop-core/src/codex_auth.rs)

但运行位置改成授权机。

授权机完成登录后：

1. 提取 `id_token/access_token/refresh_token`
2. 解析账号元信息
3. 上传到远端 Account Vault
4. 服务端负责后续 refresh

## 9.2 服务端如何供给

服务端对 Codex 账号维护：

- token 生命周期
- account label
- model catalog
- account assignment

本地下发建议：

- 默认只发 `lease`
- 本地不再把完整官方 auth profile 当 SSOT

## 9.3 本地如何运行 Codex

继续沿用 `cc-switch` 当前的 takeover 模型：

- `~/.codex/config.toml` 指向本地 proxy `/v1`
- `~/.codex/auth.json` 写 placeholder
- 真实运行时凭据由 vendored `cc-switch` proxy 注入

这样本地使用 Codex 时不必拥有完整官方 OAuth 文件。

## 10. Qwen OAuth 方案

## 10.1 授权机如何获取

Qwen 官方实现表明：

- 它使用 device flow
- token 返回里包含 `resource_url`

参考：

- [auth.md](/Users/champion/Documents/develop/Golden/qwen-code/docs/users/configuration/auth.md)
- [qwenOAuth2.ts](/Users/champion/Documents/develop/Golden/qwen-code/packages/core/src/qwen/qwenOAuth2.ts)
- [qwenContentGenerator.ts](/Users/champion/Documents/develop/Golden/qwen-code/packages/core/src/qwen/qwenContentGenerator.ts)

因此授权机完成登录后，上传的不只是 token，还包括：

- `resource_url`
- 模型目录
- quota 元信息

## 10.2 为什么 Qwen 比 Codex 更需要服务端控制

Qwen OAuth 的关键不只是 `Bearer token`，而是：

- token
- resource_url

这两个必须成对使用。

所以服务端下发给使用机的 runtime 信息也必须成对返回。

## 10.3 本地如何运行 Qwen Code

两种模式：

### 模式 A：仍伪装成本地官方 Qwen OAuth 环境

服务端给本机下发加密 bundle，本地写入 `~/.qwen/oauth_creds.json`

优点：

- 与官方 CLI 最贴近

缺点：

- 本地持有较敏感凭据

### 模式 B：统一走 vendored `cc-switch` proxy

推荐。

做法：

- Qwen CLI 指向本地 proxy 或由 Warwolf 直接注入运行参数
- proxy 根据服务端下发的 `token + resource_url` 动态转发

优点：

- 与 Codex/Claude/Gemini/OpenClaw 一致
- 凭据路径统一
- 更利于多账号选择与切换

## 11. 本地 Warwolf 运行链路

## 11.1 账号同步

Warwolf 启动后：

1. `remote-auth-client` 与服务端建立认证
2. 拉取账号目录与 projection catalog
3. 更新本地缓存
4. 更新模型服务 UI

## 11.2 模型服务页面

模型服务页不再强调“本机 OAuth 登录”，而是分成两层：

### 账号目录

展示：

- OpenAI / Qwen 多账号列表
- 默认账号
- 账号来源：服务端托管
- 最近同步状态

### 本机运行状态

展示：

- proxy 是否运行
- 当前 tool 绑定了哪个 projection
- lease 是否有效
- 是否启用本地离线 bundle

## 11.3 Code Tools 启动

用户在 Warwolf 里选择：

- 工具：Codex / Claude Code / Gemini CLI / OpenClaw
- 账号
- 模型

然后流程是：

1. Warwolf 请求服务端签发 launch lease
2. `remote-auth-client` 拿到 lease
3. vendored `cc-switch` runtime 生成 tool-specific launch profile
4. Warwolf 启动 CLI
5. 本地 proxy 动态注入真实运行时凭据

## 12. 本地组件设计

## 12.1 `ccswitch-vendored-core`

建议包含：

- `auth_binding`
- `provider projection`
- `proxy service`
- `forwarder`
- `takeover service`
- `live config adapters`

但要删除/替换：

- Tauri app shell
- tray
- deeplink UI
- 原本只服务 `cc-switch` 页面状态的逻辑

## 12.2 `remote-auth-client`

建议职责：

- 设备注册
- 服务端登录
- 账号目录同步
- lease 获取/续租
- 本地 bundle 解密
- 本地缓存版本管理

## 12.3 `desktop-core`

需要新增：

- `RemoteAccountCatalog`
- `RemoteProjectionState`
- `LeaseState`
- `TrustedDeviceBundleState`

同时要逐步替换：

- 本地 `codex_auth.rs` 的主导地位
- 本地 `provider_hub` 直接存官方 secret 的逻辑

## 12.4 `desktop-server`

建议新增一组 API：

- `/api/desktop/remote-auth/status`
- `/api/desktop/remote-auth/accounts`
- `/api/desktop/remote-auth/projections`
- `/api/desktop/remote-auth/sync`
- `/api/desktop/remote-auth/leases`

## 13. 服务端 API 设计

## 13.1 授权机 API

- `POST /v1/operator/accounts/codex/login/import`
- `POST /v1/operator/accounts/qwen/login/import`
- `POST /v1/operator/accounts/{id}/refresh`
- `DELETE /v1/operator/accounts/{id}`
- `POST /v1/operator/accounts/{id}/assign`

## 13.2 使用机同步 API

- `GET /v1/client/catalog`
- `GET /v1/client/accounts`
- `GET /v1/client/projections`
- `POST /v1/client/sync`

## 13.3 运行时租约 API

- `POST /v1/client/leases/launch`
- `POST /v1/client/leases/{id}/renew`
- `DELETE /v1/client/leases/{id}`

返回建议包含：

- `lease_id`
- `account_id`
- `projection_kind`
- `protocol`
- `proxy_contract`
- `upstream_base_url`
- `access_token` 或 `runtime_token`
- `expires_at`

## 13.4 Trusted Device Bundle API

仅可选启用：

- `POST /v1/client/devices/register`
- `POST /v1/client/bundles/request`
- `GET /v1/client/bundles/{id}`

## 14. 安全设计

## 14.1 推荐默认策略

默认不下发长效 refresh token 到普通使用机。

普通使用机只拿：

- 账号目录
- 模型目录
- 短期 lease

## 14.2 设备身份

每台 Warwolf 使用机都应该有：

- `device_id`
- 本地设备密钥对
- 服务端签发的设备会话

## 14.3 审计

服务端应记录：

- 哪台设备使用了哪个账号
- 哪个 tool 消耗了哪个 projection
- 何时签发 lease
- 何时续租
- 何时失败

## 14.4 撤销

需要支持：

- 撤销某个账号
- 撤销某台设备
- 撤销某个 lease
- 撤销某个 trusted bundle

## 15. 迁移路线

### Phase 1：把 `cc-switch` 核心 vendored 进 Warwolf

目标：

- 建立 `vendor/cc-switch-upstream`
- 建立 `ccswitch-vendored-core`
- 先不接远端 OAuth

### Phase 2：接入远端账号控制面

目标：

- 新增 `remote-auth-client`
- 能拉取账号目录和模型目录

### Phase 3：Codex 远端托管化

目标：

- Codex 不再以本机 OAuth 为主
- 启动依赖服务端 lease

### Phase 4：Qwen 远端托管化

目标：

- 支持 Qwen OAuth 多账号
- 支持 `resource_url` 成对下发

### Phase 5：统一喂给其他 CLI

目标：

- Claude Code
- Gemini CLI
- OpenClaw

都通过同一套 vendored `cc-switch` proxy/runtime 消费远端账号

## 16. 关键评审点

这版方案最需要先评审拍板的是：

1. 是否接受 `cc-switch` 代码直接 vendored 进 Warwolf，而不是继续走外部依赖
2. 是否接受“授权机”和“使用机”分离
3. 是否接受远端服务成为 OAuth 账号 SSOT
4. 是否接受普通使用机默认不拿长效 refresh token
5. 是否接受本地 CLI 统一继续走 `proxy + placeholder + 动态注入`
6. 是否接受 Qwen 账号按 `token + resource_url` 成对管理

## 17. 推荐结论

在“把 `cc-switch` 代码拷进 Warwolf”这个前提下，我推荐的最终形态是：

1. 把 `cc-switch` 的核心后端代码 vendored 进 Warwolf，但保留 `vendor snapshot + Warwolf 适配层` 的双层结构
2. 不把 OAuth 登录继续放在普通使用机上，而是引入授权机模式
3. 由远端服务统一托管 `Codex OAuth` 与 `Qwen OAuth` 多账号
4. 普通 Warwolf 使用机主要消费账号目录与短期 lease
5. 本地仍使用 vendored `cc-switch` proxy/runtime 去接管并喂给 Codex、Claude Code、Gemini CLI、OpenClaw

一句话总结：

这条路线的本质不是“把登录搬到服务器”，而是把 Warwolf 变成“本地执行层”，把 OAuth 多账号变成“远端控制面资产”，再用 vendored `cc-switch` 作为两者之间的本地 runtime adapter。
