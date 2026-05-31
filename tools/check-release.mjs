import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_RE = /v\d+\.\d+\.\d+/;
const DATE_RE = /\d{4}-\d{2}-\d{2}/;

function findMatch(text, regex) {
  return (text || '').match(regex) || [];
}

export function validateReleaseMetadata(files) {
  const index = files['index.html'] || '';
  const readme = files['README.md'] || '';
  const summary = files['project_summary.md'] || '';
  const errors = [];

  const aboutVersion = findMatch(index, /版本：\s*<strong>(v\d+\.\d+\.\d+)<\/strong>\s*·\s*(\d{4}-\d{2}-\d{2})/);
  const latestSummary = findMatch(index, /<summary[^>]*>\s*(v\d+\.\d+\.\d+)\s*\((\d{4}-\d{2}-\d{2})\)/);
  const latestLog = findMatch(index, /<p><strong>(v\d+\.\d+\.\d+)<\/strong>\s*—/);

  if (!aboutVersion[1]) errors.push('index.html 缺少关于页版本号（版本：<strong>vX.Y.Z</strong> · YYYY-MM-DD）');
  if (!latestSummary[1]) errors.push('index.html 更新日志第一项缺少 summary 版本号');
  if (!latestLog[1]) errors.push('index.html 更新日志第一条缺少 <strong>vX.Y.Z</strong>');

  const version = aboutVersion[1];
  const date = aboutVersion[2];

  if (version && latestSummary[1] && latestSummary[1] !== version) {
    errors.push(`index.html 更新日志第一项版本 ${latestSummary[1]} 与关于页版本 ${version} 不一致`);
  }
  if (date && latestSummary[2] && latestSummary[2] !== date) {
    errors.push(`index.html 更新日志第一项日期 ${latestSummary[2]} 与关于页日期 ${date} 不一致`);
  }
  if (version && latestLog[1] && latestLog[1] !== version) {
    errors.push(`index.html 更新日志第一条版本 ${latestLog[1]} 与关于页版本 ${version} 不一致`);
  }

  if (version && !readme.includes(`**${version}**`)) {
    errors.push(`README.md 缺少 ${version} 版本历史`);
  }
  if (date && !readme.includes(date) && !readme.includes(date.replace(/-/g, '.'))) {
    errors.push(`README.md 缺少 ${date} 发布日期`);
  }

  const summaryVersion = findMatch(summary, new RegExp(`当前版本\\*\\*：(${VERSION_RE.source})（(${DATE_RE.source})）`));
  if (!summaryVersion[1]) {
    errors.push('project_summary.md 缺少当前版本字段');
  } else {
    if (version && summaryVersion[1] !== version) {
      errors.push(`project_summary.md 当前版本 ${summaryVersion[1]} 与关于页版本 ${version} 不一致`);
    }
    if (date && summaryVersion[2] !== date) {
      errors.push(`project_summary.md 当前日期 ${summaryVersion[2]} 与关于页日期 ${date} 不一致`);
    }
  }

  if (!/script\.js\?v=[0-9.]+/.test(index)) {
    errors.push('index.html 缺少 script.js?v= 缓存版本号');
  }
  if (!/style\.css\?v=[0-9.]+/.test(index)) {
    errors.push('index.html 缺少 style.css?v= 缓存版本号');
  }

  return { ok: errors.length === 0, version, date, errors };
}

export function readReleaseFiles(rootDir) {
  return Object.fromEntries(
    ['index.html', 'README.md', 'project_summary.md'].map(file => [
      file,
      fs.readFileSync(path.join(rootDir, file), 'utf8')
    ])
  );
}

function main() {
  const root = process.argv.includes('--root')
    ? process.argv[process.argv.indexOf('--root') + 1]
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = validateReleaseMetadata(readReleaseFiles(root));
  if (!result.ok) {
    console.error('Release metadata check failed:');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`Release metadata check passed: ${result.version} (${result.date})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
