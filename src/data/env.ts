/**
 * Deixa o endereço do projeto no formato que o cliente do Supabase espera:
 * só `https://xxxx.supabase.co`. O painel do Supabase mostra o "API URL" com
 * `/rest/v1/` no fim, e é fácil colar assim; o sufixo e a barra final são tirados.
 */
export function normalizeSupabaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(rest|auth)\/v1$/i, '')
    .replace(/\/+$/, '');
}

/**
 * Endereço e chave pública do projeto Supabase, vindos das variáveis de ambiente
 * do build. A chave "anon" (ou "publishable") é feita para ficar dentro do app:
 * quem protege os dados são as regras de acesso do banco. A chave secreta
 * (service_role) nunca entra aqui.
 */
export function supabaseConfig(): { url: string; key: string } | null {
  const url = normalizeSupabaseUrl((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '');
  const key = (
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)
  )?.trim();
  return url && key ? { url, key } : null;
}
