import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { formatCad, formatLongDate } from '../domain';
import type { ClientFile } from '../data/types';
import { useAsync } from '../hooks/useAsync';
import { useAppState } from '../providers/AppState';
import { useTheme } from '../theme';
import { useToast } from './Toast';
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
  const [query, setQuery] = useState('');
  const toast = useToast();
  const owner = user?.role === 'proprietaire';

  async function save(client: ClientFile) {
    setError(null);
    try {
      await repo.saveClientNote(client.id, note);
      toast({ message: 'Note enregistrée.', tone: 'success' });
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
    <View style={{ flex: 1, gap: theme.space[3] }}>
      {!owner ? (
        <Text variant="body-sm" color={theme.color.text.secondary}>
          Les clients qui ont un rendez-vous avec toi. Pas de montants, pas de points.
        </Text>
      ) : null}
      <Input label="Rechercher un client" value={query} onChangeText={setQuery} autoCapitalize="none" placeholder="Nom" />
      <FlatList
        data={(clients.data ?? []).filter((client) => client.name.toLowerCase().includes(query.trim().toLowerCase()))}
        keyExtractor={(client) => client.id}
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: theme.space[3] }}
        ListEmptyComponent={<Text variant="body-sm" color={theme.color.text.muted}>Aucun client pour l’instant.</Text>}
        renderItem={({ item: client }) => {
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
              {`${client.visits} ${client.visits > 1 ? 'visites honorées' : 'visite honorée'}`}
              {client.points != null ? ` · ${client.points} points · ${client.stamps ?? 0} tampons` : ''}
              {client.spentHtCents != null ? ` · ${formatCad(client.spentHtCents)} HT` : ''}
            </Text>
            {expanded ? (
              <>
                <Input label="Note" value={note} onChangeText={setNote} placeholder="Préférence, nuque, ponctualité…" />
                {error ? <Text variant="body-sm" color={theme.color.error.default}>{error}</Text> : null}
                <Button label="Enregistrer la note" size="sm" onPress={() => void save(client)} />
                {client.history.slice(0, 6).map((row) => (
                  <Text key={row.id ?? `${row.date}-${row.serviceName}-${row.barberName}`} variant="body-sm" color={theme.color.text.secondary}>
                    {`${formatLongDate(row.date)} · ${row.status === 'honore' ? 'Honoré' : row.status === 'confirme' ? 'À venir' : row.status} · ${row.serviceName} · ${row.barberName}${row.priceLabel ? ` · ${row.priceLabel}` : ''}`}
                  </Text>
                ))}
              </>
            ) : null}
          </View>
        );
      }}
      />
    </View>
  );
}
