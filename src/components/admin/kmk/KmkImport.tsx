import { useState } from 'react';
import { useKmk } from '../../../contexts/KmkContext';

interface ParseError { lineNum: number; reason: string; text: string; }

function parseRows(raw: string): { ok: true; rows: { area: string; trial: string; desc: string }[] } | { ok: false; errors: ParseError[] } {
  const errors: ParseError[] = [];
  const rows: { area: string; trial: string; desc: string }[] = [];
  let lineNum = 0;

  for (const raw_line of raw.split('\n')) {
    lineNum++;
    const line = raw_line.trimEnd();
    if (!line.trim()) continue;

    const parts = line.split(':').map(s => s.trim());
    if (parts.length !== 3) {
      errors.push({ lineNum, reason: `Expected 3 colon-separated segments, got ${parts.length}`, text: line });
    } else if (parts.some(p => !p)) {
      const names = ['Area', 'Trial', 'Description'];
      const emptyIdx = parts.findIndex(p => !p);
      errors.push({ lineNum, reason: `${names[emptyIdx]} segment is empty`, text: line });
    } else {
      rows.push({ area: parts[0], trial: parts[1], desc: parts[2] });
    }
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ lineNum: 0, reason: 'No trial lines found', text: '' });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, rows };
}

interface Props {
  onDone: (listId: string) => void;
  onCancel: () => void;
  hasExisting: boolean;
}

export default function KmkImport({ onDone, onCancel, hasExisting }: Props) {
  const { importList } = useKmk();
  const [listName, setListName] = useState('');
  const [rawText, setRawText]   = useState('');
  const [errors,  setErrors]    = useState<ParseError[] | null>(null);
  const [busy,    setBusy]      = useState(false);

  const handleSubmit = async () => {
    const nameVal = listName.trim();
    if (!nameVal) {
      setErrors([{ lineNum: 0, reason: 'List name is required', text: '' }]);
      return;
    }
    const result = parseRows(rawText);
    if (!result.ok) { setErrors(result.errors); return; }

    setErrors(null);
    setBusy(true);
    try {
      const listId = await importList(nameVal, result.rows);
      onDone(listId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kmk-import">
      <div className="kmk-import-field">
        <label className="kmk-import-label">List Name</label>
        <input
          className="kmk-import-input"
          value={listName}
          onChange={e => setListName(e.target.value)}
          placeholder="e.g. Summer Event 2025"
        />
      </div>

      <div className="kmk-import-field">
        <label className="kmk-import-label">Trial List</label>
        <textarea
          className="kmk-import-textarea"
          value={rawText}
          onChange={e => { setRawText(e.target.value); if (errors) setErrors(null); }}
          placeholder={'Area One: Trial Name: Complete the challenge\nArea One: Another Trial: Do this thing\nArea Two: Some Trial: Description here'}
        />
        <p className="kmk-import-hint">
          Each line must read <strong>Area: Trial: Task description</strong>. Areas are created locked; trials start Incomplete.
        </p>
      </div>

      {errors && errors.length > 0 && (
        <div className="kmk-import-errors">
          <div className="kmk-import-errors-title">⚠ IMPORT REJECTED — {errors.length} PROBLEM{errors.length !== 1 ? 'S' : ''}</div>
          {errors.map((e, i) => (
            <div key={i} className="kmk-import-error-item">
              {e.lineNum > 0 ? `[Line ${e.lineNum}] ` : ''}{e.reason}{e.text ? <> — <code>{e.text}</code></> : null}
            </div>
          ))}
        </div>
      )}

      <div className="kmk-import-actions">
        <button className="kmk-import-submit" onClick={handleSubmit} disabled={busy}>
          ⤵ Import List
        </button>
        {hasExisting && (
          <button className="kmk-import-cancel" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
