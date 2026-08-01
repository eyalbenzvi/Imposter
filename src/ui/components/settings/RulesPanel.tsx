import { maxImposterCount, suggestImposterCount } from '../../../game/rules';
import { Field, Panel, Toggle, type SettingsPanelProps } from './Panel';

const TIMER_OPTIONS = [
  { value: 0, label: 'ללא' },
  { value: 60, label: '60' },
  { value: 90, label: '90' },
  { value: 120, label: '120' },
] as const;

export function RulesPanel({ settings, onChange, playerCount }: SettingsPanelProps) {
  const cap = maxImposterCount(playerCount);
  const suggestion = suggestImposterCount(playerCount);

  return (
    <Panel title="הגדרות" bodyClassName="flex flex-col gap-5">
      <Field
        label="מספר מתחזים"
        note={
          cap === 1
            ? 'בקבוצה הזאת אפשר מתחזה אחד בלבד'
            : suggestion === 2
              ? 'בקבוצה הזאת מומלצים 2'
              : undefined
        }
      >
        <div className="flex gap-2">
          {[1, 2].map((count) => (
            <button
              key={count}
              type="button"
              disabled={count > cap}
              onClick={() => onChange({ imposterCount: count })}
              className={`flex-1 ${
                settings.imposterCount === count ? 'chip-on' : 'chip-off'
              } disabled:pointer-events-none disabled:opacity-30`}
            >
              {count}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="סבב הרמזים"
        note={
          settings.clueMode === 'SPEAK'
            ? 'האפליקציה מנהלת את סדר התורות, אתם מדברים'
            : 'כל שחקן מקליד רמז, ובסוף הסבב הכול על לוח אחד'
        }
      >
        <div className="flex gap-2">
          {(
            [
              ['SPEAK', 'דיבור'],
              ['TYPE', 'הקלדה'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ clueMode: value })}
              className={`flex-1 ${
                settings.clueMode === value ? 'chip-on' : 'chip-off'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="טיימר דיון" note="שניות">
        <div className="flex gap-2">
          {TIMER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange({ discussionSeconds: option.value })}
              className={`flex-1 ${
                settings.discussionSeconds === option.value ? 'chip-on' : 'chip-off'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="טיימר לכל תור רמז" note="שניות">
        <div className="flex gap-2">
          {[0, 15, 30].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ clueTimerSeconds: value })}
              className={`flex-1 ${
                settings.clueTimerSeconds === value ? 'chip-on' : 'chip-off'
              }`}
            >
              {value === 0 ? 'ללא' : value}
            </button>
          ))}
        </div>
      </Field>

      <Toggle
        label="ניחוש אחרון למתחזה"
        note="מתחזה שנתפס מקבל הזדמנות אחת לנחש את המילה מתוך 4"
        on={settings.imposterGuessEnabled}
        onChange={(on) => onChange({ imposterGuessEnabled: on })}
      />
    </Panel>
  );
}
