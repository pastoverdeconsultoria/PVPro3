import { useEffect, useState } from 'react';

export type GeoStatus = 'desligado' | 'buscando' | 'ok' | 'negado' | 'indisponivel';

export interface GeoFix {
  status: GeoStatus;
  lat: number | null;
  lon: number | null;
  /** Raio de incerteza informado pelo aparelho, em metros. */
  accuracyM: number | null;
}

const OFF: GeoFix = { status: 'desligado', lat: null, lon: null, accuracyM: null };

/**
 * Posição do aparelho pelo GPS, enquanto `active`. Funciona sem sinal de
 * internet (o GPS não depende dela). A posição fica só no aparelho: não é
 * gravada nem enviada a lugar nenhum.
 */
export function useGeolocation(active: boolean): GeoFix {
  const [fix, setFix] = useState<GeoFix>(OFF);

  useEffect(() => {
    if (!active) {
      setFix(OFF);
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setFix({ ...OFF, status: 'indisponivel' });
      return;
    }
    setFix({ ...OFF, status: 'buscando' });
    // Guarda a referência: ao desligar, o GPS é solto mesmo que o navegador tenha trocado o objeto.
    const geo = navigator.geolocation;
    const id = geo.watchPosition(
      (p) => setFix({ status: 'ok', lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: p.coords.accuracy }),
      (e) => setFix((cur) => (cur.status === 'ok' ? cur : { ...OFF, status: e.code === 1 ? 'negado' : 'indisponivel' })),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => geo.clearWatch(id);
  }, [active]);

  return fix;
}

/** Texto para quando o GPS não deu posição. Null se está tudo bem. */
export function geoProblem(status: GeoStatus): string | null {
  if (status === 'negado') return 'O aparelho não deixou usar a localização. Libere a localização para este site nas configurações do navegador.';
  if (status === 'indisponivel') return 'Não deu para pegar a posição. Confira se o GPS do aparelho está ligado e tente a céu aberto.';
  return null;
}
