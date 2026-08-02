# Firebase / GCP 日志与 Admin 审计 Runbook

日志由 Cloud Logging 保存，Admin 关键动作写入 Firestore `audit_logs`。网站没有日志页面，开发者从 Firebase / GCP Console 查询。

截至 2026-08-02，生产项目 `sport-stacking-website` 已完成 Functions、Firestore Rules、TTL 和 Monitoring 告警部署；Hosting 刻意未部署。其他 callable 的 App Check enforcement 仍等待 24–48 小时观察后再逐项开启。

Cloud Logging 使用项目默认约 30 天 retention；Firestore audit 通过 `expireAt` 保留 365 天。

## 本地验证

```bash
yarn validate
yarn build
yarn workspace functions build
yarn workspace functions lint
yarn rules:smoke
yarn workspace functions test
```

`yarn rules:smoke` 会启动 Firestore Emulator，确认客户端不能写 `audit_logs` 和 `client_error_rate_limits`，同时确认原有业务 collection 的 catch-all 行为没有在这次改动中改变。Functions 测试使用独立的 `firebase.functions.test.json`（端口 8082），需要本机可运行 Firebase Emulator。

生产 Vite build 使用 Git SHA 作为 release，并生成 hidden source maps。GitHub Actions 会先把 `dist/**/*.map` 上传为保存 90 天的 artifact，再从 Hosting 的 `dist` 删除 map；因此公开 Hosting 不会暴露 source map。

## 部署顺序（由开发者执行）

1. 确认 Firebase App Check 已注册、Monitoring 邮箱和预算已设置；先不要对现有 callable/API 全面开启 enforcement。
2. 部署 Functions（本次已完成；审计与低流量 Admin endpoint 使用 `0.5 vCPU / maxInstances=1 / concurrency=1`，避免区域 quota）：

   ```bash
   firebase deploy --only functions
   ```

3. 部署 Firestore Rules（本次已完成；它会把 `audit_logs` 与限流 collection 设为客户端完全不可读写）：

   ```bash
   firebase deploy --only firestore:rules
   ```

4. 部署 Hosting（本次刻意跳过，下一次发布再执行）：

   ```bash
   yarn build
   firebase deploy --only hosting
   ```

5. 做受控验证：登录用户触发一次 React / Firebase 错误，确认 `reportClientError` 返回 `accepted: true`，并在 Logs Explorer 看到 `jsonPayload.event="client.error"`。重复相同错误应在 60 秒内去重；同一 UID 在 5 分钟超过 20 条应返回 `resource-exhausted`。未登录错误不会上传，因为 callable 要求 Firebase Auth。
6. 用 Admin callable 做一次报名、队伍、成绩或权限变更，再做一次删除；在 Firestore Console 的 `audit_logs` 检查 `actorUid`、唯一的 `actorGlobalId`（或多 profile 时的 `actorGlobalIds`）、`operationId`、允许的 before/after 和 `expireAt`。由系统同步产生的写入不应重复生成用户审计。
7. 开启一年 TTL（本次已完成；`audit_logs` 与 `client_error_rate_limits` 的 `expireAt` 都显示 `ACTIVE`）：

   ```bash
   gcloud firestore fields ttls update expireAt \
     --collection-group=audit_logs \
     --database='(default)' \
     --enable-ttl \
     --project=YOUR_FIREBASE_PROJECT_ID
   ```

   也可以在 Firestore Console 的 TTL 页面完成同样操作。TTL 是异步清理，不要把它当作精确到期时间。
   `client_error_rate_limits` 也使用 `expireAt`，建议再执行一次相同命令并把
   `--collection-group` 改成 `client_error_rate_limits`，避免限流计数文档长期累积。
8. 建立告警并指定 Monitoring 邮箱（本次已完成），然后观察 24–48 小时。确认新 callable 的 App Check token 流量正常后，再按项目现有 App Check 清单逐项开启其他 callable 的 enforcement；不要在这次发布中一次性扩大规则范围。

旧 `admin_team_audits` 与 `profile_ownership_audits` 数据保留作历史查询，但代码不再新增记录。新记录统一进入 `audit_logs`。

## Logs Explorer 查询

以下过滤器可直接粘贴到 Logs Explorer；Cloud Functions 第 2 代通常使用 `cloud_run_revision`，旧执行环境可能使用 `cloud_function`。

按操作者 Global ID：

```text
(resource.type="cloud_run_revision" OR resource.type="cloud_function")
jsonPayload.actorGlobalId="G123456"
```

按 operation ID、赛事或 execution ID：

```text
jsonPayload.operationId="OPERATION_ID"
jsonPayload.tournamentId="TOURNAMENT_ID"
labels.execution_id="EXECUTION_ID"
```

按错误严重度：

```text
severity>=ERROR
jsonPayload.event="client.error"
```

结构化字段包括 `event`、`status`、`operationId`、服务端 `release`、`actorUid`、`actorGlobalId`、`tournamentId`、实体 ID、错误类型/安全化 message/stack 和（适用时）耗时。错误 stack 与 message 分别限制为 8 KB / 1 KB；敏感字段会在写入前移除。

## Audit 查询与字段边界

开发者在 Firestore Console 查询 `audit_logs` 的 `actorGlobalId`、`action`、`tournamentId`、`entityType`、`createdAt`。客户端 Rules 对该 collection 一律拒绝，不能用浏览器 SDK 读取。

允许的差异只包含：

- 成绩、罚分、确认状态和参与者 Global ID；
- 报名状态、项目和来源；
- 队伍成员 Global ID；
- 赛事状态、编辑者/记录者和权限配置；
- 用户角色、账号状态和 ownership 的 UID 变化。

姓名、邮箱、证件、token、文件内容、payment URL 和完整 document 不进入 audit。`expireAt` 默认在写入后 365 天。

## 告警建议

在 Logs Explorer 先保存下列查询，再从查询建立 Log-based Alert：

- `severity=CRITICAL`：任一条立即通知；
- `severity=ERROR`：窗口 5 分钟内达到 5 条通知。

通知渠道使用已验证的 Monitoring 邮箱。告警内容保留 `event`、`operationId`、`release`、`tournamentId` 和 execution ID，避免把原始请求或 PII 放入邮件。

## 本地 stack symbolication

GitHub Actions artifact 下载后，使用对应 release 的 map（不要把 map 上传到 Hosting）：

```bash
yarn symbolicate dist/assets/index-XXXXXXXX.js.map 123 45
```

输出原始 source、line、column 和 symbol。`123` 是 bundle 的 1-based 行号，`45` 是 0-based column。必须使用相同 Git SHA 的 map；不同 release 的 map 可能给出错误位置。

## 发生问题时

- `reportClientError` 被拒绝：先检查用户是否已登录、App Check token、Functions region，以及 Logs Explorer 中 `reportClientError` 的拒绝原因；登录页错误只会留在浏览器本地日志。
- Audit 缺少 Global ID：检查 UID 是否仍拥有 active `users.owner_uids` profile；多 profile 时预期会保存 `actorGlobalIds`，明确传入的 active profile 必须通过后端 ownership/权限验证。
- Audit 写入失败：先保留业务写入结果，按 `audit.firestore_change_failed` 或对应 callable 的 `operationId` 查询；不要让客户端直接写 `audit_logs` 作为补救。
- 公开 Hosting 发现 `.map`：停止发布并检查 CI artifact/delete 步骤；本地 `yarn build` 会生成 map 是预期行为，公开部署前必须执行删除步骤。
