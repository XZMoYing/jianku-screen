import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const summaryPath = '/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next/jianku-screen-ui-redesign/runtime-orchestration-summary.json';
const cssPath = '/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next/jianku-screen-ui-redesign/.tmp/google-colors-and-type-patched.css';
const scriptPath = '/Users/moyingxz/.trae-cn/builtin/design/default/skills/solo-design/shared-runtime/deterministic-tooling/apply-html-head-contract.mjs';

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const manifest = summary.project.dispatchPreflightManifest;

for (const node of manifest) {
  const outPath = '/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next/jianku-screen-ui-redesign/pages/' + node.nodeId + '.html';
  const args = [cssPath, outPath, '--replace-head', '--prefix=google'];
  console.log('Replace head:', node.nodeId);
  execFileSync('node', [scriptPath, ...args], { stdio: 'inherit' });
}
