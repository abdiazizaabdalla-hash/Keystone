export default function PaySuccessPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="w-14 h-14 mx-auto mb-6 rounded-full bg-green-500/10 border border-green-500/40 flex items-center justify-center">
          <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-display font-semibold text-slate-100 mb-2">Payment received</h1>
        <p className="text-slate-400">
          Thanks — your payment went through and the transaction coordinator has been notified. You can close this
          page.
        </p>
      </div>
    </div>
  );
}
