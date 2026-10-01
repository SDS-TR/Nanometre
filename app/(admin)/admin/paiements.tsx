import { useState } from 'react';
import { View } from 'react-native';
import { BottomSheet } from '../../../src/components/BottomSheet';
import { Button } from '../../../src/components/Button';
import { Header } from '../../../src/components/Header';
import { LignePaiement } from '../../../src/components/LignePaiement';
import { Screen } from '../../../src/components/Screen';
import { SelecteurDate } from '../../../src/components/SelecteurDate';
import { StatCard } from '../../../src/components/StatCard';
import { LoadingBlock, StateMessage } from '../../../src/components/StateView';
import { Text } from '../../../src/components/Text';
import type { PaymentLine } from '../../../src/data/types';
import { extractIncludedTaxes, formatCad, periodBounds, zonedParts } from '../../../src/domain';
import { useAsync } from '../../../src/hooks/useAsync';
import { useAppState } from '../../../src/providers/AppState';
import { useTheme } from '../../../src/theme';

export default function PaiementsScreen() {
  const theme = useTheme();
  const { user, repo } = useAppState();
  const [anchor, setAnchor] = useState('2026-10-03');
  const [selected, setSelected] = useState<PaymentLine | null>(null);
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const range = periodBounds(anchor, 'mois');
  const payments = useAsync((repository) => repository.listPayments(range), [range.from, range.to, user?.id]);
  const denied = user?.role !== 'proprietaire';
  const rows = payments.data ?? [];
  const total = rows.reduce((sum, line) => sum + line.amountCents, 0);
  const fees = rows.reduce((sum, line) => sum + line.feeCents, 0);
  const refunded = rows.reduce((sum, line) => sum + line.refundedCents, 0);

  async function refund() {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await repo.refundFee(selected.bookingId);
      setConfirmRefund(false);
      setSelected(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Remboursement impossible.');
    } finally {
      setBusy(false);
    }
  }

  if (denied) {
    return (
      <Screen>
        <Header title="Paiements" />
        <StateMessage title="Accès refusé" body="Les montants et les remboursements sont réservés au propriétaire." />
      </Screen>
    );
  }

  const extraction = selected && selected.feeCents > 0 ? extractIncludedTaxes(selected.feeCents) : null;

  return (
    <Screen>
      <Header title="Paiements" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <SelecteurDate date={anchor} onChange={setAnchor} onToday={() => setAnchor(zonedParts(new Date()).isoDate)} />
        <Text variant="caption" color={theme.color.text.muted}>
          {`Mois du ${range.from} au ${range.to}. Les totaux suivent les rendez-vous chargés.`}
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
          <StatCard label="Encaissé" value={formatCad(total)} />
          <StatCard label="Frais retenus" value={formatCad(fees)} />
          <StatCard label="Remboursé" value={formatCad(refunded)} />
        </View>
        {payments.status === 'loading' && !payments.data ? <LoadingBlock /> : null}
        {payments.status === 'error' ? (
          <StateMessage title={payments.error === 'Accès refusé' ? 'Accès refusé' : 'Paiements indisponibles'} body={payments.error ?? ''} />
        ) : null}
        {rows.map((line) => (
          <LignePaiement key={line.bookingId} line={line} onPress={() => setSelected(line)} />
        ))}
        {payments.status === 'ready' && rows.length === 0 ? (
          <Text variant="body-sm" color={theme.color.text.muted}>
            Aucun paiement sur cette période.
          </Text>
        ) : null}
      </View>
      <BottomSheet visible={selected != null && !confirmRefund} onClose={() => setSelected(null)} title="Détail">
        {selected ? (
          <>
            <Text variant="heading-sm">{selected.clientName}</Text>
            <Text variant="body-md" color={theme.color.text.secondary}>
              {selected.label}
            </Text>
            <Text variant="body-sm">{`Montant ${formatCad(selected.amountCents)} · ${selected.method === 'en_ligne' ? 'En ligne' : 'Sur place'}`}</Text>
            <Text variant="body-sm">{`Frais ${formatCad(selected.feeCents)} · Remboursé ${formatCad(selected.refundedCents)}`}</Text>
            {extraction ? (
              <Text variant="caption" color={theme.color.text.muted}>
                {`Frais HT ${formatCad(extraction.netCents)} · TPS ${formatCad(extraction.gstCents)} · TVQ ${formatCad(extraction.qstCents)}`}
              </Text>
            ) : null}
            {selected.feeCents > 0 ? (
              <Button label="Rembourser les frais" variant="destructive" onPress={() => setConfirmRefund(true)} />
            ) : null}
          </>
        ) : null}
      </BottomSheet>
      <BottomSheet visible={confirmRefund} onClose={() => setConfirmRefund(false)} title="Rembourser les frais">
        <Text variant="body-md">
          {selected
            ? `Rembourser ${formatCad(selected.feeCents)} à ${selected.clientName} ? Le frais revient à zéro et le paiement passe à Remboursé. L’action est journalisée.`
            : ''}
        </Text>
        {error ? <Text variant="body-sm" color={theme.color.error.default}>{error}</Text> : null}
        <Button label="Confirmer le remboursement" variant="destructive" loading={busy} onPress={() => void refund()} />
        <Button label="Annuler" variant="ghost" onPress={() => setConfirmRefund(false)} />
      </BottomSheet>
    </Screen>
  );
}
