import fs from 'node:fs';

const src = '/Users/moyingxz/.trae-cn/design_libraries/Google/colors_and_type.css';
const out = '/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next/jianku-screen-ui-redesign/.tmp/google-colors-and-type-patched.css';

let css = fs.readFileSync(src, 'utf8');

const lightAdditions = `
  /* Patched radius aliases for head-contract compatibility */
  --google-radius-sm: calc(var(--radius) - 4px);
  --google-radius-md: calc(var(--radius) - 2px);
  --google-radius-lg: var(--radius);
`;

const darkAdditions = `
  /* Patched radius aliases for head-contract compatibility */
  --google-radius-sm: calc(var(--radius) - 4px);
  --google-radius-md: calc(var(--radius) - 2px);
  --google-radius-lg: var(--radius);
`;

// Patch light :root
css = css.replace(/(--spacing:\s*[^;]+;)(\s*\}\s*\/\* Dark mode)/s, (m, p1, p2) => p1 + lightAdditions + p2);

// Patch dark .dark
css = css.replace(/(--spacing:\s*[^;]+;)(\s*\}\s*$)/s, (m, p1, p2) => p1 + darkAdditions + p2);

fs.mkdirSync('/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next/jianku-screen-ui-redesign/.tmp', { recursive: true });
fs.writeFileSync(out, css);
console.log('Patched CSS written to', out);
