/** Écoute FUNCTION_PORT pour que le contrôle de démarrage puisse viser un port libre. */
export function serve(handler: (req: Request) => Response | Promise<Response>): void {
  const port = Number(Deno.env.get('FUNCTION_PORT') ?? '8000');
  Deno.serve({ port, hostname: '127.0.0.1' }, handler);
}
