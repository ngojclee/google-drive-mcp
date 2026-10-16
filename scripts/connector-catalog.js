import { writeFileSync, readFileSync } from 'node:fs';
import { policy, blocked } from '../.tmp-test/src/connector/policy.js';
import { TOOL_META } from '../.tmp-test/src/tools/toolMeta.js';
const definitions = (await Promise.all(['drive', 'docs', 'sheets', 'slides', 'calendar', 'gmail'].map(async domain => (await import(`../.tmp-test/src/tools/${domain}.js`)).toolDefinitions))).flat();
const actual = definitions.map(t => t.name).sort();
if (JSON.stringify(actual) !== JSON.stringify(Object.keys({ ...policy, ...blocked }).sort())) throw new Error('Unclassified or stale tool inventory');
const catalog = Object.fromEntries(Object.entries(policy).sort().map(([name, required_scopes]) => [name, { required_scopes }]));
const notes = {
  uploadFile: 'contentBase64 only; localPath denied',
  setElementZOrder: 'Only BRING_TO_FRONT, BRING_FORWARD, SEND_BACKWARD, SEND_TO_BACK',
  updateGoogleSheetIfUnchanged: 'dryRun and commit both require write',
  replyToComment: 'Reply and resolve both require write',
  updateGoogleDoc: 'Overwrites content; write permission is mutating authority',
  updateGoogleSlides: 'Replaces slides/content; write permission is mutating authority',
};
const matrix = '# Google Workspace Tool Matrix\n\nGenerated from explicit reviewed policy; unknown tools deny. Account pinned server-side for every allowed tool.\n\n' +
  '| Tool | Required Hub scope | Additional gate / denial | Google OAuth any-of ceiling |\n| --- | --- | --- | --- |\n' +
  actual.map(name => `| ${name} | ${policy[name]?.join(', ') || 'DENY'} | ${blocked[name] || notes[name] || 'Upstream schema validation'} | ${TOOL_META[name].acceptableScopes.map(s => s.replace('https://www.googleapis.com/auth/', '')).join(', ') || 'N/A'} |`).join('\n') + '\n';
for (const [file, content] of [['deploy/google-workspace-tool-catalog.json', JSON.stringify(catalog, null, 2) + '\n'], ['deploy/GOOGLE-WORKSPACE-TOOLS.md', matrix]]) {
  if (process.argv.includes('--check')) {
    if (readFileSync(file, 'utf8') !== content) throw new Error(`Stale ${file}`);
  } else writeFileSync(file, content);
}
console.log(`${actual.length} classified tools; ${Object.keys(policy).length} allowed; ${Object.keys(blocked).length} denied`);
