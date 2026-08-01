/**
 * Bottom-of-screen status, styled like the existing "new build" banner so a
 * player only ever has one place to look for "something is up".
 */
export function ConnectionBanner({
  tone = 'warn',
  children,
  action,
}: {
  tone?: 'warn' | 'bad';
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  const ring =
    tone === 'bad'
      ? 'border-danger/50 bg-ink-900/95'
      : 'border-gold/50 bg-ink-900/95';

  return (
    <div
      role="status"
      className={`fixed inset-x-3 z-50 animate-rise-in rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur ${ring}`}
      style={{ bottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <p className="text-sm text-slate-200">{children}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="pt-1 text-xs text-glow-soft underline"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
