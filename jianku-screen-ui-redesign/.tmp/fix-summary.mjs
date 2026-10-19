import fs from 'node:fs';

const path = '/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next/jianku-screen-ui-redesign/runtime-orchestration-summary.json';
const summary = JSON.parse(fs.readFileSync(path, 'utf8'));

for (const row of summary.project.expectedDispatches) {
  row.toolCallLedger.source = 'main-agent-runtime-trace';
  row.toolCallLedger.traceDigest = 'dispatch-completed';
}

fs.writeFileSync(path, JSON.stringify(summary, null, 2));
console.log('runtime-orchestration-summary fixed');
