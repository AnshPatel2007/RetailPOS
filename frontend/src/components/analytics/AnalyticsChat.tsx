import React, { useState, useRef, useEffect } from 'react';
import { analyticsService } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Sparkles, Send, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolTrace?: { tool: string; input: unknown }[];
}

const SUGGESTIONS = [
  'How did sales go yesterday?',
  'Compare this week to last week',
  'What were my top 5 sellers this month?',
  'What time of day was busiest yesterday?',
  'How much did customers pay by card vs cash this week?',
  'What should I reorder?',
];

/**
 * Ask-your-data chat: questions go to /analytics/chat where Claude answers
 * from read-only reporting tools. History rides along so follow-ups work.
 */
export const AnalyticsChat: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || isThinking) return;

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: q }];
    setMessages(nextMessages);
    setInput('');
    setIsThinking(true);

    try {
      const res = await analyticsService.chat({
        question: q,
        history: messages.map((m) => ({ role: m.role, content: m.content })),
      });
      setMessages([
        ...nextMessages,
        {
          role: 'assistant',
          content: res.data.data.answer,
          toolTrace: res.data.data.toolTrace,
        },
      ]);
    } catch (error: any) {
      const msg = error.response?.data?.error || 'The assistant is unavailable right now';
      toast.error(msg);
      setMessages(nextMessages.slice(0, -1)); // put the question back in the input
      setInput(q);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Ask your data</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Plain-English questions, answered from your live sales and inventory data.
        </p>

        {/* Thread */}
        <div className="border rounded-lg bg-muted/30 p-4 min-h-[280px] max-h-[420px] overflow-y-auto space-y-3">
          {messages.length === 0 && !isThinking && (
            <div className="text-center py-6">
              <p className="text-sm text-muted-foreground mb-3">Try one of these:</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="text-xs px-3 py-1.5 rounded-full border border-input bg-background hover:bg-accent transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card border'
                }`}
              >
                {m.content}
                {m.role === 'assistant' && (m.toolTrace?.length ?? 0) > 0 && (
                  <p className="mt-1.5 pt-1.5 border-t border-border/50 text-[10px] text-muted-foreground flex items-center gap-1">
                    <Wrench className="h-3 w-3" />
                    Checked: {[...new Set(m.toolTrace!.map((t) => t.tool.replace(/^get_/, '').replace(/_/g, ' ')))].join(', ')}
                  </p>
                )}
              </div>
            </div>
          ))}

          {isThinking && (
            <div className="flex justify-start">
              <div className="bg-card border rounded-xl px-3.5 py-2.5 text-sm text-muted-foreground flex items-center gap-2">
                <div className="animate-spin h-3.5 w-3.5 border-2 border-primary border-t-transparent rounded-full" />
                Checking the numbers...
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex gap-2 mt-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ask(input); }}
            placeholder='e.g. "How did last Tuesday compare to the one before?"'
            className="flex-1 px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={isThinking}
          />
          <Button variant="primary" onClick={() => ask(input)} disabled={isThinking || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Answers come only from your store's data — the assistant can read reports, never change anything.
        </p>
      </CardContent>
    </Card>
  );
};
