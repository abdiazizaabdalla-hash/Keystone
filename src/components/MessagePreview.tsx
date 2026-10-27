'use client';

import type { DragEvent } from 'react';

export interface PreviewMessage {
  id: string;
  sender_role: 'tc' | 'agent';
  body: string;
  created_at: string;
  attachment_document_id?: string | null;
  attachment?: { fileName: string; url: string | null } | null;
}

// The deal's message thread in small: the same look as the full Messages page (agent on the left in grey, you on the right in blue, a
// round initial beside each bubble, who and when above the first bubble of each run), just tighter, and without a way to reply.
// Used on the Overview tab and next to the Documents.
function parseMessageDate(value: string) {
  const hasOffset = /Z$|[+-]\d{2}:?\d{2}$/.test(value);
  return new Date(hasOffset ? value : `${value}Z`);
}

// Same clock the full Messages page uses, so a time reads the same in both places.
function formatTime(value: string) {
  return parseMessageDate(value).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}

export default function MessagePreview({
  messages,
  agentName,
  limit = 4,
  onAttachmentDragStart,
}: {
  messages: PreviewMessage[];
  agentName: string;
  limit?: number;
  onAttachmentDragStart?: (e: DragEvent, documentId: string) => void;
}) {
  const shown = messages.slice(-limit);
  const agentLabel = agentName || 'Agent';
  const earlier = messages.length - shown.length;

  return (
    <div className="space-y-0.5" aria-label="Latest messages">
      {earlier > 0 && <p className="text-[11px] text-slate-500 text-center pb-2">{earlier} earlier {earlier === 1 ? 'message' : 'messages'}</p>}
      {shown.map((m, i) => {
        const isSelf = m.sender_role === 'tc';
        const label = isSelf ? 'You' : agentLabel;
        const initial = (isSelf ? 'Y' : agentLabel[0] || 'A').toUpperCase();
        const prev = i > 0 ? shown[i - 1] : null;
        const newRun = !prev || prev.sender_role !== m.sender_role;
        return (
          <div key={m.id} className={newRun && i > 0 ? 'pt-2.5' : ''}>
            {newRun && (
              <div className={`flex items-center gap-1.5 mb-1 px-8 ${isSelf ? 'justify-end' : 'justify-start'}`}>
                <span className="text-[11px] font-semibold text-slate-400">{label}</span>
                <span className="text-[10px] text-slate-600">{formatTime(m.created_at)}</span>
              </div>
            )}
            <div className={`flex items-end gap-2 ${isSelf ? 'justify-end' : 'justify-start'}`}>
              {!isSelf && (
                <span className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0" aria-hidden>
                  {initial}
                </span>
              )}
              <div
                className={`max-w-[82%] rounded-2xl px-3 py-1.5 text-[13px] leading-snug ${
                  isSelf ? 'bg-blue-600 text-white rounded-br-md' : 'bg-slate-700/80 text-slate-100 rounded-bl-md'
                }`}
              >
                {m.body && <p className="line-clamp-3 whitespace-pre-wrap break-words">{m.body}</p>}
                {m.attachment && (
                  <span
                    draggable={Boolean(m.attachment_document_id && onAttachmentDragStart)}
                    onDragStart={(e) => {
                      if (m.attachment_document_id && onAttachmentDragStart) onAttachmentDragStart(e, m.attachment_document_id);
                    }}
                    title={m.attachment_document_id && onAttachmentDragStart ? 'Drag onto a Documents category to file it there' : undefined}
                    className={`${m.body ? 'mt-1' : ''} flex items-center gap-1 text-[11px] rounded-lg px-2 py-1 truncate ${
                      isSelf ? 'bg-blue-700/70 text-blue-100' : 'bg-slate-800/80 text-blue-300'
                    } ${m.attachment_document_id && onAttachmentDragStart ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  >
                    <span aria-hidden>📎</span>
                    {m.attachment.url ? (
                      // draggable={false}: a link is draggable on its own, which would drag the web address instead of the document.
                      <a
                        href={m.attachment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        draggable={false}
                        title={`Open ${m.attachment.fileName}`}
                        className="truncate underline underline-offset-2 hover:opacity-80"
                      >
                        {m.attachment.fileName}
                      </a>
                    ) : (
                      <span className="truncate">{m.attachment.fileName}</span>
                    )}
                  </span>
                )}
                {!m.body && !m.attachment && <p className="italic opacity-70">Attachment</p>}
              </div>
              {isSelf && (
                <span className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0" aria-hidden>
                  {initial}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
