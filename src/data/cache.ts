import type { Farm, FarmData } from './types';

// Cópia do que foi lido por último, guardada no aparelho. Serve para abrir o app
// sem sinal e ver a situação como estava. Fica separada por usuário. Se o
// aparelho não deixar gravar (sem espaço, modo privado), o app segue sem cópia.

const PREFIX = 'pvpro3';

const key = (userId: string, name: string) => `${PREFIX}:${userId}:${name}`;

function read<T>(k: string): T | null {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(k: string, value: unknown): void {
  try {
    localStorage.setItem(k, JSON.stringify(value));
  } catch {
    // Sem espaço: melhor ficar sem a cópia do que travar a tela.
    try {
      localStorage.removeItem(k);
    } catch {
      /* nada a fazer */
    }
  }
}

export interface Snapshot<T> {
  savedAt: string;
  value: T;
}

export const cache = {
  saveFarms(userId: string, farms: Farm[]) {
    write(key(userId, 'farms'), { savedAt: new Date().toISOString(), value: farms });
  },
  loadFarms(userId: string): Snapshot<Farm[]> | null {
    return read(key(userId, 'farms'));
  },
  saveFarm(userId: string, data: FarmData) {
    write(key(userId, `farm:${data.farm.id}`), { savedAt: new Date().toISOString(), value: data });
  },
  loadFarm(userId: string, farmId: string): Snapshot<FarmData> | null {
    return read(key(userId, `farm:${farmId}`));
  },
  saveLastFarm(userId: string, farmId: string | null) {
    if (farmId) write(key(userId, 'last'), farmId);
    else {
      try {
        localStorage.removeItem(key(userId, 'last'));
      } catch {
        /* nada a fazer */
      }
    }
  },
  loadLastFarm(userId: string): string | null {
    return read(key(userId, 'last'));
  },
  /** Ao sair da conta, a cópia desse usuário é apagada do aparelho. */
  clear(userId: string) {
    try {
      const mine = `${PREFIX}:${userId}:`;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith(mine)) localStorage.removeItem(k);
      }
    } catch {
      /* nada a fazer */
    }
  },
};
