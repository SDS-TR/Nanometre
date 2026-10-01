/** Options d’écoute. Absent : le runtime Supabase choisit l’adresse. */
export function listenTarget(env: { FUNCTION_PORT?: string }): { port: number; hostname: string } | undefined {
  if (!env.FUNCTION_PORT) {
    return undefined;
  }
  const port = Number(env.FUNCTION_PORT);
  if (!Number.isInteger(port) || port <= 0) {
    return undefined;
  }
  return { port, hostname: '127.0.0.1' };
}

/** FUNCTION_PORT sert au contrôle local. Sinon Deno.serve sans adresse, comme `supabase functions serve`. */
export function serve(handler: (req: Request) => Response | Promise<Response>): void {
  const target = listenTarget({ FUNCTION_PORT: Deno.env.get('FUNCTION_PORT') ?? undefined });
  if (target) {
    Deno.serve(target, handler);
    return;
  }
  Deno.serve(handler);
}
