import type { ReactNode } from 'react';

type ScreenProps = {
  children: ReactNode;
  /** Only the setup screen may scroll; game screens never do. */
  scrollable?: boolean;
  className?: string;
};

export function Screen({ children, scrollable = false, className = '' }: ScreenProps) {
  return (
    <div
      className={`screen aura ${
        scrollable ? 'overflow-y-auto' : 'overflow-hidden'
      } ${className}`}
    >
      {children}
    </div>
  );
}

type HeaderProps = {
  /** Small line above the title, e.g. "סבב 2". */
  eyebrow?: ReactNode;
  title?: ReactNode;
  /** Rendered at the start edge (right, in RTL). */
  action?: ReactNode;
};

export function ScreenHeader({ eyebrow, title, action }: HeaderProps) {
  return (
    <header className="flex shrink-0 items-start justify-between gap-3 pb-2">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-semibold tracking-[0.04em] text-glow/70">
            {eyebrow}
          </p>
        )}
        {title && (
          <h1 className="niqqud truncate text-xl font-bold text-slate-100">{title}</h1>
        )}
      </div>
      {action}
    </header>
  );
}

/** The middle of a screen: centred, and free to grow without clipping. */
export function ScreenBody({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main
      className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-5 py-2 ${className}`}
    >
      {children}
    </main>
  );
}

export function ScreenFooter({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <footer className={`flex shrink-0 flex-col gap-3 pt-2 ${className}`}>
      {children}
    </footer>
  );
}
