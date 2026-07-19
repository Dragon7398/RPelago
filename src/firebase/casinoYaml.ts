import { ref as storageRef, uploadString } from 'firebase/storage';
import { storage } from './config';

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
  const r = storageRef(storage, `casino/${seasonId}/${missionId}/${uid}.yaml`);
  await uploadString(r, text, 'raw', { contentType: 'text/yaml' });
}
