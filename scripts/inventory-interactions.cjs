// Source checklist, not proof of runtime behavior. Regenerate after changing UI.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const relative = file => path.relative(root, file).replaceAll('\\', '/');
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
const compact = text => text.replace(/\s+/g, ' ').trim();
const controls = [];
const routes = [];
const endpoints = [];
for (const file of walk(path.join(root, 'frontend/src')).filter(f => f.endsWith('.tsx'))) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const attributes = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map(a => [a.name.getText(source), a.initializer?.getText(source) || 'true']));
      const at = { file: relative(file), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 };
      if (tag === 'Route') routes.push({ ...at, path: attributes.path || '(index/layout)', element: attributes.element || null });
      if (attributes.onClick || attributes.onSubmit || ['button', 'Button', 'Link', 'NavLink'].includes(tag)) {
        const children = ts.isJsxElement(node.parent) ? node.parent.children.map(c => c.getText(source)).join(' ') : '';
        controls.push({ ...at, element: tag, label: attributes['aria-label'] || attributes.title || compact(children.replace(/<[^>]*>/g, ' ')).slice(0, 180) || '(dynamic/icon)',
          handler: compact(attributes.onClick || attributes.onSubmit || attributes.to || attributes.href || '(inherited/form submit)').slice(0, 400),
          disabledWhen: attributes.disabled || null,
          reviewStatus: 'Requires workflow evidence; see workflow-verification.md' });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
for (const file of walk(path.join(root, 'backend/src/routes')).filter(f => f.endsWith('.ts'))) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['get', 'post', 'put', 'patch', 'delete'].includes(node.expression.name.text) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      endpoints.push({ file: relative(file), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, method: node.expression.name.text.toUpperCase(), routeWithinRouter: node.arguments[0].text,
        middlewareAndHandler: node.arguments.slice(1).map(arg => compact(arg.getText(source))) });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const output = { notice: 'Static definitions only. Router mount paths, conditional rendering, effective roles, API effects, error handling and test evidence require review. Repeated table actions appear once per definition.', counts: { pageRoutes: routes.length, actionDefinitions: controls.length, endpointDeclarations: endpoints.length }, pageRoutes: routes, actions: controls, endpoints };
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/interaction-inventory.json'), JSON.stringify(output, null, 2) + '\n');
console.log(output.counts);
