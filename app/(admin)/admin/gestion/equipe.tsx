import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '../../../../src/components/Button';
import { Chip } from '../../../../src/components/Chip';
import { Header } from '../../../../src/components/Header';
import { Input } from '../../../../src/components/Input';
import { Screen } from '../../../../src/components/Screen';
import { SegmentedControl } from '../../../../src/components/SegmentedControl';
import { LoadingBlock, StateMessage } from '../../../../src/components/StateView';
import { Text } from '../../../../src/components/Text';
import type { Role } from '../../../../src/data/types';
import { useAsync } from '../../../../src/hooks/useAsync';
import { useAppState } from '../../../../src/providers/AppState';
import { useTheme } from '../../../../src/theme';

export default function EquipeScreen() {
  const theme = useTheme();
  const { user, repo } = useAppState();
  const team = useAsync((repository) => repository.listTeam(), [user?.id]);
  const audit = useAsync((repository) => repository.listAudit(), [user?.id]);
  const barbers = useAsync((repository) => repository.getBarbers(), []);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('coiffeur');
  const [barberId, setBarberId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (user?.role !== 'proprietaire') {
    return (
      <Screen>
        <Header back title="Équipe" />
        <StateMessage title="Accès refusé" body="Seul le propriétaire gère les rôles." />
      </Screen>
    );
  }
  return (
    <Screen>
      <Header back title="Équipe" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Text variant="body-sm" color={theme.color.text.secondary}>
          Il doit rester au moins un propriétaire actif. Chaque changement de rôle, désactivation ou remboursement est journalisé.
        </Text>
        {team.status === 'loading' && !team.data ? <LoadingBlock /> : null}
        {error ? <Text variant="body-sm" color={theme.color.error.default}>{error}</Text> : null}
        {team.data?.map((member) => (
          <View key={member.id} style={{ gap: theme.space[2], paddingBottom: theme.space[3], borderBottomWidth: 1, borderBottomColor: theme.color.border.default }}>
            <Text variant="label-md">{member.fullName}</Text>
            <Text variant="body-sm" color={theme.color.text.secondary}>
              {`${member.email} · ${member.active ? 'Actif' : 'Désactivé'}`}
            </Text>
            <SegmentedControl<Role>
              value={member.role}
              onChange={(next) => {
                setError(null);
                void repo.setMemberRole(member.id, next).catch((reason: unknown) => {
                  setError(reason instanceof Error ? reason.message : 'Rôle refusé.');
                });
              }}
              options={[
                { value: 'proprietaire', label: 'Propriétaire' },
                { value: 'coiffeur', label: 'Coiffeur' },
              ]}
            />
            <Button
              label={member.active ? 'Désactiver' : 'Réactiver'}
              variant="secondary"
              size="sm"
              onPress={() => {
                setError(null);
                void repo.setMemberActive(member.id, !member.active).catch((reason: unknown) => {
                  setError(reason instanceof Error ? reason.message : 'Action refusée.');
                });
              }}
            />
          </View>
        ))}
        <Text variant="heading-sm">Inviter</Text>
        <Input label="Nom" value={name} onChangeText={setName} />
        <Input label="Courriel" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <SegmentedControl<Role>
          value={role}
          onChange={setRole}
          options={[
            { value: 'coiffeur', label: 'Coiffeur' },
            { value: 'proprietaire', label: 'Propriétaire' },
          ]}
        />
        {role === 'coiffeur' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {barbers.data?.map((barber) => (
              <Chip key={barber.id} label={barber.shortName} selected={barberId === barber.id} onPress={() => setBarberId(barber.id)} />
            ))}
          </View>
        ) : null}
        {message ? <Text variant="body-sm">{message}</Text> : null}
        <Button
          label="Envoyer l’invitation"
          onPress={() => {
            if (role === 'coiffeur' && !barberId) {
              setError('Choisis la chaise de ce coiffeur.');
              return;
            }
            setError(null);
            void repo
              .inviteMember({ fullName: name, email, role, barberId: role === 'coiffeur' ? barberId : null })
              .then(() => setMessage(repo.mode === 'local' ? 'Compte ajouté à l’équipe.' : 'Invitation envoyée. La personne reçoit un courriel pour ouvrir son compte.'))
              .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Invitation impossible.'));
          }}
        />
        <Text variant="heading-sm">Journal</Text>
        {audit.data?.slice(0, 12).map((entry) => (
          <Text key={entry.id} variant="body-sm" color={theme.color.text.secondary}>
            {`${entry.action} · ${entry.detail}`}
          </Text>
        ))}
        {audit.data?.length === 0 ? <Text variant="body-sm" color={theme.color.text.muted}>Aucune action pour l’instant.</Text> : null}
      </View>
    </Screen>
  );
}
