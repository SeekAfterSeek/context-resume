---
name: context-resume
version: "1.0.0"
display_name: 上下文恢复（选任务接着做）
display_name_en: Context Resume
description: Use when the user wants to continue work from a previous WorkBuddy task/session in a new window — "接着上次做", "恢复之前的任务", "继续那个项目", "把之前的上下文加载过来", "上下文快满了", "branch", "resume", "load context". Lists the user's past tasks (read from local session records), lets them pick one via a chooser, then loads that task's full context into portable files and restates what was done and what is next.
description_zh: 在新窗口里挑选一个历史任务，自动加载它的全部上下文（目标/进展/产物文件/待办），接着做。
trigger_keywords:
  - 恢复
  - 接着上次
  - 继续之前的任务
  - 加载上下文
  - 上下文快满了
  - 分支
  - resume
agent_created: true
---

# Context Resume —— 选一个历史任务，把上下文加载过来

把「WorkBuddy 里做过的某个任务」的上下文，一键加载进当前这个新窗口。
数据来源是本机会话记录（`~/.workbuddy/projects/<空间>/<会话>.jsonl`），不依赖云端、不需要账号。

## 何时触发

用户表达「接着之前那个任务做 / 恢复 / 继续上次 / 把上下文弄过来 / 这个窗口接着干」这类意图时。
用户点名了具体任务名时，也可以直接用（流程 B）。

## 工具

脚本位置（相对本技能目录）：

```bash
node bin/cr.js list --json          # 列出历史任务
node bin/cr.js load <编号|会话ID>    # 加载某个任务的上下文
```

## 流程 A：用户没点名，先让他选（默认走这条）

1. 运行 `node bin/cr.js list --json`，拿到按最后活动时间倒序的任务数组
   （字段：`sessionId` / `shortId` / `title` / `cwd` / `lastTime` / `rel` / `messageCount` / `toolCount`）。

2. **调用选择控件让用户点选，不要用文字列一串让人回数字**：
   - 取最近 3 个任务作为选项，`label` 用标题（超过 14 字截断），`description` 写
     `"<lastTime> · <messageCount> 条对话 · <cwd>"`
   - 第 4 个选项固定为 `查看更多任务`，`description` 为「列出更早的 12 个任务」
   - 问题文案：`要把哪个任务的上下文加载到当前窗口？`

3. 用户选了 `查看更多任务` → 运行 `node bin/cr.js list --limit 12`，把**编号清单原文**贴出来，
   让用户回编号；用户回了编号就继续第 4 步。

4. 运行加载：

   ```bash
   node bin/cr.js load <选中项的 sessionId 或编号>
   ```

   成功时输出里有一行 `RESUME_MAIN=<路径>`，其余 `RESUME_BRIEF` / `RESUME_FULL` 备用。

5. `Read` 那个 `RESUME_MAIN` 文件（通常 2~5KB，可整篇读）。

6. **向用户复述三件事，再干活**（这是「加载成功」的唯一证明）：
   - 这个任务在做什么（一句话）
   - 已经做到哪（2~3 条）
   - 下一步该做什么（1~3 条，带具体路径/命令）

7. 如果任务原来的工作目录 `RESUME_CWD` 与当前窗口的工作目录不同，**必须提醒**：
   > 这个任务原来在 `X` 目录，当前窗口是 `Y`。后续涉及文件的存取我会用绝对路径指到 `X`；
   > 如果你希望文件落在当前目录，告诉我。

   这是因为切换工作目录需要用户自己新建任务，工具无法代劳。

## 流程 B：用户点名了任务

先 `node bin/cr.js list --json`，在 `title` 里做模糊匹配（忽略大小写/空格）。
- 命中 1 个 → 直接 `load` 它。
- 命中多个 → 走流程 A 的第 2 步，只把这几个作为选项。
- 一个都没命中 → 贴出完整清单让用户选，不要瞎猜。

## 流程 C：用户直接给了会话 ID

跳过选择，直接 `load <ID>`，然后走流程 A 的第 5~7 步。

## 硬性规则

- **绝不假装记得**：所有「上次做到哪」的信息必须来自 `RESUME_MAIN`，不能凭印象编。
- **不要整篇读 `RESUME_FULL`**：它可能是几 MB。需要具体细节时用 grep 在 `RESUME_FULL` 里定位关键词，再读命中行附近。
- **加载不等于继续**：复述完先等用户确认方向，再动手改文件。
- 加载是只读操作，不会改动原会话；原任务本身仍可正常打开。

## 边界

- 只能读到**本机** WorkBuddy 的会话记录（换电脑/换账号就读不到）。
- 上下文是「按需检索」而非「整段塞入」：摘要必读，细节按需 grep，效果等价于记得，但不会占满窗口。
- 会话记录里没有的内容（用户当时口头说但没落盘的），工具也不会知道。
