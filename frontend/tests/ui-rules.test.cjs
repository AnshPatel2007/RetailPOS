// The setup rules, checked in the source of every pop-up (CLAUDE.md > Frontend conventions).
// The browser guard (e2e/ui-rules.spec.ts) can only open pop-ups reachable from a page's
// main button; this reads all of them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const SRC = path.join(__dirname, '../src');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}
const opening = node => ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
const nameOf = node => opening(node)?.tagName.getText();
function attribute(node, name) {
  const found = opening(node)?.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText() === name);
  if (!found) return undefined;
  if (!found.initializer) return 'true';
  if (ts.isStringLiteral(found.initializer)) return found.initializer.text;
  // {expression}: the expression itself, without its braces.
  return ts.isJsxExpression(found.initializer) && found.initializer.expression ? found.initializer.expression.getText() : found.initializer.getText();
}
/** Every element inside `node`, not entering a nested pop-up. */
function elementsWithin(node, visit) {
  ts.forEachChild(node, child => {
    if (nameOf(child) === 'Modal') return;
    if (opening(child)) visit(child);
    elementsWithin(child, visit);
  });
}
/** Every element in a pop-up's body: its children, not its `footer` attribute. */
function bodyElements(modal, visit) {
  for (const child of modal.children) {
    if (nameOf(child) === 'Modal') continue;
    if (opening(child)) visit(child);
    elementsWithin(child, visit);
  }
}
/**
 * A filled button: the main action, which belongs in the footer. A submit button counts
 * too, unless it is marked as a supporting button (outline or ghost), like the button of
 * an inline "Add an owner" field in a pop-up that has no single main action.
 */
const filled = element => {
  const variant = attribute(element, 'variant') || '';
  return (nameOf(element) === 'Button' && /primary|destructive/.test(variant))
    || (attribute(element, 'type') === 'submit' && !/^(outline|ghost)$/.test(variant));
};

const modals = [];
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('<Modal')) continue;
  const rel = path.relative(SRC, file).split(path.sep).join('/');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const where = node => `${rel}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const visit = node => {
    if (nameOf(node) === 'Modal') modals.push({ node, where: where(node), rel, source });
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/** The text a footer stands for: written in place, or held in a variable declared in the same file. */
function footerText(footer, source) {
  if (!/^[A-Za-z_$][\w$]*$/.test(footer)) return footer;
  let found = footer;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === footer && node.initializer) found = node.initializer.getText();
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Pop-ups whose main button sits in the scrolling body. */
function bodyProblems({ node, where }) {
  if (!ts.isJsxElement(node)) return [];
  const inBody = [];
  bodyElements(node, element => { if (filled(element)) inBody.push(element.getText().replace(/\s+/g, ' ').slice(0, 80)); });
  return inBody.length ? [`${where}: ${inBody.join(' | ')}`] : [];
}
/** Pop-up footers not laid out by DialogActions (FilterDropdown passes its caller's footer through). */
function footerProblems({ node, where, rel, source }) {
  const footer = attribute(node, 'footer');
  return footer && !/DialogActions/.test(footerText(footer, source)) && !rel.endsWith('FilterDropdown.tsx') ? [where] : [];
}
test('the source has pop-ups to check', () => {
  assert.ok(modals.length > 50, `found only ${modals.length} pop-ups: the scan is broken`);
});

test("a pop-up's main button sits in its fixed footer, never in the scrolling body", () => {
  assert.deepEqual(modals.flatMap(bodyProblems), [], 'Move these buttons into the footer (DialogActions); supporting buttons in the body are outline or ghost.');
});

test('a pop-up footer is laid out by DialogActions', () => {
  assert.deepEqual(modals.flatMap(footerProblems), [], 'Build the footer with DialogActions: Cancel, then the one main button on the right.');
});
