import { initializeApp, getApps } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';
import { getAuth, type Auth } from 'firebase/auth';
import { getFunctions, type Functions } from 'firebase/functions';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL:       import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseReady = !!firebaseConfig.apiKey && !!firebaseConfig.databaseURL;

let db:        Database        | null = null;
let auth:      Auth            | null = null;
let functions: Functions       | null = null;
let storage:   FirebaseStorage | null = null;

if (firebaseReady) {
  const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  db        = getDatabase(app);
  auth      = getAuth(app);
  functions = getFunctions(app);
  storage   = getStorage(app);
}

export { db, auth, functions, storage };
