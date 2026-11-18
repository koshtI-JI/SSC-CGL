import React, { createContext, useContext } from 'react';
import { useLiveDataSync } from '../hooks/useLiveDataSync';

type LiveDataContextValue = ReturnType<typeof useLiveDataSync>;

const LiveDataContext = createContext<LiveDataContextValue | null>(null);

export const LiveDataProvider: React.FC<{
  activeUid: string | null;
  isAdmin: boolean;
  isAdminPreview: boolean;
  isSignedIn: boolean;
  children: React.ReactNode;
}> = ({ activeUid, isAdmin, isAdminPreview, isSignedIn, children }) => {
  const value = useLiveDataSync({
    activeUid,
    isAdmin,
    isAdminPreview,
    isSignedIn,
  });

  return (
    <LiveDataContext.Provider value={value}>{children}</LiveDataContext.Provider>
  );
};

export function useLiveData(): LiveDataContextValue {
  const ctx = useContext(LiveDataContext);
  if (!ctx) {
    throw new Error('useLiveData must be used inside LiveDataProvider');
  }
  return ctx;
}
