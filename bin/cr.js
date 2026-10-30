#!/usr/bin/env node
'use strict';
/**
 * context-resume · CLI
 *
 *   node cr.js list           最近任务清单（人读）
 *   node cr.js list --json    同上，机器读（供 AI 组装选择项）
 *   node cr.js load <会话ID>  把该任务的上下文加载成可读文件，并打印摘要
 *
 * 产出统一放在 ~/.workbuddy/context-resume/<会话ID>/，与当前工作目录无关，
 * 因此在任意新窗口/新工作空间里都能读到。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('./lib');

const CACHE_ROOT = path.join(os.homedir(), '.workbuddy', 'context-resume');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

/* ---------------- 快照（写回 SKILL.md，让第一个选择框无需跑脚本） ---------------- */

function resolveSkillMd() {
  const candidates = [
    path.join(__dirname, '..', 'SKILL.md'),
    path.join(__dirname, '..', 'skills', 'context-resume', 'SKILL.md')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

function updateSnapshot() {
  const md = resolveSkillMd();
  if (!md) return;
  let raw;
  try {
    raw = fs.readFileSync(md, 'utf8');
  } catch (_) {
    return;
  }
  const START = '<!-- SNAPSHOT:START -->';
  const END = '<!-- SNAPSHOT:END -->';
  const a = raw.indexOf(START);
  const b = raw.indexOf(END);
  if (a < 0 || b < 0 || b < a) return;

  const rows = lib.listSessions({ limit: 5 });
  const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
  const lines = rows.map((r, i) => {
    const n = String(i + 1).padStart(2, ' ');
    return `${n}. ${lib.truncate(r.title, 30)} ｜ ${r.space} · ${r.rel} · ${r.messageCount} 条对话 ｜ ${r.sessionId}`;
  });
  const body =
    `（快照时间：${stamp}，可用 \`node bin/cr.js list\` 刷新）\n` +
    (lines.length ? lines.join('\n') : '（暂无可恢复任务）');

  const next = raw.slice(0, a + START.length) + '\n' + body + '\n' + raw.slice(b);
  try {
    fs.writeFileSync(md, next, 'utf8');
  } catch (_) {}
}

/* ---------------- list ---------------- */

function cmdList(args) {
  const limit = parseInt(args.limit || '12', 10) || 12;
  const rows = lib.listSessions({
    limit,
    includeAutomation: Boolean(args.all),
    space: args.space || args.in
  });

  if (args.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    return;
  }

  if (!rows.length) {
    console.log('没有找到可恢复的任务。');
    return;
  }
  console.log('最近的 ' + rows.length + ' 个任务（新 → 旧）：\n');
  rows.forEach((r, i) => {
    const idx = String(i + 1).padStart(2, ' ');
    console.log(`[${idx}] ${lib.truncate(r.title, 40)}`);
    console.log(
      `     ${r.space} · ${r.rel} · ${r.messageCount} 条对话 · ${r.toolCount} 次工具`
    );
    console.log('');
  });
  console.log('加载：node cr.js load <编号或会话ID>');
  updateSnapshot();
}

/* ---------------- spaces ---------------- */

function cmdSpaces(args) {
  const rows = lib.listSpaces({ includeAutomation: Boolean(args.all) });
  if (args.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    return;
  }
  if (!rows.length) {
    console.log('没有找到任何空间。');
    return;
  }
  console.log('历史空间（按最近活动排序）：\n');
  rows.forEach((s, i) => {
    console.log(`[${String(i + 1).padStart(2, ' ')}] ${s.space}    ${s.count} 个任务 · ${s.rel}`);
  });
  console.log('\n看某个空间的任务：node cr.js list --space <空间名>');
  updateSnapshot();
}


/* ---------------- load ---------------- */

function resolveSession(arg) {
  const rows = lib.listSessions({ limit: 0 });
  if (!arg) return null;
  const a = String(arg).trim();
  // 纯数字视为清单里的编号（1 起）
  if (/^\d{1,3}$/.test(a)) {
    const i = parseInt(a, 10) - 1;
    return rows[i] || null;
  }
  return (
    rows.find((r) => r.sessionId === a) ||
    rows.find((r) => r.sessionId.startsWith(a)) ||
    rows.find((r) => r.file.includes(a)) ||
    null
  );
}

function cmdLoad(args) {
  const arg = args._[1] || args.session || args.id;
  const picked = resolveSession(arg);
  if (!picked) {
    console.error('未找到该会话：' + (arg || '(空)'));
    console.error('先运行：node cr.js list');
    process.exit(2);
  }

  const s = lib.scanSession(picked.file);
  const outDir = path.resolve(args.out || path.join(CACHE_ROOT, s.sessionId));
  fs.mkdirSync(outDir, { recursive: true });

  const mainPath = path.join(outDir, 'resume.md');
  const briefPath = path.join(outDir, 'resume.brief.md');
  const fullPath = path.join(outDir, 'resume.full.md');

  const briefLimit = parseInt(args['brief-limit'] || '900', 10) || 900;
  fs.writeFileSync(fullPath, lib.renderFull(s.turns), 'utf8');
  fs.writeFileSync(briefPath, lib.renderBrief(s.turns, briefLimit), 'utf8');

  const git = lib.gitInfo(s.cwd);
  const recent = s.turns
    .filter((t) => t.kind === 'user' || t.kind === 'assistant')
    .slice(-6)
    .map((t) => `- ${t.kind === 'user' ? '👤' : '🤖'} ${lib.truncate(t.text, 220)}`)
    .join('\n');

  const artifactLines =
    s.artifacts
      .slice(0, 25)
      .map((a) => `- \`${a.path}\`${a.count > 1 ? `（写入 ${a.count} 次）` : ''}`)
      .join('\n') || '- （本次任务没有记录到写文件操作）';

  const todoLines = s.todos.length ? s.todos.map((t) => `- ${t}`).join('\n') : '- （没有留下未完成待办）';

  const md = `# 恢复上下文：${s.title}

> 由 context-resume 自动生成于 ${new Date().toLocaleString()}
> 会话 ID：\`${s.sessionId}\`
> 工作目录：\`${s.cwd}\`
> 规模：${s.messageCount} 条对话 / ${s.toolCount} 次工具调用 · 时间 ${lib.fmtTime(s.firstTs)} ~ ${lib.fmtTime(s.lastTs)}

## 1. 这个任务在做什么

${s.firstUserText ? s.firstUserText.slice(0, 1200) : '（未记录到用户发言）'}

## 2. 最近进展（最后 6 轮）

${recent || '（无）'}

## 3. 涉及的文件（被写入/编辑过的）

${artifactLines}

## 4. 未完成的待办

${todoLines}

## 5. Git 状态（工作目录）

当前分支：\`${git.branch || '非 git 仓库'}\`

\`\`\`
${git.status || '（无未提交变更）'}
\`\`\`

最近提交：
\`\`\`
${git.log || '（无）'}
\`\`\`

## 6. 怎么继续读

- 细节对话（user 全文 + assistant 截断 + 工具调用）：\`${briefPath}\`
- 完整原文（可 grep 定位）：\`${fullPath}\`
`;

  fs.writeFileSync(mainPath, md, 'utf8');

  console.log('RESUME_TITLE=' + s.title);
  console.log('RESUME_CWD=' + s.cwd);
  console.log('RESUME_MAIN=' + mainPath);
  console.log('RESUME_BRIEF=' + briefPath);
  console.log('RESUME_FULL=' + fullPath);
  console.log('RESUME_MESSAGES=' + s.messageCount);
  console.log('RESUME_TOOLS=' + s.toolCount);
  console.log('');
  console.log(`已加载：${s.title}`);
  console.log(`   ${s.messageCount} 条对话 / ${s.toolCount} 次工具调用 · ${lib.fmtTime(s.firstTs)} ~ ${lib.fmtTime(s.lastTs)}`);
  console.log(`   工作目录 ${s.cwd}`);
  console.log('');
  console.log('下一步：读 RESUME_MAIN，向用户复述「这个任务在做什么 / 做到哪 / 下一步」，再继续干活。');
  updateSnapshot();
}

/* ---------------- 入口 ---------------- */

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'help';
  if (cmd === 'list' || cmd === 'ls') return cmdList(args);
  if (cmd === 'spaces') return cmdSpaces(args);
  if (cmd === 'load' || cmd === 'resume') return cmdLoad(args);
  console.log(`context-resume

  node cr.js list [--limit 12] [--json] [--space <空间名>] [--all]
      列出最近的历史任务（标题 / 空间 / 时间 / 规模）
      --all  连定时任务（automation-*）产生的会话一起列出

  node cr.js spaces [--json]
      列出历史空间，以及每个空间下有几个任务

  node cr.js load <编号|会话ID> [--out <目录>] [--brief-limit 900]
      加载该任务的上下文，生成 resume.md / resume.brief.md / resume.full.md
      默认输出目录：~/.workbuddy/context-resume/<会话ID>/
`);
}

main();
