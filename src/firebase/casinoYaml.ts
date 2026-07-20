import { ref as storageRef, uploadString } from 'firebase/storage';
import { storage } from './config';

// Max config size, in UTF-8 bytes. MUST match the cap in storage.rules — the rule
// is the real gate (Firebase rejects an oversized upload before storing); this
// mirror lets us reject early with a clear message instead of a raw Storage error.
export const MAX_YAML_BYTES = 1024 * 1024; // 1 MB

// Upload a seat's Slot-Fill YAML to its owner-scoped Storage path
// (casino/{seasonId}/{missionId}/{uid}.yaml — see storage.rules). The text is
// inert: it is parsed only in-browser to prefill the Manifest, and kept here for
// the host's later download/clean/process-locally workflow. Overwrites on resubmit.
export async function uploadCasinoYaml(
  seasonId: string,
  missionId: string,
  uid: string,
  text: string,
): Promise<void> {
  if (!storage) throw new Error('Storage is not configured.');
  const bytes = new Blob([text]).size; // UTF-8 byte length, what the rule checks
  if (bytes >= MAX_YAML_BYTES)
    throw new Error(`That config is too large (${(bytes / 1024 / 1024).toFixed(1)} MB). Configs must be under 1 MB.`);
  const r = storageRef(storage, `casino/${seasonId}/${missionId}/${uid}.yaml`);
  await uploadString(r, text, 'raw', { contentType: 'text/yaml' });
}
