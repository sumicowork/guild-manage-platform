'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

interface SelectedIdentityContextValue {
  /** 当前选中的管理员身份 ID，null 表示使用默认凭证 */
  selectedIdentityId: number | null;
  /** 设置选中的管理员身份 */
  setSelectedIdentityId: (id: number | null) => void;
}

const SelectedIdentityContext = createContext<SelectedIdentityContextValue>({
  selectedIdentityId: null,
  setSelectedIdentityId: () => {},
});

export function SelectedIdentityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selectedIdentityId, setSelectedIdentityId] = useState<number | null>(null);

  const setIdentity = useCallback((id: number | null) => {
    setSelectedIdentityId(id);
  }, []);

  return (
    <SelectedIdentityContext.Provider
      value={{ selectedIdentityId, setSelectedIdentityId: setIdentity }}
    >
      {children}
    </SelectedIdentityContext.Provider>
  );
}

export function useSelectedIdentity(): SelectedIdentityContextValue {
  return useContext(SelectedIdentityContext);
}
