import { selectedCategories } from '../../../game/rules';
import { CATEGORIES } from '../../../game/words';
import { Panel, type SettingsPanelProps } from './Panel';

export function CategoriesPanel({ settings, onChange }: SettingsPanelProps) {
  // What the draw will actually use, so the chips can't disagree with the game.
  const active = selectedCategories(settings);

  const toggleCategory = (category: string) => {
    const next = active.includes(category)
      ? active.filter((c) => c !== category)
      : [...active, category];
    if (next.length === 0) return;
    // All of them is stored as "none chosen", so a category added in a later
    // build is included rather than silently left out.
    onChange({ categories: next.length === CATEGORIES.length ? [] : next });
  };

  return (
    <Panel title="קטגוריות" summary={`${active.length} / ${CATEGORIES.length}`}>
      <p className="pb-3 text-sm text-slate-400">
        מאיפה תבוא המילה הסודית. אפשר לבחור כמה שרוצים
      </p>

      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((category) => {
          const on = active.includes(category);
          // The last one standing can't be switched off — a game with no
          // categories has no word to draw.
          const locked = on && active.length === 1;
          return (
            <button
              key={category}
              type="button"
              aria-pressed={on}
              disabled={locked}
              onClick={() => toggleCategory(category)}
              className={`min-h-[44px] rounded-xl border px-3 text-sm font-semibold transition active:scale-[0.98] ${
                on
                  ? 'border-glow bg-glow/15 text-glow-soft'
                  : 'border-ink-600 bg-ink-850/50 text-slate-400 hover:border-glow/40'
              } ${locked ? 'opacity-70' : ''}`}
            >
              {category}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2 pt-3">
        <button
          type="button"
          onClick={() => onChange({ categories: [] })}
          disabled={active.length === CATEGORIES.length}
          className="btn-ghost flex-1 disabled:opacity-30"
        >
          בחר הכול
        </button>
        <button
          type="button"
          onClick={() => onChange({ categories: [CATEGORIES[0]!] })}
          disabled={active.length === 1}
          className="btn-ghost flex-1 disabled:opacity-30"
        >
          נקה בחירה
        </button>
      </div>
    </Panel>
  );
}
