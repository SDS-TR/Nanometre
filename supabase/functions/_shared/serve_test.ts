import { listenTarget } from './serve.ts';

Deno.test('sans FUNCTION_PORT, le runtime choisit l’adresse', () => {
  if (listenTarget({}) !== undefined) {
    throw new Error('Deno.serve ne doit pas recevoir d’hôte ni de port');
  }
});

Deno.test('FUNCTION_PORT ne sert qu’au contrôle local', () => {
  const target = listenTarget({ FUNCTION_PORT: '8711' });
  if (!target || target.port !== 8711 || target.hostname !== '127.0.0.1') {
    throw new Error(`cible inattendue ${JSON.stringify(target)}`);
  }
  if (listenTarget({ FUNCTION_PORT: '0' }) !== undefined) {
    throw new Error('un port nul ne doit pas être imposé');
  }
});
