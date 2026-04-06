---
title: Desktop Shell Functional Tokens
doc_type: token
status: active
owner: desktop-shell
last_verified: 2026-04-06
source_of_truth: true
related:
  - docs/desktop-shell/README.md
  - docs/desktop-shell/operations/README.md
---

# Warwolf Desktop 功能设计 Token 规范

> 基于 Claude Code v2.1.88 源码逆向提取
> 覆盖：会话模型、权限系统、工具体系、Agent 系统、指令系统、状态机

---

## 一、会话与消息模型

### 1.1 会话状态机

```
SessionState = 'starting' | 'running' | 'detached' | 'stopping' | 'stopped'
```

| 状态 | 含义 | 触发条件 |
|------|------|---------|
| `starting` | 会话初始化中 | 创建会话 |
| `running` | 活跃执行中 | API 调用开始 |
| `detached` | 分离（后台运行） | 用户断开但 agent 继续 |
| `stopping` | 正在停止 | 用户取消 / abort |
| `stopped` | 已停止 | 所有 tool 执行完毕 |

### 1.2 消息类型

```typescript
// SDK 层消息
SDKUserMessage     // 用户消息（含 tool_result）
SDKAssistantMessage // 助手回复（含 text/tool_use/thinking）
SDKResultMessage    // 轮次结束消息

// 内部扩展消息
ProgressMessage     // 工具执行进度
AttachmentMessage   // 文件附件
TombstoneMessage    // 已删除消息占位
SystemMessage       // 系统消息（compact_boundary, api_error, permission_retry）
```

### 1.3 内容块类型 (ContentBlock)

| 类型 | 字段 | 用途 |
|------|------|------|
| `TextBlock` | `text: string` | 文本回复 |
| `ToolUseBlock` | `id, name, input` | 工具调用请求 |
| `ToolResultBlock` | `tool_use_id, content, is_error` | 工具执行结果 |
| `ThinkingBlock` | `thinking: string` | 扩展思考（可隐藏） |
| `RedactedThinkingBlock` | `thinking: "[redacted]"` | 已编辑的思考 |

### 1.4 轮次结束类型 (SDKResultMessage)

```typescript
ResultType =
  | 'success'                          // 正常完成
  | 'error_during_execution'           // 执行中错误
  | 'error_max_turns'                  // 超过最大轮次
  | 'error_max_budget_usd'             // 超过预算
  | 'error_max_structured_output_retries' // 结构化输出重试超限

// 包含字段：duration, cost, usage, token_counts, stop_reason, permission_denials
```

---

## 二、权限系统

### 2.1 权限模式 (PermissionMode)

| 模式 | 行为 | 对应 UI |
|------|------|--------|
| `default` | 危险操作需询问用户 | "Ask permissions" 按钮 |
| `acceptEdits` | 自动接受文件编辑 | "Accept edits" |
| `bypassPermissions` | 跳过所有检查 | "Bypass permissions" / "Danger" |
| `dontAsk` | 不询问，未预批准则拒绝 | "Don't ask" |
| `plan` | 计划模式，不执行工具 | "Plan mode" |
| `auto` | 分类器自动判断（内部） | — |

### 2.2 权限决策

```typescript
PermissionDecision =
  | PermissionAllowDecision   // 允许（可含 updatedInput）
  | PermissionAskDecision     // 询问用户
  | PermissionDenyDecision    // 拒绝（含原因）

PermissionBehavior = 'allow' | 'deny' | 'ask'
```

### 2.3 权限规则来源

| 来源 | 说明 |
|------|------|
| `userSettings` | `~/.claude/settings.json` |
| `projectSettings` | `.claude/settings.json` |
| `localSettings` | `.claude-local/settings.json` |
| `flagSettings` | Feature flags |
| `policySettings` | 企业策略 |
| `cliArg` | 命令行参数 |
| `command` | 指令/技能内指定 |
| `session` | 会话级临时规则 |

### 2.4 权限规则格式

```typescript
PermissionRule = {
  source: PermissionRuleSource,
  ruleBehavior: 'allow' | 'deny' | 'ask',
  ruleValue: {
    toolName: string,        // 工具名，如 "Bash"
    ruleContent?: string     // 可选匹配内容，如 "git *"
  }
}
```

### 2.5 决策原因

```
DecisionReason =
  | 'rule'              // 匹配到权限规则
  | 'mode'              // 基于权限模式
  | 'hook'              // 来自 Hook 回调
  | 'classifier'        // YOLO 分类器（bash 命令）
  | 'workingDir'        // 工作目录限制
  | 'safetyCheck'       // 安全检查（敏感文件等）
  | 'asyncAgent'        // 异步 Agent 评估
  | 'subcommandResults' // 子命令评估结果
  | 'other'
```

---

## 三、工具体系 (Tool System)

### 3.1 工具基础接口

```typescript
Tool {
  name: string
  aliases?: string[]
  description(input, options): string
  prompt(options): string

  // Schema
  inputSchema: ZodSchema
  outputSchema?: ZodSchema

  // 执行
  call(args, context, canUseTool, parentMessage, onProgress): Promise<Result>

  // 安全性标记
  isReadOnly(input): boolean          // 只读操作
  isConcurrencySafe(input): boolean   // 可并发执行
  isDestructive(input): boolean       // 破坏性操作
  interruptBehavior(): 'cancel' | 'block'  // 中断行为

  // 权限
  checkPermissions(input, context): PermissionDecision
  validateInput(input, context): ValidationResult

  // 延迟加载
  shouldDefer?: boolean    // true = 需 ToolSearch 发现
  alwaysLoad?: boolean     // true = 始终加载
  strict?: boolean         // 严格 schema 模式

  // 最大结果大小
  maxResultSizeChars: number
}
```

### 3.2 内置工具清单 (32+)

#### 文件操作

| 工具名 | 功能 | 只读 | 可并发 |
|--------|------|------|--------|
| `Read` | 读取文件（支持 PDF/图片/notebook） | ✅ | ✅ |
| `Write` | 创建/覆盖文件 | ❌ | ❌ |
| `Edit` | 查找替换编辑 | ❌ | ❌ |
| `Glob` | 文件名模式搜索 | ✅ | ✅ |
| `Grep` | 文件内容正则搜索 | ✅ | ✅ |
| `NotebookEdit` | Jupyter notebook 编辑 | ❌ | ❌ |

#### 执行

| 工具名 | 功能 | 只读 | 可并发 |
|--------|------|------|--------|
| `Bash` | 执行 shell 命令 | 视命令 | 视命令 |
| `PowerShell` | 执行 PS 命令（Windows） | 视命令 | 视命令 |

#### Agent 与技能

| 工具名 | 功能 | 延迟加载 |
|--------|------|---------|
| `Agent` | 启动子 Agent | ❌ |
| `Skill` | 执行技能脚本 | ❌ |
| `SendMessage` | 多 Agent 通信 | ✅ |
| `AskUserQuestion` | 询问用户问题 | ✅ |

#### 计划与隔离

| 工具名 | 功能 |
|--------|------|
| `EnterPlanMode` | 进入计划模式 |
| `ExitPlanMode` | 退出计划模式 |
| `EnterWorktree` | 创建 Git worktree 隔离 |
| `ExitWorktree` | 退出 worktree |

#### 任务管理

| 工具名 | 功能 | 延迟加载 |
|--------|------|---------|
| `TodoWrite` | 管理任务清单（v1） | ✅ |
| `TaskCreate` | 创建任务（v2） | ✅ |
| `TaskUpdate` | 更新任务状态 | ✅ |
| `TaskOutput` | 获取后台任务输出 | ✅ |
| `TaskStop` | 停止任务 | ✅ |

#### Web

| 工具名 | 功能 | 延迟加载 |
|--------|------|---------|
| `WebSearch` | 网页搜索 | ✅ |
| `WebFetch` | 抓取网页内容 | ✅ |

#### 定时与远程

| 工具名 | 功能 |
|--------|------|
| `CronCreate` | 创建定时任务 |
| `CronList` | 列出定时任务 |
| `CronDelete` | 删除定时任务 |
| `RemoteTrigger` | 管理远程 Agent 触发器 |

#### MCP 集成

| 工具名 | 功能 |
|--------|------|
| `ToolSearch` | 搜索延迟加载的工具 |
| `ListMcpResources` | 列出 MCP 资源 |
| `ReadMcpResource` | 读取 MCP 资源 |
| `MCPTool` | 调用 MCP 服务器工具 |

### 3.3 MCP 工具命名规则

```
mcp__<serverName>__<toolName>
```

例：`mcp__github__create_issue`

### 3.4 工具延迟加载机制

```
shouldDefer: true  → 工具隐藏，需通过 ToolSearch 发现
alwaysLoad: true   → 始终加载（优先于 defer）
```

目的：减少初始 prompt 大小，按需加载。

---

## 四、Agent/子代理系统

### 4.1 内置 Agent 类型

| 类型 | 用途 | 可用工具 |
|------|------|---------|
| `general-purpose` | 通用多步任务 | 全部 |
| `plan` | 架构设计、实施规划 | 除 Agent/Edit/Write/NotebookEdit 外 |
| `explore` | 快速代码探索 | 除 Agent/Edit/Write/NotebookEdit 外 |
| `verification` | 验证实现 | 除 Agent/Edit/Write/NotebookEdit 外 |
| `claude-code-guide` | Claude Code 使用指南 | Glob/Grep/Read/WebFetch/WebSearch |

### 4.2 Agent 启动参数

```typescript
AgentTool.input = {
  description: string,       // 3-5 词描述
  prompt: string,            // 任务描述
  subagent_type?: string,    // Agent 类型
  model?: 'sonnet' | 'opus' | 'haiku',  // 模型覆盖
  run_in_background?: boolean, // 后台执行
  isolation?: 'worktree',    // Git worktree 隔离
}
```

### 4.3 Agent 隔离模式

| 模式 | 机制 | 用途 |
|------|------|------|
| 无隔离 | 共享工作目录 | 简单只读查询 |
| `worktree` | Git worktree 临时分支 | 需要文件修改的独立任务 |
| `remote` | CCR 远程环境 | 企业/云端执行 |

### 4.4 多 Agent 通信

```typescript
SendMessage.input = {
  to: string,      // 目标 Agent 名 | "*" 广播
  message: string  // 消息内容
}
```

通信通过 Mailbox 队列：`writeToMailbox()` → `getMailboxMessages()`

---

## 五、指令系统 (Slash Commands)

### 5.1 指令类型

| 类型 | 执行方式 | 例子 |
|------|---------|------|
| `prompt` | 展开为提示词发给模型 | `/commit`, `/review-pr` |
| `local` | 本地同步执行，返回文本 | `/clear`, `/cost` |
| `local-jsx` | 本地异步，渲染交互 UI | `/config`, `/theme` |

### 5.2 核心内置指令

| 指令 | 类型 | 功能 |
|------|------|------|
| `/help` | local | 显示帮助 |
| `/clear` | local | 清除对话 |
| `/compact` | local | 压缩对话历史 |
| `/config` | local-jsx | 修改设置 |
| `/cost` | local | 显示费用统计 |
| `/diff` | local | 显示文件变更 |
| `/session` | local | 会话管理 |
| `/theme` | local-jsx | 切换主题 |
| `/model` | local-jsx | 切换模型 |
| `/commit` | prompt | 提交代码 |
| `/review` | prompt | 代码审查 |
| `/plan` | prompt | 进入计划模式 |
| `/exit` | local | 退出 |
| `/login` | local | 登录 |
| `/logout` | local | 登出 |
| `/mcp` | local-jsx | MCP 服务器管理 |
| `/skills` | local | 列出可用技能 |

### 5.3 指令属性

```typescript
Command = {
  name: string,
  aliases?: string[],
  description: string,
  argumentHint?: string,        // 参数提示
  isHidden?: boolean,           // 隐藏（不在 /help 中显示）
  isSensitive?: boolean,        // 敏感（参数不记录到历史）
  userInvocable?: boolean,      // 用户可直接调用
  disableModelInvocation?: boolean, // 禁止模型调用
  availability?: CommandAvailability[], // 认证要求
  isEnabled?: () => boolean,    // 功能开关
}
```

---

## 六、Hooks 系统

### 6.1 Hook 事件

| 事件 | 触发时机 |
|------|---------|
| `SessionStart` | 会话开始 |
| `SubagentStart` | 子 Agent 启动 |
| `PreToolUse` | 工具执行前 |
| `PostToolUse` | 工具执行后 |
| `PostToolUseFailure` | 工具执行失败后 |
| `PermissionRequest` | 权限请求 |
| `PermissionDenied` | 权限拒绝 |
| `UserPromptSubmit` | 用户提交消息 |
| `FileChanged` | 文件变更 |
| `Notification` | 通知 |
| `CwdChanged` | 工作目录变更 |
| `StopFailure` | 停止失败 |

### 6.2 Hook 响应

```typescript
HookResponse = {
  continue: boolean,           // 是否继续
  decision?: 'allow' | 'deny', // 权限决策覆盖
  reason?: string,             // 原因
  systemMessage?: string,      // 注入系统消息
  updatedInput?: object,       // 修改工具输入
}
```

---

## 七、项目上下文管理

### 7.1 配置作用域

| 作用域 | 路径 | 优先级 |
|--------|------|--------|
| `user` | `~/.claude/settings.json` | 最低 |
| `project` | `.claude/settings.json` | 中 |
| `local` | `.claude-local/settings.json` | 高 |
| `enterprise` | 企业管理配置 | 高 |
| `policy` | 策略配置 | 最高 |

### 7.2 CLAUDE.md 发现

- 从 CWD 向上遍历查找
- 缓存在 `readFileState`（LRU）
- 去重（避免重复注入）
- `--bare` 模式可跳过

### 7.3 Git 集成

会话启动时快照：
- 当前分支、主分支
- Git 用户信息
- 工作目录状态
- 最近提交记录

---

## 八、流式与性能

### 8.1 StreamingToolExecutor

```
并发安全工具 → 并行执行
非并发安全工具 → 独占执行（阻塞其他）
进度消息 → 立即 yield
结果 → 按顺序缓冲后 yield
```

### 8.2 对话压缩

| 机制 | 说明 |
|------|------|
| Compaction | 旧轮次摘要压缩 |
| Snipping | 截断极老历史（feature-gated） |
| Microcompact | 增量小边界压缩 |

### 8.3 文件缓存

- `FileStateCache`（LRU）：跨轮次缓存文件读取
- `cloneFileStateCache()`：子 Agent 上下文隔离
- 独立限制：`fileReadingLimits`, `globLimits`

---

## 九、MCP 服务器集成

### 9.1 传输类型

| 类型 | 协议 | 用途 |
|------|------|------|
| `stdio` | 本地子进程 | 本地 MCP 服务器 |
| `sse` | Server-Sent Events | 远程 HTTP 服务器 |
| `http` | REST | REST API 端点 |
| `ws` | WebSocket | 实时双向通信 |
| `sdk` | 进程内 | 内嵌 SDK 服务器 |

### 9.2 服务器配置作用域

```
'local' | 'user' | 'project' | 'dynamic' | 'enterprise' | 'managed'
```

### 9.3 服务器能力

- `resources` — 资源浏览
- `roots` — 根目录
- `sampling` — 采样
- `prompts` — 提示模板
- `tools` — 工具定义

---

## 十、与桌面端复刻的映射关系

| Claude Code 功能 | 桌面端复刻优先级 | 当前状态 |
|------------------|----------------|---------|
| 会话管理（创建/恢复/列表） | P0 | ✅ 基础已有 |
| 消息流式渲染 | P0 | ✅ 基础已有 |
| 权限模式切换 | P0 | ⬜ 仅 UI 占位 |
| 内置工具调用 + 结果展示 | P0 | ✅ 部分（Bash/Read/Edit） |
| 工具权限询问 UI | P1 | ⬜ 未实现 |
| 斜杠命令系统 | P1 | ⬜ 未实现 |
| Agent 子代理 | P1 | ⬜ 未实现 |
| MCP 服务器管理 | P1 | ⬜ UI 占位 |
| CLAUDE.md 上下文 | P2 | ⬜ 未实现 |
| Hooks 系统 | P2 | ⬜ 未实现 |
| Git worktree 隔离 | P2 | ⬜ 未实现 |
| 对话压缩/历史管理 | P2 | ⬜ 未实现 |
| 计划模式 | P3 | ⬜ 未实现 |
| 定时任务 (Cron) | P3 | ⬜ 未实现 |
| 多 Agent 通信 | P3 | ⬜ 未实现 |
| 主题系统（6 变体） | P3 | ✅ 已有双轨 warwolf |
