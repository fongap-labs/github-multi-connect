# MCP 服务模块

MCP Hub 将协议传输、服务注册和具体工具实现分开：

- `src/gateway/router.ts` 负责通用 JSON-RPC、初始化、工具发现和调用。
- `src/gateway/registry.ts` 注册服务模块，并从模块声明生成 URL 与 OAuth Resource 的映射。
- `src/services/<module>/` 保存该服务的描述、入口声明、工具定义和调用处理器。

## 注册一个服务

新服务应导出一个 `McpModule`，至少声明稳定的 `id`、客户端可见的 `description` 与 `instructions`、入口列表、`listTools` 和 `callTool`。工具清单由模块根据 `Env` 与当前 `McpAuth` 返回；调用处理器也会收到同一授权上下文，必须再次执行服务自己的权限检查。

随后在 `src/gateway/registry.ts` 将该模块加入 `MCP_MODULES`。每个入口声明自己的 HTTP `path`、OAuth `resourcePath`、保护资源 metadata 路径、协议 `name` 和显示标题。注册表会拒绝重复的模块 ID、入口 ID、路由、Resource 和 metadata 路径，以及格式错误的路由声明。

## 兼容入口

GitHub 模块目前声明两个入口：`/` 和 `/github`。两个入口继续使用不同 OAuth Resource 和访问令牌受众，但暂时共用 GitHub 工具清单与处理器。此映射保持现有客户端 URL 和授权边界；新增服务应使用自己的模块和 Resource，不要复用 GitHub 工具处理器。

`src/mcp.ts` 和 `src/mcp-registry.ts` 保留为旧导入路径的兼容层。新代码应直接导入 `src/gateway/`。

## Resource 与工具授权

`oauth_clients.allowed_resources` 保存获批的入口 ID，`allowed_tools` 保存 URL 编码后的 `模块 ID:工具名`。新注册的 OAuth 客户端两个列表都为空，管理员必须在 `/admin` 明确选择至少一个 Resource 和一个工具。OAuth 授权端点与 MCP 网关都会检查这些策略；工具发现和调用共用同一白名单。

Resource 与工具权限按交集生效：Resource 获批不代表该模块的所有工具都获批，工具获批也不能越过入口的 Resource 限制。同一模块下的多个入口共享工具名单，但每个入口仍需单独授权。

GitHub 模块的 owner 限制和写入开关继续作为额外约束。授权修改会吊销客户端现有令牌并递增 `auth_version`，避免旧 Access Token 或 Refresh Token 保留过期权限。

迁移会为已有获批客户端填入当前 GitHub Resource 与现有工具列表，以免此次升级切断其现有访问。之后新增的工具不会自动进入这些旧白名单；管理员需逐个授权。管理界面读取模块声明生成 Resource 和工具选项，注册新模块不需要改一份中央静态授权清单。
