/**
 * Floating status, styled like the existing "new build" banner so a player only
 * ever has one place to look for "something is up".
 *
 * Sits at the bottom by default and at the top when it has to stay up while the
 * player is still playing — see `place`.
 */
export function ConnectionBanner({
  tone = 'warn',
  place = 'bottom',
  children,
  action,
}: {
  tone?: 'warn' | 'bad';
  /**
   * Which end of the screen to sit at.
   *
   * `bottom` is the default and the right choice for a banner that appears
   * briefly, or on a screen whose buttons are unusable anyway. `top` is for one
   * that stays up while the player still has to act: every game screen keeps
   * its primary button in `ScreenFooter`, whose last row ends at the same
   * `0.75rem` inset this banner starts at — so a long-lived bottom banner
   * covers almost all of a 52px button. That is exactly what a "carry on
   * playing" message must not do.
   */
  place?: 'top' | 'bottom';
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  const ring =
    tone === 'bad'
      ? 'border-danger/50 bg-ink-900/95'
      : 'border-gold/50 bg-ink-900/95';

  const edge = 'max(0.75rem, env(safe-area-inset-bottom))';
  const anchored =
    place === 'top'
      ? {
          top: 'max(0.75rem, env(safe-area-inset-top))',
          // Nothing to tap on this variant, and it hangs over the top row of
          // the vote grid and the clue strip if the message wraps to three
          // lines. Better to let those taps through than to eat them.
          pointerEvents: 'none' as const,
          // Clear of the host's gear button, which is fixed in this corner.
          insetInlineEnd: 'calc(max(0.75rem, env(safe-area-inset-right)) + 3.25rem)',
          insetInlineStart: '0.75rem',
        }
      : { bottom: edge };

  return (
    <div
      role="status"
      className={`fixed z-50 animate-rise-in rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur ${
        place === 'top' ? '' : 'inset-x-3'
      } ${ring}`}
      style={anchored}
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
