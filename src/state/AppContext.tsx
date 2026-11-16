import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { deriveFarm, type FarmView } from '../lib/farm/farmView';
import { moduleViews, paddockModules, type ModuleView } from '../lib/farm/modules';
import { todayLocal } from '../lib/lots/dates';
import type { Module } from '../data/types';
import type { AppState, AppStore } from './store';

const StoreContext = createContext<AppStore | null>(null);

export function AppProvider({ store, children }: { store: AppStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useApp<T>(selector: (s: AppState) => T): T {
  const store = useContext(StoreContext);
  if (!store) throw new Error('AppProvider ausente.');
  return useStore(store, selector);
}

export interface FarmScreenData {
  view: FarmView;
  modules: ModuleView[];
  /** De qual módulo é cada piquete hoje. */
  moduleOf: Map<string, Module>;
  paddockName: (id: string) => string;
  lotName: (id: string) => string;
}

/** Situação de hoje da fazenda aberta, recalculada quando o histórico muda. Null sem fazenda carregada. */
export function useFarmView(): FarmScreenData | null {
  const data = useApp((s) => s.data);
  const today = todayLocal();
  return useMemo(() => {
    if (!data) return null;
    const view = deriveFarm(data, today);
    return {
      view,
      modules: moduleViews(data.modules, data.compositions, view),
      moduleOf: paddockModules(data.modules, data.compositions, today),
      paddockName: (id) => view.paddockById.get(id)?.paddock.name ?? 'piquete removido',
      lotName: (id) => data.lots.find((l) => l.id === id)?.name ?? 'lote removido',
    };
  }, [data, today]);
}
