import { useState, useEffect, useRef } from 'react';
import { useGameState } from '../contexts/GameStateContext';
import { TILE_TYPES } from '../lib/constants';
import { getTypeKey } from '../lib/tileGen';
import { rcFromCoord } from '../lib/constants';
import type { TileState } from '../types';

interface Props {
  coord: string;
  rowIndex: number;
  colIndex: number;
  onClick: (coord: string) => void;
}

export default function Tile({ coord, rowIndex, colIndex, onClick }: Props) {
  const { gameState, loading } = useGameState();
  const tile = gameState?.tiles[coord];

  const [r, c] = rcFromCoord(coord);
  const typeKey = getTypeKey(r, c);
  const info    = TILE_TYPES[typeKey] ?? TILE_TYPES.battle;
  const state: TileState = tile?.state ?? 'hidden';
  const isCenter = coord === 'D3';

  const filled   = tile ? Object.keys(tile.adventurers ?? {}).length : 0;
  const required = tile?.required ?? 0;

  // Fog lift: animate hidden→available only after initial load
  const initializedRef = useRef(false);
  const prevStateRef   = useRef<TileState>(state);
  const [fogLifting, setFogLifting] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!initializedRef.current) {
      initializedRef.current = true;
      prevStateRef.current = state;
      return;
    }
    if (prevStateRef.current === 'hidden' && state === 'available') {
      setFogLifting(true);
      const t = setTimeout(() => setFogLifting(false), 700);
      prevStateRef.current = state;
      return () => clearTimeout(t);
    }
    prevStateRef.current = state;
  }, [state, loading]);

  const hidden = state === 'hidden';

  const classes = [
    'tile',
    hidden ? 'tile-hidden-fog' : info.cls,
    `state-${state}`,
    isCenter ? 'tile-center' : '',
    fogLifting ? 'fog-lifting' : '',
  ].filter(Boolean).join(' ');

  const animDelay = `${(rowIndex * 7 + colIndex) * 18}ms`;

  let progressText = '';
  if (state === 'available' || state === 'inprogress') {
    if (typeKey !== 'town' && typeKey !== 'town_center') {
      progressText = `${filled}/${required} ⚔`;
    }
  }

  const icon = hidden
    ? '🌫️'
    : state === 'complete' && typeKey !== 'town' && typeKey !== 'town_center'
      ? '✅'
      : info.icon;

  const label = hidden ? '' : info.label;

  const isClickable = !hidden;

  return (
    <div
      className={classes}
      style={{ animationDelay: animDelay }}
      onClick={isClickable ? () => onClick(coord) : undefined}
    >
      <span className="tile-icon">{icon}</span>
      {label && <span className="tile-label">{label}</span>}
      {progressText && <span className="tile-progress">{progressText}</span>}
    </div>
  );
}
