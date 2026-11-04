# Changelog

## [Unreleased]

- 新增: 定义 Runner Protocol v1 注册、能力、心跳、容量和失效语义，并添加纯函数验证。
- 新增: Runner 注册表、一次性 bearer 凭据、服务端心跳和并发受限的幂等租约。
- 新增: Runner 派发合同、容量/额度筛选、Cloudflare Queue outbox、接受/拒绝/取消与 Runtime 状态对账；派发只保存不透明任务引用。
- 新增: 管理页展示派发队列、租约和过期额度报告指标。
