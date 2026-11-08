'use client';

// The small "write a message" box shown inside the Messages card on the Overview, so a conversation can start without
// opening the Messages tab. Enter sends; Shift+Enter is a new line.
export default function QuickMessageComposer({
  value,
  onChange,
  onSend,
  sending,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  placeholder: string;
}) {
  return (
    <div className="mt-4 flex gap-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (value.trim() && !sending) onSend();
          }
        }}
        rows={2}
        placeholder={placeholder}
        aria-label={placeholder}
        className="flex-1 resize-none bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={onSend}
        disabled={sending || !value.trim()}
        className="self-end px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
      >
        {sending ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}
