import fs from 'node:fs';

const designPath = '/Users/moyingxz/Documents/Zzx/05_项目开发/Jianku Screen Next/jianku-screen-ui-redesign/.design';
const design = JSON.parse(fs.readFileSync(designPath, 'utf8'));

const groupMap = { desktop: 0, web: 1, mobile: 2 };
const now = Date.now();

const newData = design.data.map((node, idx) => {
  const slug = node.devMetadata.htmlSrc.replace(/^pages\//, '').replace(/\.html$/, '');
  return {
    id: `page-${slug}`,
    title: node.title,
    type: 'page',
    version: 1,
    createdAt: now + idx,
    devMetadata: {
      htmlSrc: node.devMetadata.htmlSrc,
      interactions: []
    },
    canvasData: {
      x: node.canvasData.x,
      y: node.canvasData.y,
      group: groupMap[node.canvasData.group] ?? 0
    }
  };
});

const newConfig = {
  ...design.config,
  projectName: 'Jianku Screen Next UI Redesign',
  designLibrary: {
    name: 'Google',
    id: 'dl_builtin_google',
    version: 0,
    scope: 'builtin-global',
    path: '/Users/moyingxz/.trae-cn/design_libraries/Google',
    versionSource: 'metadata.json'
  }
};

fs.writeFileSync(designPath, JSON.stringify({ data: newData, config: newConfig }, null, 2));
console.log('.design file fixed');
