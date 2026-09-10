import { describe, it, expect, afterEach } from 'vitest';
import { resolveSeason } from '../../src/firebase/season';
import { setActiveBoard, activeBoard } from '../../src/lib/board';
import type { SeasonConfig } from '../../src/types';

afterEach(() => setActiveBoard('s1'));

const config = (over: Partial<SeasonConfig> = {}): SeasonConfig => ({
  adminId: 'admin',
  activeSeasonId: 'rpelago_s1',
  minClientVersion: 0,
  seasonList: {
    rpelago_s1:  { label: 'Season 1', shell: 'map',    status: 'archived' },
    casino_s1_5: { label: 'Casino',   shell: 'casino', status: 'active'   },
    rpelago_s2:  { label: 'Season 2', shell: 'map',    status: 'active', board: 's2' },
  },
  draftSeasons: {
    draft_s2:  { label: 'S2 Draft',  shell: 'map', board: 's2' },
    draft_old: { label: 'Old Draft', shell: 'map' },
  },
  ...over,
});

describe('resolveSeason — board resolution', () => {
  it('defaults a listed season with no board field to s1', () => {
    // Every config entry that exists today predates the field. They must keep
    // resolving to the 5x7 board rather than silently becoming 6x7.
    expect(resolveSeason(config())!.board).toBe('s1');
    expect(resolveSeason(config({ activeSeasonId: 'casino_s1_5' }))!.board).toBe('s1');
  });

  it('reads an explicit board off a listed season', () => {
    expect(resolveSeason(config({ activeSeasonId: 'rpelago_s2' }))!.board).toBe('s2');
  });

  it('reads an explicit board off a DRAFT season', () => {
    // The S2 playtest path: admin/alpha previewing an unlisted draft.
    expect(resolveSeason(config(), 'draft_s2')!.board).toBe('s2');
  });

  it('defaults a draft with no board field to s1', () => {
    expect(resolveSeason(config(), 'draft_old')!.board).toBe('s1');
  });

  it('falls back to the live season when a stale preview cannot resolve', () => {
    // SeasonProvider does resolveSeason(cfg, preview) ?? resolveSeason(cfg, null).
    const stale = resolveSeason(config(), 'deleted_draft');
    const live  = stale ?? resolveSeason(config(), null);
    expect(live!.id).toBe('rpelago_s1');
    expect(live!.board).toBe('s1');
  });
});

describe('publishing the board', () => {
  it('setActiveBoard(season.board) switches the geometry helpers', () => {
    const s2 = resolveSeason(config(), 'draft_s2')!;
    setActiveBoard(s2.board);
    expect(activeBoard().rows).toBe(6);
    expect(activeBoard().startCoord).toBe('D6');

    const s1 = resolveSeason(config())!;
    setActiveBoard(s1.board);
    expect(activeBoard().rows).toBe(5);
    expect(activeBoard().startCoord).toBe('D3');
  });
});
