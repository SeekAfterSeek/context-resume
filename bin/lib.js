'use strict';
/**
 * context-resume · 核心解析库
 *
 * 数据源：WorkBuddy 本地会话记录
 *   ~/.workbuddy/projects/<workspace-slug>/<session-id>.jsonl
 *
 * 每行一个 JSON，常见的 type：
 *   message              role=user/assistant，content[].type = input_text / output_text / text
 *   function_call        name + arguments(JSON 字符串)，独立行
 *   function_call_result name + output.text，独立行
 *   ai-title             aiTitle + cwd  ← 任务标题与工作目录（最权威来源）
 *   session-meta / reasoning / todo / diff / file-history-snapshot  忽略
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const PROJECTS_ROOT = path.join(os.homedir(), '.workbuddy', 'projects');

/* ---------------- 通用小工具 ---------------- */

function truncate(s, n) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// 去掉注入的 system-reminder，优先取 <user_query> 里的真实发言
function cleanUserText(raw) {
  if (typeof raw !== 'string') return '';
  let t = raw.replace(/<system-reminder[\s\S]*?<\/system-reminder>/g, '');
  const m = t.match(/<user_query>([\s\S]*?)<\/user_query>/);
  if (m) return m[1].trim();
  return t.trim();
}

function isSystemNotice(text) {
  if (!text) return false;
  if (/^<task-notification>/.test(text)) return true;
  if (text.includes('[SYSTEM NOTIFICATION - NOT USER INPUT]')) return true;
  if (/^\[SYSTEM NOTIFICATION/.test(text)) return true;
  return false;
}

// slug 反推工作目录（仅当 jsonl 里没有 cwd 时兜底用）
function slugToPathHint(slug) {
  const m = /^([a-z])-(.*)$/.exec(slug);
  if (!m) return slug;
  return m[1].toUpperCase() + ':\\' + m[2].replace(/-/g, '\\');
}

function fmtTime(ms) {
  if (!ms) return '未知时间';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function relTime(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  if (d < 30) return d + ' 天前';
  return Math.floor(d / 30) + ' 个月前';
}

/* ---------------- 扫描单个会话 ---------------- */

/**
 * 全量解析一个会话文件。
 * @returns {object} 结构化会话信息
 */
function scanSession(file) {
  const stat = fs.statSync(file);
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/);

  let aiTitle = '';
  let cwd = '';
  let firstTs = 0;
  let lastTs = 0;
  const userTexts = [];
  const turns = []; // 完整时间线：user / assistant / tool
  const artifacts = new Map(); // 文件路径 -> 写入次数
  const todos = []; // TodoWrite 里未完成的条目
  const taskMap = new Map(); // 任务ID -> subject（TaskCreate 建立）
  const pendingTaskSubjects = []; // 等待从结果里取回 ID 的 subject
  const completedTaskIds = new Set(); // 已被 TaskUpdate 标为 completed 的任务ID

  for (const line of lines) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch (_) {
      continue; // 会话可能正在写入，跳过坏行
    }

    if (typeof o.timestamp === 'number') {
      if (!firstTs || o.timestamp < firstTs) firstTs = o.timestamp;
      if (o.timestamp > lastTs) lastTs = o.timestamp;
    }

    if (o.type === 'ai-title') {
      if (o.aiTitle) aiTitle = String(o.aiTitle).trim();
      if (o.cwd) cwd = String(o.cwd);
      continue;
    }

    if (!cwd && typeof o.cwd === 'string') cwd = o.cwd;

    if (o.type === 'message' && (o.role === 'user' || o.role === 'assistant')) {
      let text = '';
      const c = o.content;
      if (typeof c === 'string') {
        text = o.role === 'user' ? cleanUserText(c) : c;
      } else if (Array.isArray(c)) {
        for (const part of c) {
          if (!part || typeof part !== 'object') continue;
          if (part.type === 'input_text' || part.type === 'output_text' || part.type === 'text') {
            const t = part.text || '';
            if (!t) continue;
            if (o.role === 'user') {
              const cleaned = cleanUserText(t);
              if (cleaned) text += (text ? '\n' : '') + cleaned;
            } else {
              text += t;
            }
          }
        }
      }
      text = text.trim();
      if (!text) continue;
      if (o.role === 'user' && isSystemNotice(text)) continue;
      if (o.role === 'user') userTexts.push(text);
      turns.push({ kind: o.role, text, ts: o.timestamp });
      continue;
    }

    if (o.type === 'function_call') {
      let argv = null;
      if (typeof o.arguments === 'string') {
        try {
          argv = JSON.parse(o.arguments);
        } catch (_) {
          argv = null;
        }
      } else if (o.arguments && typeof o.arguments === 'object') {
        argv = o.arguments;
      }
      const name = o.name || 'tool';
      turns.push({ kind: 'tool', name, argv, ts: o.timestamp });

      // 产物文件：只统计真正写盘的工具
      if (argv && typeof argv === 'object') {
        if (/^(Write|Edit|MultiEdit|NotebookEdit|create_file|write_file)$/i.test(name)) {
          const p = argv.file_path || argv.path || argv.target_file;
          if (typeof p === 'string' && p.trim()) {
            artifacts.set(p.trim(), (artifacts.get(p.trim()) || 0) + 1);
          }
        }
        // 待办：TodoWrite 里还没完成的条目
        if (/^(TodoWrite|todo_write)$/i.test(name) && Array.isArray(argv.todos)) {
          for (const td of argv.todos) {
            if (!td || typeof td !== 'object') continue;
            const st = String(td.status || '');
            if (st === 'completed' || st === 'cancelled') continue;
            const content = td.content || td.subject || td.activeForm;
            if (content) todos.push(String(content).trim());
          }
        }
        // 待办：TaskCreate 建立的任务（是否完成要看后续 TaskUpdate）
        if (/^(TaskCreate|task_create)$/i.test(name)) {
          const sub = argv.subject || argv.description;
          if (sub) pendingTaskSubjects.push(String(sub).trim().split('\n')[0]);
        }
        // 任务被标记完成 → 从待办里剔除
        if (/^(TaskUpdate|task_update)$/i.test(name)) {
          if (String(argv.status) === 'completed' && argv.taskId != null) {
            completedTaskIds.add(String(argv.taskId));
          }
        }
      }
      continue;
    }

    if (o.type === 'function_call_result') {
      let out = '';
      if (o.output && typeof o.output === 'object') out = o.output.text || '';
      else if (typeof o.output === 'string') out = o.output;
      // TaskCreate 的结果里带回了任务 ID：`Task #1 created successfully: 创建插件`
      if (/^(TaskCreate|task_create)$/i.test(String(o.name || ''))) {
        const m = /Task #(\d+) created successfully:?\s*([\s\S]*)/.exec(out);
        const fallback = pendingTaskSubjects.length ? pendingTaskSubjects[0] : '';
        if (m) {
          taskMap.set(m[1], (m[2] || fallback).trim().split('\n')[0]);
        } else if (fallback) {
          taskMap.set('unknown-' + taskMap.size, fallback);
        }
        if (pendingTaskSubjects.length) pendingTaskSubjects.shift();
      }
      turns.push({ kind: 'result', name: o.name || 'tool', text: truncate(out, 120), ts: o.timestamp });
      continue;
    }
  }

  const sessionId = path.basename(file, '.jsonl');
  const slug = path.basename(path.dirname(file));
  const messages = turns.filter((t) => t.kind === 'user' || t.kind === 'assistant');
  const toolCalls = turns.filter((t) => t.kind === 'tool');

  // 未完成任务：TaskCreate 建立、但没被 TaskUpdate 标为 completed 的
  const openTasks = [];
  for (const [id, subject] of taskMap) {
    if (!completedTaskIds.has(id)) openTasks.push(subject);
  }

  // 标题优先级：ai-title > 首条用户发言 > 会话 ID
  const title = aiTitle || truncate(userTexts[0] || '', 40) || sessionId.slice(0, 8);

  return {
    sessionId,
    shortId: sessionId.slice(0, 8),
    slug,
    file,
    title,
    cwd: cwd || slugToPathHint(slug),
    cwdFromMeta: Boolean(cwd),
    firstTs,
    lastTs: lastTs || stat.mtimeMs,
    mtimeMs: stat.mtimeMs,
    sizeKB: Math.round(stat.size / 1024),
    messageCount: messages.length,
    toolCount: toolCalls.length,
    firstUserText: userTexts[0] || '',
    artifacts: [...artifacts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => ({ path: p, count: n })),
    todos: [...new Set([...todos, ...openTasks])].slice(-25),
    turns
  };
}

/* ---------------- 列出全部会话 ---------------- */

/**
 * 扫描所有工作空间下的会话，按最后活动时间倒序。
 * @param {object} opts { limit, cwd, includeEmpty }
 */
function listSessions(opts) {
  const o = opts || {};
  if (!fs.existsSync(PROJECTS_ROOT)) return [];
  const out = [];
  for (const slug of fs.readdirSync(PROJECTS_ROOT)) {
    const dir = path.join(PROJECTS_ROOT, slug);
    let st;
    try {
      st = fs.statSync(dir);
    } catch (_) {
      continue;
    }
    if (!st.isDirectory()) continue;
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch (_) {
      continue;
    }
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        const s = scanSession(full);
        if (!o.includeEmpty && s.messageCount === 0) continue;
        out.push({
          sessionId: s.sessionId,
          shortId: s.shortId,
          title: s.title,
          cwd: s.cwd,
          cwdFromMeta: s.cwdFromMeta,
          lastTs: s.lastTs,
          lastTime: fmtTime(s.lastTs),
          rel: relTime(s.lastTs),
          messageCount: s.messageCount,
          toolCount: s.toolCount,
          sizeKB: s.sizeKB,
          slug: s.slug,
          file: s.file
        });
      } catch (_) {
        // 单个文件解析失败不影响其他
      }
    }
  }
  out.sort((a, b) => b.lastTs - a.lastTs);
  const limit = o.limit && o.limit > 0 ? o.limit : out.length;
  return out.slice(0, limit);
}

/* ---------------- 渲染 ---------------- */

function renderFull(turns) {
  const blocks = [];
  let buf = [];
  const flush = () => {
    if (buf.length) {
      blocks.push(buf.join('\n'));
      buf = [];
    }
  };
  for (const e of turns) {
    if (e.kind === 'user') {
      flush();
      blocks.push(`## 👤 User\n\n${e.text}`);
    } else if (e.kind === 'assistant') {
      flush();
      blocks.push(`## 🤖 Assistant\n\n${e.text}`);
    } else if (e.kind === 'tool') {
      let argStr = '';
      try {
        argStr = JSON.stringify(e.argv || {});
      } catch (_) {
        argStr = '';
      }
      buf.push(`- 🔧 \`${e.name}\` ${truncate(argStr, 200)}`);
    } else if (e.kind === 'result') {
      buf.push(`  - ↳ ${e.text || '(无输出)'}`);
    }
  }
  flush();
  return blocks.join('\n\n');
}

function renderBrief(turns, limit) {
  const blocks = [];
  let buf = [];
  const flush = () => {
    if (buf.length) {
      blocks.push(buf.join('\n'));
      buf = [];
    }
  };
  for (const e of turns) {
    if (e.kind === 'user') {
      flush();
      blocks.push(`### 👤 User\n\n${e.text}`);
    } else if (e.kind === 'assistant') {
      flush();
      let body = e.text;
      if (body.length > limit) body = body.slice(0, limit) + '…（已截断）';
      blocks.push(`### 🤖 Assistant\n\n${body}`);
    } else if (e.kind === 'tool') {
      let argStr = '';
      try {
        argStr = JSON.stringify(e.argv || {});
      } catch (_) {}
      buf.push(`- 🔧 \`${e.name}\` ${truncate(argStr, 130)}`);
    } else if (e.kind === 'result') {
      buf.push(`  - ↳ ${truncate(e.text, 80) || '(无输出)'}`);
    }
  }
  flush();
  return blocks.join('\n\n');
}

function gitInfo(dir) {
  const run = (cmd) => {
    try {
      return execSync(cmd, {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 6000
      }).trim();
    } catch (_) {
      return '';
    }
  };
  return {
    branch: run('git rev-parse --abbrev-ref HEAD'),
    status: run('git status --short'),
    log: run('git log --oneline -5')
  };
}

module.exports = {
  PROJECTS_ROOT,
  scanSession,
  listSessions,
  renderFull,
  renderBrief,
  gitInfo,
  truncate,
  fmtTime,
  relTime
};
