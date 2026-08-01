import { useEffect, useRef, useState } from 'react';
import { MAX_NAME_LENGTH } from '../protocol';

/**
 * A name in the lobby list that a player can tap to change.
 *
 * Only ever offered before a game starts. Once play begins the roster is frozen
 * into the reducer's `players`, and every screen addresses people by the names
 * it holds — a rename mid-round would have to reach into the game engine, which
 * this whole mode is built not to do. Between games the room reopens into the
 * lobby, so in practice a name can be changed between rounds too.
 */
export function EditableName({
  name,
  onRename,
  error,
}: {
  name: string;
  onRename: (name: string) => void;
  /** Rejection text from the host, e.g. the name is already taken. */
  error?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  // A rejected rename leaves the field open so the player can fix it rather
  // than having to find their way back in.
  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  const commit = (): void => {
    const next = draft.trim();
    setEditing(false);
    if (next.length === 0 || next === name) {
      setDraft(name);
      return;
    }
    onRename(next);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-start"
      >
        <span className="niqqud min-w-0 truncate text-lg text-slate-100">{name}</span>
        <span aria-hidden className="shrink-0 text-xs text-slate-500">
          ✎
        </span>
        <span className="sr-only">שינוי השם</span>
      </button>
    );
  }

  return (
    <span className="min-w-0 flex-1">
      <input
        ref={input}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(name);
            setEditing(false);
          }
        }}
        maxLength={MAX_NAME_LENGTH}
        autoComplete="off"
        enterKeyHint="done"
        aria-label="השם שלכם"
        className="niqqud w-full rounded-lg border border-glow bg-ink-800 px-2 py-1
          text-lg text-slate-50 outline-none"
      />
      {error && <span className="block pt-1 text-xs text-danger">{error}</span>}
    </span>
  );
}
