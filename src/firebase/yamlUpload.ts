import { ref as storageRef, uploadString, deleteObject } from 'firebase/storage';
import { storage } from './config';
import { yamlPath, assertYamlSize, type YamlKind } from './yamlPaths';

// Upload / remove a player's Archipelago config for one world, owner-scoped
// (see storage.rules). The text is inert: it is parsed only in-browser to screen
// it and prefill forms, and kept for the host's later download workflow.
// Overwrites on resubmit.
//
// This is the S2 generalisation of uploadCasinoYaml — the casino keeps its own
// legacy path so archived seats stay readable.

export async function uploadYaml(
  seasonId: string,
  kind: YamlKind,
  containerId: string,
  uid: string,
  text: string,
): Promise<void> {
  if (!storage) throw new Error('Storage is not configured.');
  assertYamlSize(new Blob([text]).size);   // UTF-8 byte length, what the rule checks
  const r = storageRef(storage, yamlPath(seasonId, kind, containerId, uid));
  await uploadString(r, text, 'raw', { contentType: 'text/yaml' });
}

/**
 * Remove a player's own config. Used when they leave a world before it starts —
 * self-recall, stand-down, or a deny that asks for a resubmit.
 *
 * NOT used on a kick or a player reset: those leave a LIVE world behind, and the
 * departed player's config is the host's only record of what is running in that
 * slot (§0.5.8). Those paths run server-side and keep the file.
 *
 * Deleting an absent object is not an error here — a player who never attached
 * one still leaves cleanly.
 */
export async function deleteYaml(
  seasonId: string,
  kind: YamlKind,
  containerId: string,
  uid: string,
): Promise<void> {
  if (!storage) throw new Error('Storage is not configured.');
  try {
    await deleteObject(storageRef(storage, yamlPath(seasonId, kind, containerId, uid)));
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== 'storage/object-not-found') throw err;
  }
}
