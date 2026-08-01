import { Panel, type SettingsPanelProps } from './Panel';

const MODE_CARDS = [
  {
    value: 'HIDDEN' as const,
    title: 'סמוי',
    tag: 'מומלץ',
    body: 'כולם רואים מסך זהה. המתחזה מקבל מילה אחרת — ולא יודע שהוא המתחזה.',
  },
  {
    value: 'KNOWN' as const,
    title: 'גלוי',
    tag: null,
    body: 'המתחזה יודע שהוא המתחזה, ומקבל מילה קרובה כדי להשתלב.',
  },
];

export function ModePanel({ settings, onChange }: SettingsPanelProps) {
  return (
    <Panel
      title="מצב משחק"
      summary={MODE_CARDS.find((c) => c.value === settings.mode)?.title}
    >
      <p className="pb-3 text-sm text-slate-400">
        מה המתחזה יודע על עצמו בתחילת המשחק
      </p>
      <div className="grid gap-2">
        {MODE_CARDS.map((card) => {
          const active = settings.mode === card.value;
          return (
            <button
              key={card.value}
              type="button"
              onClick={() => onChange({ mode: card.value })}
              aria-pressed={active}
              className={`rounded-2xl border p-4 text-start transition active:scale-[0.99] ${
                active
                  ? 'border-glow bg-glow/10'
                  : 'border-ink-600 bg-ink-850/50 hover:border-glow/40'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                    active ? 'border-glow bg-glow' : 'border-ink-600'
                  }`}
                >
                  {active && <span className="h-2 w-2 rounded-full bg-ink-950" />}
                </span>
                <span className="text-lg font-bold text-slate-100">{card.title}</span>
                {card.tag && (
                  <span className="rounded-full bg-glow/20 px-2 py-0.5 text-xs font-semibold text-glow-soft">
                    {card.tag}
                  </span>
                )}
              </div>
              <p className="pt-2 text-sm leading-relaxed text-slate-400">{card.body}</p>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
