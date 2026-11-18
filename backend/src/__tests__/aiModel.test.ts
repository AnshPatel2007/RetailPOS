/** Every AI feature reads one model setting; a deployment can override it without a code change. */
describe('AI model setting', () => {
  const original = process.env.AI_MODEL;
  afterEach(() => { if (original === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = original; });
  const load = () => { let model = ''; jest.isolateModules(() => { model = require('../config/ai').AI_MODEL; }); return model; };

  it('has a default and honours AI_MODEL, ignoring blank values', () => {
    delete process.env.AI_MODEL;
    const fallback = load();
    expect(fallback).toMatch(/^claude-/);
    process.env.AI_MODEL = '  claude-test-model  ';
    expect(load()).toBe('claude-test-model');
    process.env.AI_MODEL = '   ';
    expect(load()).toBe(fallback);
  });

  it('is the only place a model id is written', () => {
    const fs = require('fs'), path = require('path');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(file); continue; }
        if (!file.endsWith('.ts') || file.endsWith(path.join('config', 'ai.ts'))) continue;
        if (/model:\s*['"]claude-/.test(fs.readFileSync(file, 'utf8'))) offenders.push(path.relative(process.cwd(), file));
      }
    };
    walk(path.join(__dirname, '..'));
    expect(offenders).toEqual([]);
  });
});
