import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '../../../../src/components/Button';
import { Header } from '../../../../src/components/Header';
import { Input } from '../../../../src/components/Input';
import { Screen } from '../../../../src/components/Screen';
import { SegmentedControl } from '../../../../src/components/SegmentedControl';
import { LoadingBlock, StateMessage } from '../../../../src/components/StateView';
import { Text } from '../../../../src/components/Text';
import { assertPromoDraft, formatCad, friendlyError } from '../../../../src/domain';
import { useToast } from '../../../../src/components/Toast';
import { useAsync } from '../../../../src/hooks/useAsync';
import { useAppState } from '../../../../src/providers/AppState';
import { useTheme } from '../../../../src/theme';

export default function PromosScreen() {
  const theme = useTheme();
  const { user, repo } = useAppState();
  const promos = useAsync((repository) => repository.listPromos(), [user?.id]);
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('10');
  const [startsOn, setStartsOn] = useState('2026-10-01');
  const [endsOn, setEndsOn] = useState('2026-12-31');
  const [limit, setLimit] = useState('');
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  if (user?.role !== 'proprietaire') {
    return (
      <Screen>
        <Header back title="Codes promo" />
        <StateMessage title="Accès refusé" body="Les codes promo sont réservés au propriétaire." />
      </Screen>
    );
  }
  return (
    <Screen>
      <Header back title="Codes promo" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        {promos.status === 'loading' && !promos.data ? <LoadingBlock /> : null}
        {promos.data?.map((promo) => (
          <View key={promo.code} style={{ gap: 2 }}>
            <Text variant="label-md">{promo.code}</Text>
            <Text variant="body-sm" color={theme.color.text.secondary}>
              {promo.discountType === 'percent' ? `${promo.value} %` : formatCad(promo.value)}
              {` · ${promo.startsOn} → ${promo.endsOn} · ${promo.usageCount}${promo.usageLimit != null ? ` / ${promo.usageLimit}` : ''}${promo.active ? '' : ' · inactif'}`}
            </Text>
          </View>
        ))}
        <Text variant="heading-sm">Nouveau code</Text>
        <Input label="Code" value={code} onChangeText={setCode} autoCapitalize="none" placeholder="BIENVENUE10" />
        <SegmentedControl
          value={kind}
          onChange={setKind}
          options={[
            { value: 'percent', label: 'Pourcentage' },
            { value: 'amount', label: 'Montant' },
          ]}
        />
        <Input label={kind === 'percent' ? 'Pourcentage' : 'Montant en dollars'} value={value} onChangeText={setValue} />
        <Input label="Début" value={startsOn} onChangeText={setStartsOn} autoCapitalize="none" />
        <Input label="Fin" value={endsOn} onChangeText={setEndsOn} autoCapitalize="none" placeholder="2026-12-31" />
        <Input label="Limite d’utilisations" value={limit} onChangeText={setLimit} keyboardType="number-pad" placeholder="100" />
        <Button label={active ? 'Code actif' : 'Code inactif'} variant="secondary" onPress={() => setActive((current) => !current)} />
        {error ? <Text variant="body-sm" color={theme.color.error.default}>{error}</Text> : null}
        <Button
          label="Enregistrer le code"
          onPress={() => {
            const numeric = Number(value.replace(',', '.'));
            const usageLimit = limit.trim() === '' ? null : Number(limit);
            const draft = {
              code: code.trim().toUpperCase(),
              discountType: kind,
              value: kind === 'amount' ? Math.round(numeric * 100) : Math.round(numeric),
              startsOn,
              endsOn,
              usageLimit,
              usageCount: 0,
              active,
            };
            try {
              assertPromoDraft(draft);
            } catch (reason) {
              setError(friendlyError(reason, 'Code refusé.'));
              return;
            }
            const exists = promos.data?.some((promo) => promo.code === draft.code) ?? false;
            setError(null);
            void repo.savePromo(draft).then(
              () => {
                toast({ message: exists ? 'Code mis à jour. Le compteur est inchangé.' : 'Code enregistré.', tone: 'success' });
                setCode('');
              },
              (reason: unknown) => setError(friendlyError(reason, 'Code refusé.')),
            );
          }}
        />
      </View>
    </Screen>
  );
}
