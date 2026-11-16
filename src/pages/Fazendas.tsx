import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useApp } from '../state/AppContext';

export function Fazendas() {
  const farms = useApp((s) => s.farms);
  const farmsReady = useApp((s) => s.farmsReady);
  const farmId = useApp((s) => s.farmId);
  const loadError = useApp((s) => s.loadError);
  const loading = useApp((s) => s.loading);
  const user = useApp((s) => s.user);
  const openFarm = useApp((s) => s.openFarm);
  const loadFarms = useApp((s) => s.loadFarms);
  const signOut = useApp((s) => s.signOut);
  const navigate = useNavigate();

  const open = (id: string) => {
    void openFarm(id);
    navigate('/');
  };

  return (
    <div className="flex flex-col gap-4 desk:gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="big m-0 text-[30px] desk:text-[34px]">Fazendas</h1>
        <p className="k m-0">Você só enxerga as fazendas em que sua conta tem vínculo.</p>
      </div>

      {!farmsReady ? (
        <p className="k m-0" role="status">
          Carregando…
        </p>
      ) : (
        <section className="card flex flex-col gap-3" aria-label="Suas fazendas">
          {loadError && !farms.length ? (
            <div className="flex flex-col items-start gap-3" role="alert">
              <p className="m-0 text-sm">{loadError}</p>
              <button type="button" className="btn" disabled={loading} onClick={() => void loadFarms()}>
                Tentar de novo
              </button>
            </div>
          ) : null}

          {!farms.length && !loadError ? (
            <p className="k m-0 max-w-[62ch]">
              Nenhuma fazenda ainda. A fazenda nasce do arquivo KML ou KMZ com os piquetes desenhados como polígono no Google Earth.
            </p>
          ) : null}

          {farms.length ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {farms.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => open(f.id)}
                    className={`flex min-h-[60px] w-full cursor-pointer items-center justify-between gap-3 rounded-[14px] border bg-bg px-4 py-2.5 text-left text-text ${
                      f.id === farmId ? 'border-lime' : 'border-line2'
                    }`}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-display text-[17px] font-semibold">{f.name}</span>
                      <span className="k text-xs">{[f.municipality, f.id === farmId ? 'aberta agora' : null].filter(Boolean).join(' · ') || 'sem município'}</span>
                    </span>
                    <Icon name="arrow" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <Link to="/fazendas/nova" className="btn btn-pri self-start">
            <Icon name="plus" />
            Abrir fazenda nova
          </Link>
        </section>
      )}

      <section className="card flex flex-wrap items-center justify-between gap-3" aria-label="Conta">
        <span className="flex min-w-0 flex-col">
          <span className="k text-xs">Conta</span>
          <span className="truncate text-sm">{user?.email}</span>
        </span>
        <button type="button" className="btn" onClick={() => void signOut()}>
          Sair
        </button>
      </section>
    </div>
  );
}
