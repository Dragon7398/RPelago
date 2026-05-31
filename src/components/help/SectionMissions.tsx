export default function SectionMissions() {
  return (
    <div className="help-section">
      <h3>Guildmaster Missions</h3>
      <p>
        While your Adventurers tackle the map, <strong>you</strong> — the Guildmaster — can
        undertake missions in person. These are found inside the <strong>Centralia Guild
        Hall</strong> (the center tile, D3): click it to open the lightbox and scroll up to
        the <strong>⚜ Guildmaster Commissions</strong> panel above the shop.
      </p>
      <p>
        Unlike tile challenges, missions are played <em>by the guildmaster directly</em>. You
        submit your own YAML, track your own slot, and earn rewards when the mission completes
        — all without tying up an Adventurer.
      </p>

      <div className="help-callout">
        <span className="help-callout-icon">⚜</span>
        <span>
          You may only be on <strong>one mission at a time</strong>. While enlisted, a
          chip appears next to your level badge in the HUD — click it to jump straight
          to the Guild Hall.
        </span>
      </div>

      <h4>The Two Missions</h4>
      <div className="help-tile-list">
        <div className="help-tile-row">
          <span className="help-tile-icon">🗡️</span>
          <div>
            <strong>Basic Training</strong> — <em>Once per guildmaster, per season.</em>
            {' '}Up to 5 players, 100 XP reward. Comes with the <strong>Sturdy 150</strong>
            trait — your slot must have at least 150 checks. A good starting point for
            new guildmasters.
          </div>
        </div>
        <div className="help-tile-row">
          <span className="help-tile-icon">🛡️</span>
          <div>
            <strong>Patrol</strong> — <em>Repeatable.</em>
            {' '}Up to 8 players, 50 XP + 50 GP reward. No special trait — straightforward
            steady work. New cohorts keep forming, so there's always one available.
          </div>
        </div>
      </div>

      <h4>Cohorts & Slot Decay</h4>
      <p>
        Each mission runs in numbered cohorts (Cohort I, II, III…). A cohort starts{' '}
        <strong>Forming</strong> and deploys — locks in — when it fills up.
      </p>
      <p>
        There's a catch: each cohort has a <strong>24-hour slot decay</strong>. The timer
        begins when the first guildmaster enlists. Every 24 hours without filling, one
        available slot disappears. If decay brings the open slots down to match the number
        of people already signed up, the cohort deploys automatically. Slots pips on the
        card show the current state — a <span style={{ color: 'oklch(62% 0.18 25)', fontWeight: 600 }}>dashed red pip</span> is the next one at risk.
      </p>

      <h4>Enlisting & Standing Down</h4>
      <ol className="help-list">
        <li>
          Click <strong>TAKE BASIC TRAINING</strong> or <strong>TAKE THIS MISSION</strong>
          on the card. You're now enlisted — the banner at the top of the panel shows your
          active mission.
        </li>
        <li>
          While the cohort is still <strong>Forming</strong>, you may <strong>Stand
          Down</strong> freely — this does <em>not</em> spend your Basic Training shot; that's
          only spent on completion.
        </li>
        <li>
          Once the cohort <strong>deploys</strong>, you're committed. The Stand Down button
          is replaced by <strong>⚑ COMMITTED</strong> — you stay until the mission completes.
        </li>
        <li>
          After deployment, submit your YAML to the Discord thread as normal:
          {' '}<em>"Game YAML for Basic Training · Cohort III at RPelago-D3."</em>
          {' '}The admin will enter your slot details once the room is set up.
        </li>
      </ol>

      <h4>Rewards & Feats</h4>
      <p>
        When an admin marks the mission complete, XP and Gold are distributed to all
        participants. <strong>Mentor</strong> and <strong>Treasurer</strong> feats apply
        exactly as they do on tile challenges — other feat-holders boost your reward, and you
        boost theirs.
      </p>
      <p>
        Completing <strong>Basic Training</strong> permanently sets your{' '}
        <em>basicTrainingDone</em> flag for the season. After that, Basic Training cohorts
        collapse into a separate section at the bottom of the Guild Hall panel — you can
        expand it to watch others, but you cannot re-enlist.
      </p>

      <div className="help-callout">
        <span className="help-callout-icon">📜</span>
        <span>
          Your completed missions and past tile challenges are both visible in your{' '}
          <strong>Profile</strong> (click your name in the HUD), in the{' '}
          <strong>History</strong> section below your Adventurers.
        </span>
      </div>
    </div>
  );
}
