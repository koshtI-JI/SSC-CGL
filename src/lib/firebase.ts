import { getApp, getApps, initializeApp } from 'firebase/app';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import {
  FIRESTORE_QUOTA_RESET_MESSAGE,
  isQuotaExceededError,
  markFirestoreQuotaExceeded,
} from '../utils/firestoreQuota';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const DEFAULT_ADMIN_ID = 'admin';
export const ADMIN_PREVIEW_UID = 'admin_preview';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  if (isQuotaExceededError(error)) {
    markFirestoreQuotaExceeded(error);
    console.warn('Firestore Quota Exceeded:', path ?? 'unknown', error);
    throw new Error(FIRESTORE_QUOTA_RESET_MESSAGE);
  }
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (isQuotaExceededError(error)) {
      markFirestoreQuotaExceeded(error);
    } else if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testFirestoreConnection();
