'use client';

import { useSyncExternalStore } from 'react';
import { readPersona } from './persona';

const subscribe = () => () => {};

/** True for an agent with their own workspace (presentation only). False on the server and until the browser has hydrated. */
export function useWorkspaceAgent(): boolean {
  return useSyncExternalStore(subscribe, () => readPersona().workspace === true, () => false);
}
