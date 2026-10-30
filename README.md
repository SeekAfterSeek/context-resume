# context-resume

在**新的 WorkBuddy 窗口**里，挑一个历史任务，把它完整的上下文加载进来，接着说。

给 WorkBuddy 补上一个 ChatGPT 有、但它目前没有的能力：**会话分支**。

---

## 它解决什么问题

WorkBuddy 的上下文只在**同一个任务内**延续。开新任务 = 全新上下文，之前做到哪、改过哪些文件、下一步是什么，全丢了。
这个工具把「某个历史任务的上下文」从本机会话记录里读出来，压成一份可读摘要，塞进新窗口。

## 用法（任选一种）

**① 说一句话 / 敲 `/context-resume`**

> 恢复 / 接着上次那个任务做 / 把之前的上下文加载过来

会直接弹出选择框，列出最近 3 个任务（标题 · 空间 · 相对时间 · 对话条数），
第 4 项是「查看更多 / 按空间选」：选它就把 20 个任务 + 空间聚合一并列出，回编号或回空间名都可以。

**② 点名任务**

> 恢复「测试 Clash 节点实际 IP」

**③ 命令行**

```bash
node bin/cr.js list                # 看最近 12 个任务
node bin/cr.js list --json         # 机器可读
node bin/cr.js load 2              # 按清单编号加载
node bin/cr.js load cd865be8       # 按会话 ID（前 8 位即可）
```

## 加载出来的是什么

默认写到 `~/.workbuddy/context-resume/<会话ID>/`（**与当前工作目录无关**，所以任何新窗口都读得到）：

| 文件 | 内容 | 大小 |
|---|---|---|
| `resume.md` | 主摘要：任务目标、最近 6 轮进展、改过的文件、未完成待办、git 状态 | 2~5 KB |
| `resume.brief.md` | 压缩对话：user 全文 + assistant 截断 + 工具调用 | 几十 KB |
| `resume.full.md` | 完整原文，用 grep 定位细节 | 可能数 MB，勿整篇读 |

`resume.md` 长这样：

```markdown
## 1. 这个任务在做什么
你来测试一下我的 Clash 里面每个节点的实际 IP

## 2. 最近进展（最后 6 轮）
- 🤖 根因确认了：当前运行模式是 rule，不是 global …

## 3. 涉及的文件（被写入/编辑过的）
- `…\clash_ip_test\test_nodes_v2.py`

## 4. 未完成的待办
- …

## 5. Git 状态（工作目录）
```

## 原理

WorkBuddy 把每个任务的完整对话存在本机：

```
~/.workbuddy/projects/<工作空间>/<会话ID>.jsonl
```

每行一个 JSON。其中有用的几类：

- `ai-title` → `aiTitle` + `cwd`（AI 生成的任务标题、工作目录，最权威）
- `message` → `role: user/assistant`，`content[].type = input_text / output_text`
- `function_call` / `function_call_result` → 每一次工具调用（从里面能挖出改过哪些文件、留下的待办）

工具只读这些文件，**不联网、不写回、不改动原会话**。

## 安装

```bash
git clone https://github.com/SeekAfterSeek/context-resume.git
mkdir -p ~/.workbuddy/skills
cp -r context-resume/skills/context-resume ~/.workbuddy/skills/
```

重启 WorkBuddy 后，技能列表里会出现「上下文恢复（选任务接着做）」。

> `bin/` 必须和 `SKILL.md` 放在同一层（脚本按相对路径调用）。
> 需要 **Node.js 18+**，零第三方依赖。

## 边界（重要，别期待错）

- **选择框不是"秒弹"，但已经压到最短。** 原因：斜杠/触发词只是把技能内容送进模型，选择框必须由模型这一侧发起，所以至少要走**一轮模型响应**。这一点无法绕过（桌面版没有能直接开面板的钩子）。本项目的做法是把这一轮里的所有准备工作去掉——选项直接来自 SKILL.md 内置的「最近任务快照」，**不跑任何脚本、不输出任何解释文字**，一进来就调用选择控件。
- **空间名用的是本地目录名**，不是侧边栏里那些云端空间名（那些只存在服务端，磁盘上没有），所以可能对不上。判断时以**任务标题 + 相对时间**为准，二者与侧边栏一致。
- **会过滤两类噪声**：定时任务（`automation-*`）产生的会话默认不列出（`--all` 可开）；同一空间下标题相同的会话只保留最新一条。
- **不能改别人的工作目录。** 历史任务原目录与当前窗口不同时会提醒你，并给出原目录绝对路径；切换工作空间要你自己新建任务。
- **只能读本机会话记录。** 换电脑、换账号就读不到。
- **「全部上下文」其实是按需检索**：摘要必读，细节 grep 全文。等价于记得，但不会一次占满窗口。
- 没有落盘的东西（当时口头说、没写进文件的），工具也不知道。

## 目录结构

```
context-resume/
├─ bin/
│  ├─ cr.js             # CLI：list / load
│  ├─ lib.js            # jsonl 解析、摘要渲染
│  └─ session-start.js  # SessionStart 钩子脚本（CLI 用）
├─ skills/context-resume/SKILL.md   # 技能定义（含「弹选择框」的完整流程）
├─ commands/resume.md              # /resume 斜杠命令
├─ hooks/hooks.json                # CLI 钩子声明
└─ .codebuddy-plugin/plugin.json    # 插件清单
```

## License

MIT
