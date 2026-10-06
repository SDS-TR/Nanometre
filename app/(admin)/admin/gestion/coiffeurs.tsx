import { View } from 'react-native';
import { Chip } from '../../../../src/components/Chip';
import { useToast } from '../../../../src/components/Toast';
import { Header } from '../../../../src/components/Header';
import { Screen } from '../../../../src/components/Screen';
import { LoadingBlock, StateMessage } from '../../../../src/components/StateView';
import { Text } from '../../../../src/components/Text';
import { useAsync } from '../../../../src/hooks/useAsync';
import { useAppState } from '../../../../src/providers/AppState';
import { useTheme } from '../../../../src/theme';

const DAYS = [
  { weekday: 2, label: 'Mar' },
  { weekday: 3, label: 'Mer' },
  { weekday: 4, label: 'Jeu' },
  { weekday: 5, label: 'Ven' },
  { weekday: 6, label: 'Sam' },
];

export default function CoiffeursScreen() {
  const theme = useTheme();
  const { user, repo } = useAppState();
  const toast = useToast();
  const barbers = useAsync((repository) => repository.getBarbers(), []);
  const services = useAsync((repository) => repository.getServices(), []);
  const setup = useAsync((repository) => repository.getBarberSetup(), [user?.id]);
  if (user?.role !== 'proprietaire') {
    return (
      <Screen>
        <Header back title="Coiffeurs" />
        <StateMessage title="Accès refusé" body="Seul le propriétaire règle les chaises." />
      </Screen>
    );
  }
  return (
    <Screen>
      <Header back title="Coiffeurs" />
      <View style={{ padding: theme.space[4], gap: theme.space[5] }}>
        {setup.status === 'loading' && !setup.data ? <LoadingBlock /> : null}
        {setup.status === 'error' ? <StateMessage title="Accès refusé" body={setup.error ?? ''} /> : null}
        {barbers.data?.map((barber) => {
          const row = setup.data?.find((item) => item.barberId === barber.id);
          const days = new Set(row?.weekdays ?? [2, 3, 4, 5, 6]);
          const offered = new Set(row?.serviceIds ?? services.data?.map((service) => service.id) ?? []);
          return (
            <View key={barber.id} style={{ gap: theme.space[2] }}>
              <Text variant="heading-sm">{barber.fullName}</Text>
              <Text variant="caption" color={theme.color.text.muted}>
                Jours ouverts
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                {DAYS.map((day) => (
                  <Chip
                    key={day.weekday}
                    label={day.label}
                    selected={days.has(day.weekday)}
                    onPress={() => void repo.setBarberWeekday({ barberId: barber.id, weekday: day.weekday, open: !days.has(day.weekday) })}
                  />
                ))}
              </View>
              <Text variant="caption" color={theme.color.text.muted}>
                Prestations
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                {services.data?.map((service) => (
                  <Chip
                    key={service.id}
                    label={service.name}
                    selected={offered.has(service.id)}
                    onPress={() =>
                      void repo
                        .setBarberService({ barberId: barber.id, serviceId: service.id, eligible: !offered.has(service.id) })
                        .then(() => toast({ message: offered.has(service.id) ? `${service.name} retiré.` : `${service.name} ajouté.`, tone: 'success' }))
                    }
                  />
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}
