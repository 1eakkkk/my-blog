import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReleaseMetadata } from './check-release.mjs';

const validFiles = {
  'index.html': `
    <p>版本：<strong>v2.5.3</strong> · 2026-05-31</p>
    <summary>v2.5.3 (2026-05-31)</summary>
    <p><strong>v2.5.3</strong> — 发布检查</p>
    <link rel="stylesheet" href="style.css?v=8.18">
    <script src="script.js?v=8.19"></script>
  `,
  'README.md': '- **v2.5.3**（2026-05-31）发布检查',
  'project_summary.md': '**当前版本**：v2.5.3（2026-05-31）'
};

test('accepts matching release metadata across public docs', () => {
  const result = validateReleaseMetadata(validFiles);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('reports stale changelog and docs metadata', () => {
  const result = validateReleaseMetadata({
    ...validFiles,
    'index.html': validFiles['index.html'].replace('v2.5.3 (2026-05-31)', 'v2.5.2 (2026-05-31)'),
    'README.md': '- **v2.5.2**（2026-05-31）旧日志',
    'project_summary.md': '**当前版本**：v2.5.2（2026-05-31）'
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /index\.html 更新日志第一项/);
  assert.match(result.errors.join('\n'), /README\.md/);
  assert.match(result.errors.join('\n'), /project_summary\.md/);
});

test('requires cache-busted script and stylesheet references', () => {
  const result = validateReleaseMetadata({
    ...validFiles,
    'index.html': validFiles['index.html']
      .replace('script.js?v=8.19', 'script.js')
      .replace('style.css?v=8.18', 'style.css')
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /script\.js\?v=/);
  assert.match(result.errors.join('\n'), /style\.css\?v=/);
});
