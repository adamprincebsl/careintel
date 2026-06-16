import { useState } from 'react';
import { Send } from 'lucide-react';
import { api } from '../lib/api';

export default function Assistant() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(e) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const res = await api.ask(q);
      setMessages((m) => [...m, { role: 'assistant', text: res.answer, mock: res.mock }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: `Error: ${err.message}`, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Care Intelligence Assistant</h1>
      <p className="text-sm text-ink-muted">
        Ask questions about CAPs, risks, audits, and program performance. (Skeleton:
        single-shot; the tool-calling agent over live data lands in a later phase — see PLAN.md.)
      </p>

      <div className="min-h-[300px] space-y-3 rounded border border-border bg-white p-4 shadow-sm">
        {messages.length === 0 && (
          <p className="text-sm text-ink-muted">
            Try: “Which programs have the most overdue CAPs?” or “Summarize our severe risks.”
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <span
              className={`inline-block max-w-[85%] whitespace-pre-wrap rounded px-3 py-2 text-sm ${
                m.role === 'user'
                  ? 'bg-beacon text-white'
                  : m.error
                    ? 'bg-danger/10 text-danger'
                    : 'bg-surface text-ink'
              }`}
            >
              {m.text}
              {m.mock && <span className="ml-2 rounded bg-gold-tint px-1 text-[10px] text-gold-dark">MOCK</span>}
            </span>
          </div>
        ))}
        {busy && <p className="text-sm text-ink-muted">Thinking…</p>}
      </div>

      <form onSubmit={send} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          className="flex-1 rounded border border-border px-3 py-2 text-sm outline-none focus:border-beacon"
        />
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-2 rounded bg-beacon px-4 py-2 text-sm font-medium text-white hover:bg-beacon-dark disabled:opacity-50"
        >
          <Send className="h-4 w-4" /> Send
        </button>
      </form>
    </div>
  );
}
