'use client';

import { colourIndex, continuesGroup, dayLabel, initials } from '@/lib/chatFormat';

// Shared look for the team board and private messages: a day label between days, an avatar and coloured name for each
// person (so you can tell who wrote what at a glance), bubbles grouped by sender, and your own messages on the right.

export interface ChatLine {
  id: string;
  /** Stable id of the sender; decides the colour. */
  senderKey: string;
  senderName: string;
  mine: boolean;
  body: string;
  createdAt: string;
  /** A small label such as Broker, Agent or TC. */
  tag?: string;
  canDelete?: boolean;
  /** A file sent with the message. */
  attachment?: { fileName: string; url: string | null } | null;
  /** An announcement from the app (such as a deal closing): shown across the chat, not as a bubble. */
  system?: { tone: 'success'; title: string; detail?: string } | null;
}

const PALETTE = [
  { dot: 'bg-sky-500', name: 'text-sky-300', bubble: 'bg-sky-500/15 border-sky-400/20' },
  { dot: 'bg-emerald-500', name: 'text-emerald-300', bubble: 'bg-emerald-500/15 border-emerald-400/20' },
  { dot: 'bg-violet-500', name: 'text-violet-300', bubble: 'bg-violet-500/15 border-violet-400/20' },
  { dot: 'bg-amber-500', name: 'text-amber-300', bubble: 'bg-amber-500/15 border-amber-400/20' },
  { dot: 'bg-rose-500', name: 'text-rose-300', bubble: 'bg-rose-500/15 border-rose-400/20' },
  { dot: 'bg-teal-500', name: 'text-teal-300', bubble: 'bg-teal-500/15 border-teal-400/20' },
] as const;

export function colourFor(key: string) {
  return PALETTE[colourIndex(key, PALETTE.length)];
}

export function Avatar({ name, id, size = 'md' }: { name: string; id: string; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'h-10 w-10 text-sm' : size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs';
  return (
    <span aria-hidden className={`${dim} ${colourFor(id).dot} shrink-0 rounded-full flex items-center justify-center font-semibold text-white`}>
      {initials(name)}
    </span>
  );
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function ChatBubbles({ lines, compact = false, onDelete }: { lines: ChatLine[]; compact?: boolean; onDelete?: (id: string) => void }) {
  const out: React.ReactNode[] = [];
  lines.forEach((m, i) => {
    const prev = lines[i - 1];
    const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
    const grouped = !newDay && continuesGroup(prev, m);
    const c = colourFor(m.senderKey);
    if (newDay) {
      out.push(
        <li key={`day-${m.id}`} className="flex items-center gap-3 py-1" aria-hidden>
          <span className="h-px flex-1 bg-white/10" />
          <span className="text-[11px] font-medium text-slate-400">{dayLabel(m.createdAt)}</span>
          <span className="h-px flex-1 bg-white/10" />
        </li>
      );
    }
    if (m.system) {
      out.push(
        <li key={m.id} className="my-1 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-3 text-center">
          <p className="text-sm font-semibold text-emerald-200">{m.system.title}</p>
          {m.system.detail && <p className="text-xs text-emerald-300/80 mt-0.5">{m.system.detail}</p>}
        </li>
      );
      return;
    }
    out.push(
      <li key={m.id} className={`group flex gap-2 ${m.mine ? 'justify-end' : 'justify-start'} ${grouped ? '-mt-2' : ''}`}>
        {!m.mine && (grouped ? <span className={compact ? 'w-6 shrink-0' : 'w-8 shrink-0'} /> : <Avatar name={m.senderName} id={m.senderKey} size={compact ? 'sm' : 'md'} />)}
        <div className={`min-w-0 max-w-[85%] flex flex-col ${m.mine ? 'items-end' : 'items-start'}`}>
          {!grouped && (
            <div className={`mb-0.5 flex items-center gap-1.5 ${compact ? 'text-[11px]' : 'text-xs'}`}>
              {m.mine ? (
                <span className="font-semibold text-blue-300">You</span>
              ) : (
                <>
                  <span className={`font-semibold ${c.name}`}>{m.senderName}</span>
                  {m.tag && <span className="rounded px-1 py-px text-[9px] uppercase tracking-wide bg-white/10 text-slate-300">{m.tag}</span>}
                </>
              )}
              <span className="text-slate-500">{clock(m.createdAt)}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            {m.mine && m.canDelete && onDelete && (
              <button type="button" onClick={() => onDelete(m.id)} aria-label="Delete message" className="text-[11px] text-slate-500 hover:text-red-400 md:opacity-0 md:group-hover:opacity-100 transition">Delete</button>
            )}
            <div
              title={grouped ? clock(m.createdAt) : undefined}
              className={`px-3 py-2 rounded-2xl whitespace-pre-wrap break-words ${compact ? 'text-xs' : 'text-sm'} ${
                m.mine ? 'bg-blue-600 text-white rounded-br-md' : `border ${c.bubble} text-slate-100 rounded-bl-md`
              }`}
            >
              {m.body && <p>{m.body}</p>}
              {m.attachment && (
                <a href={m.attachment.url || '#'} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-1.5 text-xs underline underline-offset-2 ${m.body ? 'mt-1.5' : ''} ${m.mine ? 'text-blue-100' : 'text-blue-300'}`}>
                  📎 {m.attachment.fileName}
                </a>
              )}
            </div>
            {!m.mine && m.canDelete && onDelete && (
              <button type="button" onClick={() => onDelete(m.id)} aria-label="Delete message" className="text-[11px] text-slate-500 hover:text-red-400 md:opacity-0 md:group-hover:opacity-100 transition">Delete</button>
            )}
          </div>
        </div>
      </li>
    );
  });
  return <ul className={compact ? 'space-y-3' : 'space-y-4'}>{out}</ul>;
}
