---
name: context-resume
version: "1.1.1"
display_name: 上下文恢复（选任务接着做）
display_name_en: Context Resume
description: Use when the user wants to continue work from a previous WorkBuddy task/session in a new window — "恢复", "接着上次做", "继续之前的任务", "加载上下文", "把之前的弄过来", "上下文快满了", "resume", "load context". Lists the user's recent tasks (and their spaces), lets them pick one via a chooser, then loads that task's context (goal, progress, touched files, open todos) and restates what was done and what is next.
description_zh: 在新窗口里挑选一个历史任务（可按最近任务或按空间），自动加载它的上下文并复述进度，接着做。
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

## ⚠️ 第一动作（最重要，必须照做）

**收到触发后，不要输出任何解释文字，不要先跑脚本，直接调用选择控件。**

选项直接从下面「最近任务快照」里取最近 3 条：

- `label` = 该条的任务标题（**超过 24 字才截断，不要提前砍**）
- `description` = `"你说：<该条「你说」字段的前 24 字> · <空间> · <相对时间>"`
  - 这一项是为了让用户能把面板选项和侧边栏任务对上，**不能省**
- 第 4 个选项固定：
  - `label`：`查看更多 / 按空间选`
  - `description`：`列出 20 个任务，并按空间分组`
- 问题文案：`要恢复哪段上下文？`

**禁止**在这一轮里输出以下任何内容（这会让用户以为"没弹框"）：
`好的` / `我先加载…` / `我来帮你…` / `最近你在做…` / 任何总结或复述。

例外：只有当快照为空、或快照时间距今超过 3 小时、或用户明确说「重新扫一遍」时，才先执行
`node bin/cr.js list --limit 3` 再弹出选择。

## 用户选了某个具体任务

```bash
node bin/cr.js load <快照里的 sessionId 或编号>
```

然后 `Read` 输出里的 `RESUME_MAIN` 文件，并且：

1. 复述三件事：**这个任务在做什么 / 已经做到哪 / 下一步该做什么**。
2. 如果 `RESUME_CWD` 与当前窗口的工作目录不同，提醒用户，后续文件操作使用原目录绝对路径。

## 用户选了「查看更多 / 按空间选」

```bash
node bin/cr.js list --limit 20      # 20 个任务（同空间同标题已去重）
node bin/cr.js spaces               # 空间聚合，每个空间几个任务
```

把这两段输出**原样贴出来**，然后说一句：回编号直接加载，回空间名就看该空间的任务。

- 用户回编号 → `node bin/cr.js load <编号>`
- 用户回空间名 → `node bin/cr.js list --space <空间名>`，再弹一次选择控件（这次选项来自该空间的输出）

## 用户直接说了任务名

在快照或 `list` 结果里做模糊匹配：

- 唯一命中 → 直接 `load`
- 多个命中 → 把命中的几个作为选项弹选择控件
- 没有命中 → 贴出 `list --limit 20` 的结果，让用户回编号

## 硬性规则

- **绝不编造**「上次做到哪」，一切以 `RESUME_MAIN` 为准。
- **不要整篇读 `RESUME_FULL`**（可能几 MB），需要细节用 grep 定位关键词。
- **加载完先复述、等确认，再动手改文件。**
- 只读操作：不改动原会话，原任务仍可正常打开。

## 命令行速查

```bash
node bin/cr.js list [--limit 20] [--json] [--space <空间名>] [--all]
node bin/cr.js spaces [--json]
node bin/cr.js load <编号|会话ID> [--out <目录>]
```

`--all` 会把定时任务（`automation-*`）产生的会话也算进来，默认排除。

## 最近任务快照

<!-- SNAPSHOT:START -->
（快照时间：2026/10/30 21:22:12，可用 `node bin/cr.js list` 刷新）
 1. 编写谷歌词典选词翻译快捷键插件
    你说：我想写一个谷歌插件，就是我把一个单词拉上之后，按一个快捷键就能调出这个翻… ｜ WorkBuddy · 刚刚 · 188 条对话
    ID: b0ce03a7-edb0-49e0-a02b-40e65fcc30aa
 2. 打招呼问候
    你说：你好 ｜ Claw · 7 小时前 · 25 条对话
    ID: 6af938d3-b123-4673-aa1e-15f085c78b44
 3. 测试 Clash 节点实际 IP
    你说：你来测试一下我的 Clash 里面每个节点的实际 IP ｜ WorkBuddy · 2 天前 · 20 条对话
    ID: cd865be8-c925-4e86-bc87-0c7ddef0dd23
 4. 设置 WorkBuddy 使用 Edge 浏览器打开
    你说：我想设置让 WorkBuddy 自动打开的浏览器是微软自带的浏览器，而不… ｜ WorkBuddy · 3 天前 · 61 条对话
    ID: 96886778-eed1-40c8-a4ed-57d9d8cef276
 5. 排查 WorkBuddy 网络慢的原因
    你说：看一下是不是WorkBuddy的网络通道，为什么这么慢 ｜ WorkBuddy · 3 天前 · 27 条对话
    ID: 73afaaa6-d8f7-4c24-8e06-f44ab9fb8e43
<!-- SNAPSHOT:END -->
