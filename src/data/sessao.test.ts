import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseAuth, LAST_USER_KEY, SESSION_WAIT_MS } from './supabaseRepo';

// Com o token vencido e sem sinal, o Supabase devolve "sem sessão". O app não
// pode tratar isso como saída: abre com quem entrou por último no aparelho.

type Listener = (event: string, session: { user: { id: string; email: string } } | null) => void;

const ANA = { id: 'u-ana', email: 'ana@exemplo.test' };

function fakeClient(getSession: () => Promise<unknown>) {
  const listeners: Listener[] = [];
  const client = {
    auth: {
      getSession,
      onAuthStateChange: (l: Listener) => {
        listeners.push(l);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      signOut: async () => ({ error: null }),
    },
  } as unknown as SupabaseClient;
  return { client, emit: (event: string, session: Parameters<Listener>[1]) => listeners.forEach((l) => l(event, session)) };
}

const session = (expiresInS: number) => ({ user: ANA, expires_at: Math.floor(Date.now() / 1000) + expiresInS });
const refreshFailed = () => Promise.resolve({ data: { session: null }, error: { name: 'AuthRetryableFetchError' } });

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe('sessão sem sinal', () => {
  it('com sessão válida, guarda quem entrou', async () => {
    const auth = createSupabaseAuth(fakeClient(async () => ({ data: { session: session(3000) }, error: null })).client);
    expect(await auth.currentUser()).toEqual(ANA);
    expect(JSON.parse(localStorage.getItem(LAST_USER_KEY)!)).toEqual(ANA);
    expect(await auth.hasSession()).toBe(true);
  });

  it('token vencido e renovação sem rede: abre com quem estava, mas sem sessão para enviar', async () => {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(ANA));
    const auth = createSupabaseAuth(fakeClient(refreshFailed).client);
    expect(await auth.currentUser()).toEqual(ANA);
    expect(await auth.hasSession()).toBe(false);
  });

  it('primeira abertura desta versão sem sinal: usa quem está na sessão vencida do Supabase', async () => {
    localStorage.setItem('sb-abcdefghijklmnopqrst-auth-token', JSON.stringify({ ...session(-7200), refresh_token: 'r' }));
    const auth = createSupabaseAuth(fakeClient(refreshFailed).client);
    expect(await auth.currentUser()).toEqual(ANA);
  });

  it('renovação pendurada (sinal fraco): não espera mais que o limite', async () => {
    vi.useFakeTimers();
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(ANA));
    const auth = createSupabaseAuth(fakeClient(() => new Promise(() => undefined)).client);
    const user = auth.currentUser();
    await vi.advanceTimersByTimeAsync(SESSION_WAIT_MS);
    expect(await user).toEqual(ANA);
  });

  it('ninguém entrou neste aparelho: vai para a tela de entrar', async () => {
    const auth = createSupabaseAuth(fakeClient(refreshFailed).client);
    expect(await auth.currentUser()).toBeNull();
  });

  it('sessão vazia sem erro (saiu em outra aba): esquece quem entrou', async () => {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(ANA));
    const auth = createSupabaseAuth(fakeClient(async () => ({ data: { session: null }, error: null })).client);
    expect(await auth.currentUser()).toBeNull();
    expect(localStorage.getItem(LAST_USER_KEY)).toBeNull();
  });

  it('aviso de sessão vazia por falta de rede é ignorado; SIGNED_OUT tira da conta', () => {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(ANA));
    const fake = fakeClient(refreshFailed);
    const seen: unknown[] = [];
    createSupabaseAuth(fake.client).onChange((u) => seen.push(u));
    fake.emit('INITIAL_SESSION', null);
    expect(seen).toEqual([]);
    fake.emit('TOKEN_REFRESHED', { user: ANA });
    expect(seen).toEqual([ANA]);
    fake.emit('SIGNED_OUT', null);
    expect(seen).toEqual([ANA, null]);
    expect(localStorage.getItem(LAST_USER_KEY)).toBeNull();
  });

  it('sair apaga a identidade guardada', async () => {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(ANA));
    await createSupabaseAuth(fakeClient(refreshFailed).client).signOut();
    expect(localStorage.getItem(LAST_USER_KEY)).toBeNull();
  });
});
