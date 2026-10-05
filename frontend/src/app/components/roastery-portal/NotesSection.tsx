// Roastery portal (2026-10-05) — section 02, the tasting notes. A list of notes
// (leading one first, up to 15). Each note: the roaster's own words in a text
// field, then an optional pick of the closest flavor wheel term under it
// (category chips, then descriptor chips grouped by subcategory). If the typed
// words equal a descriptor (case-insensitive) it is preselected. The pick is
// clearable; a note with no pick is saved as words only. Reorder with up/down.

import { useMemo, useState } from 'react';
import { Chip } from './ui';
import { COPY } from './copy';
import type { DocNote, WheelCategory } from './types';

const MAX_NOTES = 15;

export interface WheelIndex {
  byId: Map<string, { category: string; descriptor: string }>;
  byWord: Map<string, string>;
}

export function buildWheelIndex(wheel: WheelCategory[]): WheelIndex {
  const byId = new Map<string, { category: string; descriptor: string }>();
  const byWord = new Map<string, string>();
  for (const cat of wheel) {
    for (const sub of cat.subcategories) {
      for (const d of sub.descriptors) {
        byId.set(d.id, { category: cat.name, descriptor: d.descriptor });
        const key = d.descriptor.trim().toLowerCase();
        if (!byWord.has(key)) byWord.set(key, d.id);
      }
    }
  }
  return { byId, byWord };
}

let noteSeq = 0;
export const newNoteKey = () => `note-${++noteSeq}`;

function NoteItem({ index, count, note, wheel, wheelIndex, onChange, onMove, onRemove }: {
  index: number; count: number; note: DocNote; wheel: WheelCategory[]; wheelIndex: WheelIndex;
  onChange: (n: DocNote) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void;
}) {
  const [openCat, setOpenCat] = useState<string | null>(null);
  const pick = note.cuppingNoteId ? wheelIndex.byId.get(note.cuppingNoteId) : undefined;
  const activeCat = openCat ?? pick?.category ?? null;
  const category = wheel.find(c => c.name === activeCat);
  const inputId = `rp-note-${note.key}`;

  function setWords(words: string) {
    // Typed words equal to a wheel descriptor preselect it, unless a pick is already made.
    const match = wheelIndex.byWord.get(words.trim().toLowerCase());
    if (match && !note.cuppingNoteId) {
      setOpenCat(wheelIndex.byId.get(match)!.category);
      onChange({ ...note, words, cuppingNoteId: match });
    } else {
      onChange({ ...note, words });
    }
  }

  return (
    <li className="note-item">
      <div className="n3">
        <span className="nn" aria-hidden="true">{index + 1}</span>
        <div className="grow">
          <label className="lab" htmlFor={inputId}>
            {index === 0 ? 'Leading note' : `Note ${index + 1}`}
          </label>
          <input
            id={inputId}
            className="in"
            value={note.words}
            maxLength={300}
            placeholder={index === 0 ? COPY.notePlaceholder : ''}
            onChange={e => setWords(e.target.value)}
          />
        </div>
        <div className="nctl">
          <button type="button" className="tiny" aria-label={`Move note ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)}>Up</button>
          <button type="button" className="tiny" aria-label={`Move note ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)}>Down</button>
          {count > 1 && <button type="button" className="tiny" aria-label={`Remove note ${index + 1}`} onClick={onRemove}>Remove</button>}
        </div>
      </div>

      <div className="wheel">
        <div className="glab" id={`${inputId}-wheel`}>
          Closest on the flavor wheel{pick ? `: ${pick.descriptor}` : ' (optional)'}
        </div>
        <div className="chips" role="radiogroup" aria-labelledby={`${inputId}-wheel`}>
          {wheel.map(c => (
            <Chip key={c.name} small on={activeCat === c.name} onClick={() => setOpenCat(activeCat === c.name ? null : c.name)}>{c.name}</Chip>
          ))}
        </div>
        {category && category.subcategories.map(sub => (
          <div key={sub.name ?? '_'}>
            {sub.name && sub.name !== category.name && <div className="glab">{sub.name}</div>}
            <div className="chips" role="radiogroup" aria-label={sub.name ?? category.name}>
              {sub.descriptors.map(d => (
                <Chip key={d.id} small on={note.cuppingNoteId === d.id} onClick={() => onChange({ ...note, cuppingNoteId: note.cuppingNoteId === d.id ? null : d.id })}>
                  {d.descriptor}
                </Chip>
              ))}
            </div>
          </div>
        ))}
        {pick && (
          <div className="chips">
            <button type="button" className="tiny" onClick={() => onChange({ ...note, cuppingNoteId: null })}>Clear the pick</button>
          </div>
        )}
      </div>
    </li>
  );
}

export default function NotesSection({ notes, wheel, onChange }: {
  notes: DocNote[]; wheel: WheelCategory[]; onChange: (notes: DocNote[]) => void;
}) {
  const wheelIndex = useMemo(() => buildWheelIndex(wheel), [wheel]);

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= notes.length) return;
    const next = notes.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <>
      <p className="help">{COPY.notesHint}</p>
      <ol className="notes-list" style={{ listStyle: 'none', padding: 0 }} aria-label={COPY.notesLabel}>
        {notes.map((n, i) => (
          <NoteItem
            key={n.key}
            index={i}
            count={notes.length}
            note={n}
            wheel={wheel}
            wheelIndex={wheelIndex}
            onChange={updated => onChange(notes.map(x => (x.key === n.key ? updated : x)))}
            onMove={dir => move(i, dir)}
            onRemove={() => onChange(notes.filter(x => x.key !== n.key))}
          />
        ))}
      </ol>
      {notes.length < MAX_NOTES && (
        <button type="button" className="chip add addnote" onClick={() => onChange([...notes, { key: newNoteKey(), words: '', cuppingNoteId: null }])}>
          + Add a note
        </button>
      )}
    </>
  );
}
