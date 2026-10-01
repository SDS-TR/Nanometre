import { useState } from 'react';
import { View } from 'react-native';
import { formatCad, formatLongDate } from '../domain';
import type { ClientFile } from '../data/types';
import { useAsync } from '../hooks/useAsync';
import { useAppState } from '../providers/AppState';
import { useTheme } from '../theme';
import { Button } from './Button';
import { Input } from './Input';
import { LoadingBlock, StateMessage } from './StateView';
import { Text } from './Text';

export function PanneauClients() {
  const theme = useTheme();
  const { user, repo } = useAppState();
  const clients = useAsync((repository) => repository.listClients(), [user?.id]);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const owner = user?.role === 'proprietaire';

  async function save(client: ClientFile) {
    setError(null);
    try {
      await repo.saveClientNote(client.id, note);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Note impossible.');
    }
  }

  if (clients.status === 'loading' && !clients.data) {
    return <LoadingBlock />;
  }
  if (clients.status === 'error') {
    return <StateMessage title={clients.error === 'Accès refusé' ? 'Accès refusé' : 'Clients indisponibles'} body={clients.error ?? ''} />;
  }
  return (
    <View style={{ gap: theme.space[3] }}>
      {!owner ? (
        <Text variant="body-sm" color={theme.color.text.secondary}>
          Les clients qui ont un rendez-vous avec toi. Pas de montants, pas de points.
        </Text>
      ) : null}
      {clients.data?.map((client) => {
        const expanded = open === client.id;
        return (
          <View key={client.id} style={{ backgroundColor: theme.color.bg.elevated, borderRadius: theme.radius.lg, padding: theme.space[4], gap: theme.space[2], borderWidth: 1, borderColor: theme.color.border.default }}>
            <Text variant="heading-sm">{client.name}</Text>
            <Button
              label={expanded ? 'Fermer' : 'Voir le dossier'}
              size="sm"
              variant="ghost"
              onPress={() => {
                setOpen(expanded ? null : client.id);
                setNote(client.note);
              }}
            />
            <Text variant="body-sm" color={theme.color.text.secondary}>
              {`${client.visits} visites honorées`}
              {client.points != null ? ` · ${client.points} points · ${client.stamps ?? 0} tampons` : ''}
              {client.spentHtCents != null ? ` · ${formatCad(client.spentHtCents)} HT` : ''}
            </Text>
            {expanded ? (
              <>
                <Input label="Note" value={note} onChangeText={setNote} placeholder="Préférence, nuque, ponctualité…" />
                {error ? <Text variant="body-sm" color={theme.color.error.default}>{error}</Text> : null}
                <Button label="Enregistrer la note" size="sm" onPress={() => void save(client)} />
                {client.history.slice(0, 6).map((row) => (
                  <Text key={`${row.date}-${row.serviceName}`} variant="body-sm" color={theme.color.text.secondary}>
                    {`${formatLongDate(row.date)} · ${row.serviceName} · ${row.barberName}${row.priceLabel ? ` · ${row.priceLabel}` : ''}`}
                  </Text>
                ))}
              </>
            ) : null}
          </View>
        );
      })}
      {clients.data?.length === 0 ? <Text variant="body-sm" color={theme.color.text.muted}>Aucun client pour l’instant.</Text> : null}
    </View>
  );
}
