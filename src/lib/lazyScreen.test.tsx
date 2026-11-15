import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LAZY_TIMEOUT_MS, lazyScreen } from './lazyScreen';

const Tela = () => <p>tela carregada</p>;

describe('lazyScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('oferece tentar de novo depois de 8 s pendurado e carrega na segunda tentativa', async () => {
    let calls = 0;
    const loader = vi.fn(() => {
      calls += 1;
      // Primeira tentativa pendura para sempre, como um download sem sinal.
      return calls === 1 ? new Promise<never>(() => {}) : Promise.resolve({ default: Tela });
    });
    const Screen = lazyScreen(loader);
    render(<Screen />);

    expect(screen.getByRole('status').textContent).toBe('Carregando…');
    await act(async () => {
      vi.advanceTimersByTime(LAZY_TIMEOUT_MS - 1);
    });
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    const retry = screen.getByRole('button', { name: 'Tentar de novo' });

    await act(async () => {
      fireEvent.click(retry);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(screen.getByText('tela carregada')).toBeTruthy();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('quando o download falha, mostra o erro com tentar de novo', async () => {
    // O erro é esperado: cala o log do React e o aviso de erro não tratado do jsdom.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const quiet = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', quiet);
    onTestFinished(() => window.removeEventListener('error', quiet));
    let calls = 0;
    const Screen = lazyScreen(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('Failed to fetch')) : Promise.resolve({ default: Tela });
    });
    render(<Screen />);

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(screen.getByRole('alert').textContent).toContain('Não deu para carregar esta tela.');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(screen.getByText('tela carregada')).toBeTruthy();
  });
});
