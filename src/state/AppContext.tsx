import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { projectFarm, type ProjModel } from '../lib/calc/projection';
import type { ClimateSeries } from '../lib/climate/openMeteo';
import { buildScenarios, monthSeries, type MonthClimate, type Scenarios } from '../lib/climate/water';
import { deriveFarm, type FarmView } from '../lib/farm/farmView';
import { moduleViews, paddockModules, type ModuleView } from '../lib/farm/modules';
import { todayLocal } from '../lib/lots/dates';
import type { Module, NotebookApi } from '../data/types';
import type { AppState, AppStore } from './store';

const StoreContext = createContext<AppStore | null>(null);
const NotebookContext = createContext<NotebookApi | null>(null);

export function AppProvider({ store, notebook, children }: { store: AppStore; notebook: NotebookApi; children: ReactNode }) {
  return (
    <StoreContext.Provider value={store}>
      <NotebookContext.Provider value={notebook}>{children}</NotebookContext.Provider>
    </StoreContext.Provider>
  );
}

/** Acesso do link público do caderno (sem login). */
export function useNotebookApi(): NotebookApi {
  const api = useContext(NotebookContext);
  if (!api) throw new Error('AppProvider ausente.');
  return api;
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

export interface ClimateModel {
  series: ClimateSeries;
  scenarios: Scenarios;
  /** Balanço hídrico por mês, por cenário: [seco, normal, chuvoso]. */
  months: Map<number, MonthClimate>[];
  model: ProjModel;
}

/**
 * Clima da fazenda aberta já transformado em balanço hídrico e projeção. Null
 * enquanto o clima não foi buscado (chame `loadClimate` na tela que precisa).
 * A chuva real registrada entra no lugar da estimada, dia a dia.
 */
export function useClimateModel(): ClimateModel | null {
  const fv = useFarmView();
  const series = useApp((s) => s.climate);
  const rain = useApp((s) => s.data?.rain);
  const fertilizations = useApp((s) => s.data?.fertilizations);
  const useCalibrated = useApp((s) => s.useCalibratedM);
  return useMemo(() => {
    if (!fv || !series) return null;
    const today = fv.view.today;
    const real = new Map<string, number>();
    for (const r of rain ?? []) real.set(r.date, (real.get(r.date) ?? 0) + r.mm);
    const scenarios = buildScenarios(series, today);
    const months = ([0, 1, 2] as const).map((s) => monthSeries(series, scenarios, real, today, s));
    const model = projectFarm({ view: fv.view, modules: fv.modules, fertilizations: fertilizations ?? [], climate: months, useCalibrated });
    return { series, scenarios, months, model };
  }, [fv, series, rain, fertilizations, useCalibrated]);
}
