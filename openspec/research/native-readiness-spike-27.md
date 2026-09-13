# Spike #27：Codex 原生 bot 权限、项目可见性与排列

报告日期：2026-09-12（America/Toronto；实验记录使用 2026-09-13 UTC）。
关联：[Spike #27](https://github.com/guwenqing/chatgpt-bot-kit/issues/27)、[原始 Request #9](https://github.com/guwenqing/chatgpt-bot-kit/issues/9)。
作者：当前项目任务中的 `/root`。

**状态：研究报告已整理，按用户要求到此停止。** 产品开发、额外实验、审核和合并均停止。本报告未完成独立审核，不代表产品已经交付，也不授权继续执行。Spike 保持开放，避免把尚未完成的验收记成通过。

## 结论

已经找到并实际运行了一条新 bot 的自动创建路径：用官方 CLI 登记真实项目，通过公开 App Server 为新任务明确设置项目、工作目录和权限，提交真实标明来源的自动初始化输入，再退出创建进程，由桌面原生任务接手。测试任务接手后完成了终端读写和原生工具调用。用户确认手机能看到这个真实项目及任务，并接受手机上的效果。

另一台 Mac 能看到任务，但项目需要在该客户端登记。用户亲自验证：选择 Codex 中已经连接的这台电脑，添加指向同一个 bot 根目录的远程项目，效果可接受。这不是 SSH 接入。用户最终决定现在不开发、不提供登记脚本；以后有需要时再通过 Skill 提供相应帮助。自动登记脚本本次没有实现或验证，不能把“以后可以提供”写成现成功能。

命名与排列有可用的本机原生路径：创建时使用带统一前缀及序号的根目录，桌面登记的真实项目名称与目录名一致；原生项目排序工具可以调整项目顺序。已完成两个研究项目的换序及恢复读回，其他项目、置顶任务的顺序未改变。另一台 Mac 和手机的排序同步未验证。

**研究证明了可行路径，尚未把它接入可重复使用的产品创建流程。** 旧流程仍有缺陷，不能因为一次探针成功就宣布所有问题解决。

## 用户最终确认的边界

- 只支持 macOS，暂不支持 Windows 或云端执行。
- 一个 bot 对应一个独立项目及 workspace，同 bot 的任务共享 workspace。
- 项目命名有规律、容易辨认、可以按期望顺序排列即可；不要求 Bots section、两层结构或共享一个项目。
- 新 bot 的本机完整创建必须自动完成；不能把手工添加项目或逐个调整权限当作默认安装流程。
- 另一台 Mac 的远程项目登记采用用户已经验证的支持方式；脚本和 Skill 中的相关帮助留待以后需要时提供，本次不继续做。
- 用户已删除此前三个旧测试项目；不恢复、不重建、不修复它们。
- 用户最后要求只完成研究报告，然后停止其余全部工作。

## 各问题的证据和限制

| 问题 | 已经建立的证据 | 仍不能声称的结果 |
| --- | --- | --- |
| S1：Full Access 与实际批准行为不一致 | 旧 bot 的记录为受限沙箱/on-request，与创建者的 unrestricted/never 不同。源码存在跨目录创建时丢失或降低继承权限的分支。新探针显式设置权限后，桌面续接实际执行终端命令及原生工具，没有再次逐条要求批准。 | 未完整重放旧任务的创建分支，未解释旧界面为何显示 Full Access；不能推断所有 MCP 操作都永远不会请求批准。 |
| S2：任务为何在手机缺失 | 旧任务最初 preview 为空；用户向 Personal 发言后其 preview 非空并出现。新探针提交了诚实标记的自动初始化输入，产生非空 preview，用户确认项目及任务在手机可见。 | 不把“发你好”当作必须的人工步骤或普遍修复。不同列表路径行为不同；没有完整审计手机客户端实现。 |
| S3：项目与任务关联 | 新探针的服务项目关联非空且 root 正确，桌面可以继续执行。用户确认手机看到实际项目及其任务。 | 桌面 MCP 的旧式 project ID 和服务 project ID 不可混用。桌面任务工具曾返回 projectId 为 null，不能把这一个字段当作全部客户端状态。 |
| S3：另一台 Mac 项目缺失 | 用户确认手工正常创建也有相同行为；在另一台 Mac 登记已连接电脑上的同一路径后，远程项目可用。 | 未验证自动登记实现；没有证明项目列表应跨客户端自动同步。应用重启不是已建立的根本原因。 |
| S3：名称与排列 | 新研究项目的根目录名 `Bot 001 - Bot Father` 被原生登记为相同可见名称。两个研究项目通过原生排序工具换序，再恢复，读回一致。 | 前缀不等于“最近活动”视图会按名称排序。未验证手机或另一台 Mac 的顺序同步、颜色、图标和各种视图下的呈现。 |
| S4：完整自动设置 | 新任务的自动创建、首次输入、桌面接手和实际执行已经串通；不需要伪造用户发言，也未使用私有状态写入。 | 尚未完成产品集成、重复初始化/超时恢复/去重验收、不同权限选择或所有后续任务创建入口的测试。 |

## 自动创建探针：实际经过

环境：`/Applications/ChatGPT.app`，版本 `26.908.40834`，build `8881`；Codex CLI `0.153.4`。

新探针根目录：

```text
/Volumes/DevData/projects/ai/chatgpt-bot-kit/local-data/native-bootstrap-probe/workspace/bots/bot-father
```

1. 用现有 `prepare` 命令准备全新 Bot Father 文件。命令报告 `prepared`、`native_ready: false`，符合文件准备与原生就绪分开报告的约定。
2. 执行官方 `codex app ABS_BOT_ROOT`。退出码为 0，并通过桌面 `list_projects` 验证唯一匹配的项目根目录。
3. 启动短时公开 App Server（stdio），使用诚实的研究客户端身份及 experimental capability。分页查询项目，按精确根目录取得服务项目 ID；查询当前目录可用的权限配置，确认选定配置允许使用。
4. 仅为这一个新探针启动任务。以下是实际请求的关键设置，不是所有用户的新默认权限：

```json
{
  "projectId": "01a09852-9bb6-7dd0-8430-42a206e561c1",
  "permissions": ":danger-full-access",
  "approvalPolicy": "never",
  "approvalsReviewer": "user",
  "model": "gpt-6-astra",
  "config": {"model_reasoning_effort": "high"},
  "allowProviderModelFallback": false,
  "threadSource": "bot-kit-bootstrap-probe",
  "serviceName": "chatgpt-bot-kit",
  "historyMode": "legacy"
}
```

请求还使用上述精确 `cwd`。返回结果包含该目录、服务项目 ID、Astra/high、never、dangerFullAccess 和显式 active permission profile。没有同时发送冲突的 sandbox 字段。

5. 设置任务名，提交明确写着“由编排 agent 发起的自动初始化验证，并非直接用户问候”的输入。任务读取 AGENTS.md、执行 `pwd`、在自己的 work 目录写入验证文件，实际完成。
6. 读回真实任务和非空 preview，取消该连接订阅；创建进程以 0 退出。没有用第二个 App Server 同时控制桌面已在运行的任务。
7. 桌面通过原生发送工具接手该任务。第二轮实际读取并更新验证文件；第三轮调用真正的桌面 `list_projects` 并返回自身项目。三轮均完成，目前空闲。
8. 用户确认手机上的真实项目与任务可见且可接受。另一台 Mac 的远程登记由用户另行手工验证。

身份不能混用：

| 对象 | 实际 ID |
| --- | --- |
| 桌面项目 | `d18925d3-a553-4257-9a8f-519f629dafc9` |
| 服务项目 | `01a09852-9bb6-7dd0-8430-42a206e561c1` |
| 任务 | `01a09854-4456-7012-bc30-d5c96671f882` |
| 首轮 | `01a09854-4b8a-7793-a0a5-4ebbb2fef44a` |
| 桌面续接轮 | `01a09855-f410-7091-a800-a4c9f31f6d69` |
| 桌面工具验证轮 | `01a09857-b752-7562-a13b-e5bae1523314` |

最终验证文件逐字匹配：

```text
BOT_KIT_AUTOMATIC_BOOTSTRAP_OK
DESKTOP_CONTINUATION_OK
```

这证明了测试动作的有效权限及桌面续接。它不证明独立 MCP 授权、其他敏感动作或所有模型/权限组合的行为。

## 名称与顺序探针

另外准备了一个仅用于命名验证的新 Bot Father 根目录：

```text
/Volumes/DevData/projects/ai/chatgpt-bot-kit/local-data/native-naming-probe/workspace/bots/Bot 001 - Bot Father
```

现有 YAML locator 支持该路径，无需更改源码。`codex app` 登记后，桌面 `list_projects` 返回：

- 项目 ID：`b3d681ce-4322-44a2-9e3a-e1da3d0b1b2f`。
- 名称：`Bot 001 - Bot Father`。
- root：与上面的新路径完全一致。

通过 `reorder_sidebar_projects` 交换此项目与前一个 bootstrap 研究项目的次序，再恢复。每次都调用原生 `list_threads` 读取 Projects 条目的顺序。最终所有 section 的条目列表与换序前完全一致，证明操作确实改变并恢复了本机原生排序，其他项目和置顶条目没有变化。没有为这个命名项目新建任务或定时任务。

后续产品可以采用统一前缀、稳定序号和 bot 名称，例如 `Bot 001 - Bot Father`；任务名追加用途，例如 `Bot 001 - Bot Father - 日常`。序号应记录并保留，不能因删除或新增其他 bot 而随意重排；用户显式定制应保留。这仍是方案建议，没有实现为产品规则。

创建时让目录 basename、桌面名称及服务名称一致，可避开当前两套名称来源不一致的问题。已有 bot 的工作目录不应仅为美观而自动搬动。已存在项目的名称编辑能力在应用源码中可见，但本次没有可调用的项目改名 MCP，也未实测该 UI 路径。

## 旧现象的修正

早期“移动项目到 Bots”与后来“移动 Developer 任务到 Bots”是不同操作。用户先在手机看到后者的效果，再去另一台电脑检查；此前重启并未解决。因此不能把改善归因于重启，更不能把一个 section 中出现任务描述成项目已经出现。

旧三个 bot 的权限记录与创建者不一致，空 preview、服务项目关联为空也有实际记录。但这些旧项目已由用户删除。本报告不再提议修复旧实例，亦不把新实例的成功追溯成旧实例已经修好。

## 证据、来源与保存位置

本仓库研究目录（原始运行记录位于被 Git 忽略的 `local-data/`，本报告保留可供后续使用的结论和关键身份）：

- `local-data/native-bootstrap-probe/bootstrap-result.json`：创建请求与返回、真实执行事件、进程退出、桌面续接及用户观察。
- `local-data/native-bootstrap-probe/native-preflight.json`：服务项目与权限预检。
- `local-data/native-bootstrap-probe/workspace/bots/bot-father/work/bootstrap-proof.txt`：实际执行结果。
- `local-data/native-naming-probe/prepare.json`：命名根目录准备结果。
- `local-data/native-naming-probe/ordering-evidence.json`：原生顺序变更前、变更后、恢复后及一致性判断。
- `local-data/native-readiness-spike/`：旧权限、任务与项目、命名排序源码及 issue 读回记录。
- `local-data/remote-visibility-review/`：此前的 preview 和关联调查。

主要只读源码证据：

| 已安装资产 | SHA-256 | 相关内容 |
| --- | --- | --- |
| `webview/assets/app-initial-9b95fa538c62.js` | `737070f94a072d2b4ede9f326e3e1c4142fb82198961251c2e70479b3f926275` | 创建权限继承、任务分组、项目排序工具、项目编辑界面。排序工具分支在字符偏移 4814642；不是公共调用接口。 |
| `.vite/build/main-DaMR-wdT.js` | `0765260be74e8843630d5a92e30bca574783892688e67180c119a5c58679bb61` | 本地/远程项目登记、名称编辑、项目关联逻辑。 |
| `webview/assets/app-primary-44ec287874b7.js` | `28d317396d30902ab5f2c01f069a7b9773f2299b35cc855272d4cf59b402c276` | 原生项目关联界面路径；未调用。 |

已查阅的官方资料：[App Server](https://learn.chatgpt.com/docs/app-server) 用于公开协议与客户端生命周期；[Remote connections](https://learn.chatgpt.com/docs/remote-connections) 用于连接电脑的能力边界；[Projects](https://learn.chatgpt.com/docs/projects) 用于项目与任务概念；[Sandboxing](https://learn.chatgpt.com/docs/sandboxing) 用于权限设置含义。官方说明不代替本次实际设备观察，不证明全部客户端同步或全部批准行为。

没有编辑私有数据库或全局 JSON，没有调用私有 RPC，没有绕过之前的 UI 授权拒绝，没有冒充其他应用，没有把 agent 输入冒充直接用户消息。

## 停止时的交付状态

- 研究结论和已有实验证据已汇总；未经独立审核，不记研究 PASS。
- 本次没有产品源码实现、产品 PR 合并或旧 bot 修复；已有产品 PR 和工作项维持暂停。
- 上述两个新研究项目保留原样；bootstrap 任务空闲，命名探针没有新建任务。没有创建 grooming 或其他定时任务。
- 未提供远程登记脚本，未修改 Skill 来声称脚本已经可用；用户明确要求本次不做。
- 后续仍需产品化创建流程、重复/恢复验证、权限配置与显示一致性处理，以及用户选择客户端上的排列验收。这些只记录为剩余事项，不开始执行。
- 独立审核已因用户停止要求中断。没有新增自动继续机制；用户明确恢复工作之前不再推进。
