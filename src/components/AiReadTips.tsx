'use client';

/**
 * Short note shown beside every AI document upload: what makes a read fail, and what to do instead.
 * Keep the wording in step with the failure reasons in src/lib/aiFailures.ts.
 */
export default function AiReadTips({ multi = false, className = '' }: { multi?: boolean; className?: string }) {
  return (
    <details className={`group text-xs text-slate-400 ${className}`}>
      <summary className="cursor-pointer select-none text-slate-400 hover:text-slate-200 list-none">
        <span className="underline decoration-dotted underline-offset-2">Won&apos;t read? What can go wrong</span>
      </summary>
      <ul className="mt-1.5 ml-4 list-disc space-y-0.5 text-slate-400">
        <li>Scans and photos of paper (no selectable text) often can&apos;t be read. Use the PDF from your e-sign or contract system instead.</li>
        <li>Password-protected, locked or damaged PDFs can&apos;t be opened.</li>
        <li>It has to be the contract itself: a cover email, invoice or blank form won&apos;t work.</li>
        <li>{multi ? 'Each file' : 'The file'} must be under 25&nbsp;MB{multi ? ', up to 8 files' : ''}. Very long packets are best split.</li>
        <li>Too many reads in an hour pauses reading for a while.</li>
      </ul>
      <p className="mt-1.5">If it still fails, you can always enter the details by hand. Relay logs failed reads so we can look into them. Only the file name and the reason are kept, never the contents.</p>
    </details>
  );
}
