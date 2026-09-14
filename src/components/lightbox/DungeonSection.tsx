/**
 * A Dungeon's SURFACE tile. The challenges are inside — a 5x7 maze with two
 * Elites and two treasure chests — so this tile is never joinable itself; it is
 * a doorway. Phase 3 turns the button live and lights the orb pips as each of
 * the dungeon's two Elites falls.
 */
export default function DungeonSection() {
  return (
    <div className="lb-sealed">
      <div className="lb-sealed-title">🗝️ Sealed Depths</div>
      <p className="lb-sealed-body">
        A multi-stage delve. Sealed for now — the depths open later this season.
      </p>
      <div className="lb-orb-pips" aria-label="Orbs recovered from this dungeon: 0 of 2">
        <span className="lb-orb-pip" />
        <span className="lb-orb-pip" />
        <span className="lb-orb-pip-label">0 / 2 orbs recovered</span>
      </div>
    </div>
  );
}
