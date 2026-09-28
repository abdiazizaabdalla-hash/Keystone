export default function PayCancelledPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-display font-semibold text-slate-100 mb-2">Payment not completed</h1>
        <p className="text-slate-400">
          No charge was made. If this was a mistake, ask for a new payment link from your transaction coordinator.
        </p>
      </div>
    </div>
  );
}
