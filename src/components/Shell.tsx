import { Link, NavLink, Outlet } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { useOnline } from '../lib/useOnline';
import { dateTimeText } from '../lib/format';
import { useApp } from '../state/AppContext';

const TABS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Painel', icon: 'home', end: true },
  { to: '/mapa', label: 'Mapa', icon: 'map' },
  { to: '/modulos', label: 'Módulos', icon: 'grid' },
  { to: '/rebanho', label: 'Rebanho', icon: 'herd' },
  { to: '/clima', label: 'Clima', icon: 'rain' },
  { to: '/analise', label: 'Análise', icon: 'chart' },
];

const tabBase =
  'flex min-h-[54px] min-w-0 flex-1 flex-col items-center justify-center gap-[3px] rounded-[14px] px-0.5 py-1.5 text-[11px] no-underline ' +
  'desk:min-h-[44px] desk:flex-none desk:flex-row desk:gap-2 desk:rounded-full desk:px-4 desk:py-0 desk:text-sm';

export function Shell() {
  const online = useOnline();
  const farm = useApp((s) => s.farms.find((f) => f.id === s.farmId) ?? s.data?.farm ?? null);
  const staleSince = useApp((s) => s.staleSince);
  const loading = useApp((s) => s.loading);
  const refresh = useApp((s) => s.refresh);

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line bg-bg/95">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-3 px-3.5 py-2 desk:px-6 desk:py-2.5">
          <Link to="/fazendas" className="flex min-h-[44px] min-w-0 flex-col justify-center gap-0.5 text-text no-underline">
            <span className="eyebrow">{farm ? 'Fazenda · trocar' : 'Fazenda'}</span>
            <span className="truncate font-display text-[19px] font-bold tracking-[-0.01em] desk:text-[22px]">
              {farm ? farm.name : 'Nenhuma aberta'}
            </span>
          </Link>

          {/* No celular a navegação fica presa embaixo; no desktop vira pílula no topo.
              Sem fazenda aberta não há para onde navegar, então ela some. */}
          {farm ? (
            <nav
              aria-label="Áreas do sistema"
              className="fixed inset-x-2 bottom-2 z-30 flex justify-between gap-0.5 rounded-[20px] border border-line bg-card p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.6)] desk:static desk:gap-1 desk:rounded-full desk:p-1 desk:shadow-none"
            >
              {TABS.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  end={t.end}
                  className={({ isActive }) =>
                    `${tabBase} ${isActive ? 'bg-lime font-semibold text-ink' : 'font-medium text-text'}`
                  }
                >
                  <Icon name={t.icon} />
                  {t.label}
                </NavLink>
              ))}
            </nav>
          ) : null}

          <span
            role="status"
            className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold ${
              online ? 'border-line text-muted' : 'border-warn text-warn'
            }`}
          >
            <i aria-hidden="true" className={`h-2 w-2 rounded-full ${online ? 'bg-ramp-3' : 'bg-warn'}`} />
            {online ? 'Online' : 'Sem sinal'}
          </span>
        </div>

        {staleSince ? (
          <div className="border-t border-warn/40 bg-warn/10">
            <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3.5 py-1.5 text-[13px] text-warn desk:px-6">
              <span>Sem resposta do servidor. Mostrando a cópia salva em {dateTimeText(staleSince)}.</span>
              <button type="button" className="btn min-h-[36px] border-warn/60 px-3 text-[13px] text-warn" disabled={loading} onClick={() => void refresh()}>
                {loading ? 'Atualizando…' : 'Atualizar'}
              </button>
            </div>
          </div>
        ) : null}
      </header>

      <main className="mx-auto max-w-[1320px] px-3 pb-[120px] pt-3.5 desk:px-6 desk:pt-5">
        <Outlet />
      </main>
    </>
  );
}
