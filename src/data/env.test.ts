// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeSupabaseUrl } from './env';

describe('endereço do Supabase', () => {
  const base = 'https://abcdefgh.supabase.co';

  it('aceita o endereço como o painel mostra, com /rest/v1/ no fim', () => {
    expect(normalizeSupabaseUrl(`${base}/rest/v1/`)).toBe(base);
    expect(normalizeSupabaseUrl(`${base}/rest/v1`)).toBe(base);
    expect(normalizeSupabaseUrl(`${base}/auth/v1/`)).toBe(base);
  });

  it('tira espaço e barra sobrando, e não mexe no endereço já certo', () => {
    expect(normalizeSupabaseUrl(`  ${base}/ `)).toBe(base);
    expect(normalizeSupabaseUrl(base)).toBe(base);
  });

  it('vazio continua vazio', () => {
    expect(normalizeSupabaseUrl('')).toBe('');
    expect(normalizeSupabaseUrl('   ')).toBe('');
  });
});
