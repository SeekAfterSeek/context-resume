'use strict';
/**
 * SessionStart 钩子
 *
 * 每次新会话开始时输出一行极短提示，告诉模型「这里有历史任务可以恢复」。
 * 为避免打扰，满足任一条件时保持静默：
 *   - 存在开关文件 ~/.workbuddy/context-resume/hook.off
 *   - 本机没有任何历史会话
 *
 * 用法：
 *   node bin/session-start.js            # 正常输出（供 hooks 调用）
 *   node bin/session-start.js --off      # 写开关，关闭提示
 *   node bin/session-start.js --on       # 删开关，开启提示
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const FLAG = path.join(os.homedir(), '.workbuddy', 'context-resume', 'hook.off');
const PROJECTS = path.join(os.homedir(), '.workbuddy', 'projects');

const arg = process.argv[2];

if (arg === '--off') {
  fs.mkdirSync(path.dirname(FLAG), { recursive: true });
  fs.writeFileSync(FLAG, 'off\n', 'utf8');
  console.log('已关闭 SessionStart 提示。');
  process.exit(0);
}
if (arg === '--on') {
  try {
    fs.unlinkSync(FLAG);
  } catch (_) {}
  console.log('已开启 SessionStart 提示。');
  process.exit(0);
}

// 静默条件
if (fs.existsSync(FLAG)) process.exit(0);

let hasSessions = false;
try {
  for (const slug of fs.readdirSync(PROJECTS)) {
    const dir = path.join(PROJECTS, slug);
    try {
      if (fs.readdirSync(dir).some((f) => f.endsWith('.jsonl'))) {
        hasSessions = true;
        break;
      }
    } catch (_) {}
  }
} catch (_) {}
if (!hasSessions) process.exit(0);

process.stdout.write(
  '［context-resume 已装］本机有历史任务可恢复。若用户想把之前某个任务的上下文带进这个窗口，' +
    '说「恢复」或输入 /resume，会列出最近任务供选择。\n'
);
