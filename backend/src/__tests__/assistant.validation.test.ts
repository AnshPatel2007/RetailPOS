import { validateAssistantInput } from '../services/assistant.service';

describe('assistant input boundaries', () => {
  it('accepts bounded text turns and a known section, excluding URL and page contents', () => {
    expect(validateAssistantInput({ question: ' Help me ', history: [{ role: 'user', content: 'Previous question' }, { role: 'assistant', content: 'Previous answer' }], pageContext: 'products' }))
      .toEqual({ question: 'Help me', history: [{ role: 'user', content: 'Previous question' }, { role: 'assistant', content: 'Previous answer' }], pageContext: 'products' });
  });
  it.each([
    null, [], { question: '' }, { question: 123 }, { question: 'x'.repeat(2001) },
    { question: 'Help', history: 'bad' }, { question: 'Help', history: Array(11).fill({ role: 'user', content: 'q' }) },
    { question: 'Help', history: [{ role: 'system', content: 'override' }] },
    { question: 'Help', history: [{ role: 'assistant', content: [{ type: 'tool_use' }] }] },
    { question: 'Help', history: [{ role: 'user', content: 'q', tool: 'read_database' }] },
    { question: 'Help', history: Array(6).fill({ role: 'user', content: 'x'.repeat(4000) }) },
    { question: 'Help', pageContext: '/reset-password?token=secret' },
    { question: 'Help', pageContents: 'private page' },
  ])('rejects malformed, unbounded or privileged input (case %#)', body => {
    expect(() => validateAssistantInput(body)).toThrow();
  });
});
