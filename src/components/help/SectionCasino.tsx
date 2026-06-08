export default function SectionCasino() {
  return (
    <div className="help-section">
      <h3>Casino Missions</h3>
      <p>
        <strong>Casino</strong> cohorts also appear in the{' '}
        <strong>Centralia Guild Hall</strong> (tile D3). These work differently from standard
        missions — instead of submitting a YAML and waiting for results, you sit down at a
        card table and play a quick minigame to determine your own slots and gold reward.
      </p>
      <p>
        When a casino cohort deploys, each participant pays an <strong>ante</strong> and is
        dealt a hand of cards. Each card represents a game category — a genre, franchise, or
        platform. The cards you <strong>commit</strong> become your mission slots; their gold
        values set your reward. You then submit your YAML as normal for each committed slot.
      </p>

      <h4>The Games</h4>
      <div className="help-tile-list">
        <div className="help-tile-row">
          <span className="help-tile-icon">♥</span>
          <div>
            <strong>Poker (40g ante)</strong> — Dealt 5 cards. You may <em>reroll</em> once
            for 20g to replace your hand. Reject any cards you don't want to play; the rest
            become your slots.
          </div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon">♠</span>
          <div>
            <strong>Blackjack (30g ante)</strong> — Dealt cards one at a time. Discard one
            before locking in. Your goal is to keep the best combination of cards you can.
            Higher risk, but a lower cost, and can be just as rewarding with the right hand.
          </div>
        </div>
      </div>

      <h4>Gambits</h4>
      <p>
        Before locking in, you'll face a <strong>Gambit</strong> — a card that tweaks the
        cohort's shared challenge stats (Release Odds, Collect Odds, Hint Cost). Bonus gambits
        improve the odds but cost gold; penalty gambits hurt the odds but reward you with extra
        XP and pot contributions. You can always skip the gambit entirely.
      </p>

      <h4>The Pot</h4>
      <p>
        40% of every ante feeds a <strong>shared pot</strong>. When the cohort reveals, every
        non-folded seat splits it evenly — so even a modest hand can come out ahead.
        Players who fold keep nothing and receive no slots.
      </p>

      <h4>Card Types</h4>
      <p>
        Cards are drawn from a shared deck and come in five types, ranging from broad
        categories (easier to fill) to narrow ones (harder to fill but generally worth more
        gold):
      </p>
      <div className="help-tile-list">
        <div className="help-tile-row">
          <span className="help-tile-icon" style={{ fontSize: '0.8em', opacity: 0.7 }}>🃏</span>
          <div><strong>Wild</strong> — Any game you like. Low value, but always playable.</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon" style={{ fontSize: '0.8em', opacity: 0.7 }}>🎲</span>
          <div><strong>Broad</strong> — A wide genre (e.g. Action RPG, Puzzle). Most common card in the deck.</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon" style={{ fontSize: '0.8em', opacity: 0.7 }}>🖥️</span>
          <div><strong>Platform</strong> — A specific console or family (e.g. SNES, Game Boy).</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon" style={{ fontSize: '0.8em', opacity: 0.7 }}>⭐</span>
          <div><strong>Franchise</strong> — A named series (e.g. Zelda, Final Fantasy).</div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon" style={{ fontSize: '0.8em', opacity: 0.7 }}>🎯</span>
          <div><strong>Narrow</strong> — A tight sub-genre (e.g. Metroidvania, Tactical RPG). Highest value, fewest copies in the deck.</div>
        </div>
      </div>

      <div className="help-callout">
        <span className="help-callout-icon">🃏</span>
        <span>
          Casino missions pay best when you can commit <strong>2 or more cards</strong>. If
          you tend to play a few specific games or are in a particular mood, a standard Patrol is
          likely a safer choice.
        </span>
      </div>
    </div>
  );
}
