# 中央部署操作

## 1. 配置归属

部署凭据在中央管理；Worker 运行时密钥留在 Cloudflare Secrets。

### ❌ 错误做法 / 反面教材

在业务仓库保存管理密钥。

```text
mcp-hub 仓库密钥 → 自行部署
```

### ✅ 正确做法 / 规范范例

按用途在中央设置凭据。

```text
Action Worker / Actions Variables
CLOUDFLARE_ACCOUNT_ID_SECONDARY
MCP_PUBLIC_URL=https://mcp.135468.xyz
MCP_D1_ID
MCP_ACTIVE_ID
MCP_OAUTH_TTL=900
GMC_WRITE_MODE=disabled
GMC_CONTENT_MODE=disabled

Action Worker / Environments / production / Secrets
CLOUDFLARE_API_TOKEN_SECONDARY

Action Worker / Environments / mcp-hub-ops
# 仅供专属运维任务；普通部署不使用

Cloudflare / Workers / mcp-hub / Secrets
MCP_ADMIN_KEY
MCP_APPROVAL_KEY
MCP_COOKIE_KEY
MCP_KEYRING_JSON
MCP_INGEST_JWK
MCP_RUNTIME_KEY（可选；至少 32 字符）
```

`AW_REPOSITORY_POLICY` 必须允许此仓库部署。生产部署凭据缺失即失败，不得自动回退。Cloudflare Worker Secrets 的真实状态需运维人员核实。

## 2. 数据迁移

必须先备份和验证数据库。

### ❌ 错误做法 / 反面教材

只改数据库名称或密钥内容。

```text
旧数据库标识 → 改写名称 → 删除原库
```

### ✅ 正确做法 / 规范范例

审计实际资源后迁移。

```text
冻结写入 → 备份旧库 → 新建目标数据库
         → 加密迁移 → 核对行数及解密 → 切流
```

`MCP_D1_ID` 必须是目标数据库的真实标识。保留原密钥材料并离线备份；确认恢复可靠之前不得删除源库。

Cloudflare 端需先建同账户队列 `mcp-hub-dispatch` 和死信队列 `mcp-hub-dispatch-dlq`。派发能力由 Worker 的 `MCP_RUNTIME_KEY` 与队列绑定决定；普通部署不从 GitHub 写入运行时密钥。

关闭已启用的派发时，须在 Cloudflare Worker 上明确删除 `MCP_RUNTIME_KEY` 并验证接口拒绝未授权请求；Wrangler 部署省略 Secret 不会删除此前的值。

## 3. 部署执行

只通过中央人工部署入口。

### ❌ 错误做法 / 反面教材

业务仓库自行发布或跳过来源检查。

```text
仓库推送 → 直接 Wrangler 部署
```

### ✅ 正确做法 / 规范范例

使用中央审批和固定提交。

```text
Action Worker → 手动 · 部署服务
source_repository=fongap-labs/mcp-hub
environment=production
source_sha=留空
product=留空
Main Write Guard bypass=禁用
```

中央校验来源和审批后执行 `scripts/deploy.sh`：检查依赖与部署凭据、预检、数据库迁移、普通 Wrangler 部署，以及根入口、GitHub、授权和提交哈希健康检查。不得生成运行时密钥文件或使用 `--secrets-file`。部署未传某个 Secret，不代表 Cloudflare 已删除它。

## 4. 回滚约束

代码回滚不代表数据库回滚。

### ❌ 错误做法 / 反面教材

部署失败后直接恢复旧代码并忽略数据结构。

```text
数据库已迁移 → 旧代码发布 → 认为恢复完成
```

### ✅ 正确做法 / 规范范例

分别检查代码与数据恢复条件。

```text
代码回滚 → 核对数据库迁移兼容性 → 验证授权与健康状态
```

生产自动部署保持关闭。所有机密值不得进入源码或日志。
