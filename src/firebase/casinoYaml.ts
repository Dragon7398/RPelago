import { ref as storageRef, uploadString } from 'firebase/storage';
import { storage } from './config';
import { legacyCasinoYamlPath, assertYamlSize, MAX_YAML_BYTES } from './yamlPaths';

// Re-exported: several casino components import the cap from here.
export { MAX_YAML_BYTES };

// Upload a seat's Slot-Fill YAML to its owner-scoped Storage path
// (casino/{seasonId}/{missionId}/{uid}.yaml — see storage.rules). The text is
// inert: it is parsed only in-browser to prefill the Manifest, and kept here for
// the host's later download/clean/process-locally workflow. Overwrites on resubmit.
//
// This keeps the LEGACY path deliberately. S2 collects a config at every join
// through `uploadYaml` (yaml/{seasonId}/{kind}/{containerId}/{uid}.yaml), but
// the casino's own flow submits at the manifest phase rather than at enlist, and
// S1.5's archived seats must stay readable at the path they were written to.
export async function uploadCasinoYaml(
  seasonId: string,
  missionId: string,
  uid: string,
  text: string,
): Promise<void> {
  if (!storage) throw new Error('Storage is not configured.');
  assertYamlSize(new Blob([text]).size);   // UTF-8 byte length, what the rule checks
  const r = storageRef(storage, legacyCasinoYamlPath(seasonId, missionId, uid));
  await uploadString(r, text, 'raw', { contentType: 'text/yaml' });
}
