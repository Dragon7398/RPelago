import { useState, useMemo } from 'react';
import { useKmk } from '../../../contexts/KmkContext';
import KmkImport from './KmkImport';
import KmkLedger from './KmkLedger';

type View = 'list' | 'import';

export default function KmkPage() {
  const { lists, activeListId, loading, setActiveList, deleteList } = useKmk();

  const [view, setView] = useState<View>('list');
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const listEntries = useMemo(
    () => Object.entries(lists).sort(([, a], [, b]) => a.createdAt - b.createdAt),
    [lists],
  );

  const hasLists = listEntries.length > 0;

  const displayListId = useMemo(() => {
    if (selectedListId && lists[selectedListId]) return selectedListId;
    if (activeListId && lists[activeListId]) return activeListId;
    return listEntries[0]?.[0] ?? null;
  }, [selectedListId, activeListId, lists, listEntries]);

  const handleImportDone = (listId: string) => {
    setSelectedListId(listId);
    setView('list');
  };

  const handleDelete = async (listId: string) => {
    if (deleteConfirm !== listId) { setDeleteConfirm(listId); return; }
    setDeleteConfirm(null);
    if (displayListId === listId) setSelectedListId(null);
    await deleteList(listId);
  };

  const handleSetActive = async (listId: string) => {
    await setActiveList(listId);
  };

  if (loading) {
    return (
      <div className="dash-section">
        <div className="dash-loading-inline">Loading Keep data…</div>
      </div>
    );
  }

  return (
    <div className="kmk-page">
      {/* Page header */}
      <div className="kmk-page-header">
        <h2 className="kmk-page-title">🗝 Keymaster's Keep</h2>
        <div className="kmk-page-actions">
          {view !== 'import' && (
            <button
              className="kmk-new-list-btn"
              onClick={() => setView('import')}
            >
              ＋ New List
            </button>
          )}
        </div>
      </div>

      {/* Import form */}
      {view === 'import' && (
        <KmkImport
          onDone={handleImportDone}
          onCancel={() => setView('list')}
          hasExisting={hasLists}
        />
      )}

      {/* List switcher + ledger (only shown when not importing) */}
      {view === 'list' && (
        <>
          {!hasLists ? (
            <div className="dash-empty">
              <div className="dash-empty-icon">🗝</div>
              <div className="dash-empty-msg">No lists yet. Import a trial list to get started.</div>
            </div>
          ) : (
            <>
              {/* List switcher strip */}
              <div className="kmk-list-strip">
                {listEntries.map(([listId, list]) => {
                  const isActive   = listId === activeListId;
                  const isSelected = listId === displayListId;
                  const isDeletePending = deleteConfirm === listId;
                  return (
                    <div
                      key={listId}
                      className={`kmk-list-item${isSelected ? ' selected' : ''}`}
                      onClick={() => { setSelectedListId(listId); setDeleteConfirm(null); }}
                    >
                      <div className="kmk-list-item-name">
                        {list.name}
                        {isActive && <span className="kmk-active-badge">ACTIVE</span>}
                      </div>
                      <div className="kmk-list-item-controls" onClick={e => e.stopPropagation()}>
                        <a
                          className="kmk-player-view-link"
                          href={`/#keep/${listId}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Open player view for this list"
                        >
                          👁
                        </a>
                        <button
                          className="kmk-set-active-btn"
                          disabled={isActive}
                          onClick={() => handleSetActive(listId)}
                          title={isActive ? 'Already active' : 'Set as active'}
                        >
                          Set Active
                        </button>
                        <button
                          className={`kmk-delete-btn${isDeletePending ? ' confirm' : ''}`}
                          disabled={isActive}
                          title={isActive ? 'Cannot delete the active list' : isDeletePending ? 'Click again to confirm' : 'Delete list'}
                          onClick={() => handleDelete(listId)}
                        >
                          {isDeletePending ? 'Confirm?' : '🗑'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Ledger for selected list */}
              {displayListId && lists[displayListId] && (
                <KmkLedger listId={displayListId} list={lists[displayListId]} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
