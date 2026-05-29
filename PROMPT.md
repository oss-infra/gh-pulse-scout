你是一个资深的 Node.js/TypeScript 研发工程师。我现在需要开发一个 CLI 小工具，用于抓取目标 GitHub 仓库最近一个月的所有 Issues（不包含 Pull Requests），并汇总数据通过 openai api 兼容的接口通过ai大模型生成方便用户理解的项目状态分析报告。

【技术栈要求】
- 运行环境：Node.js
- 语言：TypeScript (严格模式)
- 核心依赖：
  - `@octokit/rest`: 用于与 GitHub REST API 交互。
  - `dayjs` 或 `date-fns`: 用于优雅地计算时间和日期差。
  - `chalk` 和 `cli-table3`: 用于美化终端输出（颜色和表格）。
  - `dotenv`: 用于本地读取环境变量。
  - `openai`: 用于发送 HTTP 请求（如调用 OpenAI API）。
  - `node-cache` 或类似库：用于实现简单的本地缓存机制，减少重复 API 请求。
  - `commander`: 用于构建 CLI 接口，解析命令行参数和选项。

【核心功能与步骤】
1. 身份验证：通过环境变量 `GITHUB_TOKEN` 实例化 Octokit，避免 API 速率限制。
2. 数据抓取：接收用户输入的仓库名（格式 "owner/repo"），计算出 30 天前的 ISO 时间字符串。利用 `octokit.paginate` 和 `octokit.rest.issues.listForRepo` 抓取过去 30 天内创建及更新的 Issues。
3. 数据清洗与类型定义：
   - 过滤掉本质是 PR 的 Issue（排除包含 `pull_request` 属性的项）。
   - 定义清晰的 `IssueData` TypeScript 接口，提取必要字段：number, title, state, created_at, closed_at, user(login), labels(name), comments。
4. 数据分析与聚合：
   - 计算活跃度、响应效率、参与度、问题分类和社区热度等维度。
   - 使用数组的 map/filter/reduce 等方法进行数据处理和统计。
5. 增加必要的错误处理逻辑，确保在网络异常或仓库不存在时给出友好的提示。
6. 增加缓存机制（可选）：对于同一仓库的重复查询，可以将结果缓存到本地文件系统，设置合理的过期时间（如 1 小时），以减少 API 请求次数。
7. 生成可用的文档和使用说明，指导用户如何安装依赖、设置环境变量以及运行脚本。
8. 同时可以作为 GitHub action 使用，自动在指定事件（如 push 或 schedule）触发时运行分析脚本，并将结果输出到 GitHub Actions 的日志或者作为输出到 dingtalk 机器人等。 

【需要分析的维度（核心聚合逻辑）】
请基于抓取到的数据，使用数组的 map/filter/reduce 等方法计算以下维度：
- 活跃度：近30天新增 Issue 数、关闭 Issue 数、未解决 Issue 数。
- 响应效率：
  - 平均关闭时间（Closed_at - Created_at，单位：天或小时）。
  - *注：获取“首次响应时间”需要额外请求 comment 接口，考虑到 API 消耗，本版脚本可先跳过首次响应时间，仅通过 comments 数量评估热度。*
- 参与度：提交过 Issue 的去重用户总数（Set 结构去重）。
- 问题分类：统计各个 Label 的出现频次，输出 Top 5 的标签。
- 社区热度：按评论数倒序排列，列出评论数 Top 5 的 Issues 链接和标题。