interface Props {
  count: number;
  onClick: () => void;
}

export default function AgendaLauncher({ count, onClick }: Props) {
  return (
    <button
      className="ag-launcher"
      onClick={onClick}
      title="Open Quest Log"
      aria-label={`Open Quest Log${count > 0 ? ` — ${count} active` : ''}`}
    >
      📜
      {count > 0 && (
        <span className="ag-launcher-badge">{count}</span>
      )}
    </button>
  );
}
