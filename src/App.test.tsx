import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';

function open(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('casca do app', () => {
  it('mostra as cinco áreas na navegação', () => {
    open('/');
    const nav = screen.getByRole('navigation', { name: 'Áreas do sistema' });
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent);
    expect(labels).toEqual(['Painel', 'Mapa', 'Rebanho', 'Clima', 'Análise']);
  });

  it('marca a área atual e troca de tela ao tocar', () => {
    open('/');
    expect(screen.getByRole('link', { name: 'Painel' }).getAttribute('aria-current')).toBe('page');

    fireEvent.click(screen.getByRole('link', { name: 'Rebanho' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Rebanho' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Rebanho' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Painel' }).getAttribute('aria-current')).toBeNull();
  });

  it('o painel sem fazenda não inventa número', () => {
    open('/');
    const hero = screen.getByRole('region', { name: 'Lotação global da fazenda' });
    expect(hero.textContent).toContain('—');
    expect(hero.textContent).not.toMatch(/\d/);
  });

  it('endereço desconhecido volta para o painel', () => {
    open('/nao-existe');
    expect(screen.getByRole('link', { name: 'Painel' }).getAttribute('aria-current')).toBe('page');
  });

  it('avisa quando o aparelho fica sem sinal', () => {
    open('/');
    expect(screen.getByRole('status').textContent).toBe('Online');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    fireEvent(window, new Event('offline'));
    expect(screen.getByRole('status').textContent).toBe('Sem sinal');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    fireEvent(window, new Event('online'));
    expect(screen.getByRole('status').textContent).toBe('Online');
  });
});
