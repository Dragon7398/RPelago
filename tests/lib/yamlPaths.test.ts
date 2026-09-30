import { describe, it, expect } from 'vitest';
import {
  yamlPath, legacyCasinoYamlPath, assertYamlSize, MAX_YAML_BYTES,
} from '../../src/firebase/yamlPaths';

describe('yamlPath', () => {
  it('builds the universal config path', () => {
    expect(yamlPath('rpelago_s2', 'challenge', 'D4', 'uid1'))
      .toBe('yaml/rpelago_s2/challenge/D4/uid1.yaml');
    expect(yamlPath('rpelago_s2', 'mission', '-NxAbc123', 'uid1'))
      .toBe('yaml/rpelago_s2/mission/-NxAbc123/uid1.yaml');
  });

  it('passes an interior coord through verbatim, colon and all', () => {
    // The compound coord IS the containerId (§3.3) — no encoding, so there is
    // no second scheme to keep in step with the RTDB one. The storage rule
    // matches a single path segment, which admits ':'.
    expect(yamlPath('s2', 'challenge', 'G1:2_3', 'u'))
      .toBe('yaml/s2/challenge/G1:2_3/u.yaml');
    expect(yamlPath('s2', 'challenge', 'T1:0_2', 'u'))
      .toBe('yaml/s2/challenge/T1:0_2/u.yaml');
  });

  it('keeps every container in its own directory', () => {
    // Two worlds must never collide, or one player's config would overwrite
    // another's. Surface D4, the dungeon AT D4, and a mission with that id are
    // three different things.
    const paths = new Set([
      yamlPath('s2', 'challenge', 'D4', 'u'),
      yamlPath('s2', 'challenge', 'D4:1_1', 'u'),
      yamlPath('s2', 'mission', 'D4', 'u'),
    ]);
    expect(paths.size).toBe(3);
  });

  it('separates seasons, so an S2 join cannot read an S1.5 file', () => {
    expect(yamlPath('a', 'mission', 'm', 'u')).not.toBe(yamlPath('b', 'mission', 'm', 'u'));
  });

  it('names the file after the uid — what the owner-scoping rule checks', () => {
    // storage.rules allows read/write/delete only when
    // `fileName == request.auth.uid + '.yaml'`, so this suffix IS the boundary.
    expect(yamlPath('s', 'challenge', 'c', 'someuid').endsWith('/someuid.yaml')).toBe(true);
  });

  it('never collides with the legacy casino tree', () => {
    // Both live in one bucket; the `yaml/` vs `casino/` prefix keeps the two
    // rule blocks from ever overlapping.
    expect(yamlPath('s', 'mission', 'm', 'u').startsWith('yaml/')).toBe(true);
    expect(legacyCasinoYamlPath('s', 'm', 'u').startsWith('casino/')).toBe(true);
  });
});

describe('assertYamlSize', () => {
  it('accepts a realistic config', () => {
    expect(() => assertYamlSize(120 * 1024)).not.toThrow();   // 120 KB multi-game
    expect(() => assertYamlSize(0)).not.toThrow();
  });

  it('rejects at the cap, matching the rule’s strict <', () => {
    // storage.rules uses `< 1024 * 1024`, so exactly 1 MB is REJECTED there.
    // The client mirror must not accept what the server will bounce.
    expect(() => assertYamlSize(MAX_YAML_BYTES)).toThrow(/too large/);
    expect(() => assertYamlSize(MAX_YAML_BYTES + 1)).toThrow(/too large/);
    expect(() => assertYamlSize(MAX_YAML_BYTES - 1)).not.toThrow();
  });

  it('reports the size in the message so the player knows by how much', () => {
    expect(() => assertYamlSize(5 * 1024 * 1024)).toThrow(/5\.0 MB/);
  });
});
