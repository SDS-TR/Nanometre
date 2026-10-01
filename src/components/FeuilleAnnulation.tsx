import { formatCad, cancellationReceipt } from '../domain';
import type { CancelQuote } from '../domain';
import { useTheme } from '../theme';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Text } from './Text';

type Props = {
  visible: boolean;
  quote: CancelQuote | null;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
  gstNumber: string;
  qstNumber: string;
  taxNumbersPlaceholder?: boolean;
};

export function FeuilleAnnulation({ visible, quote, onClose, onConfirm, loading, gstNumber, qstNumber, taxNumbersPlaceholder = true }: Props) {
  const theme = useTheme();
  const withFee = Boolean(quote?.feeApplies);
  const owing = Boolean(quote && quote.feeOwingCents > 0);
  const title = withFee ? 'Annulation tardive' : owing ? 'Montant à la prochaine visite' : 'Annulation gratuite';
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {quote ? (
        <>
          <Text
            variant="body-md"
            color={withFee ? theme.color.warning.onSubtle : theme.color.success.onSubtle}
            style={{
              backgroundColor: withFee ? theme.color.warning.subtle : theme.color.success.subtle,
              borderRadius: theme.radius.md,
              padding: theme.space[3],
              overflow: 'hidden',
            }}
          >
            {withFee
              ? `Moins de 24 h : des frais de ${formatCad(quote.feeCents)} (taxes incluses) sont retenus. Le reste, ${formatCad(quote.refundCents)}, est remboursé.`
              : owing
                ? `Moins de 24 h, payé sur place. Aucun prélèvement maintenant. ${formatCad(quote.feeOwingCents)} seront dus à ta prochaine visite.`
                : quote.within24h
                  ? 'Moins de 24 h, mais ce rendez-vous est payé sur place. Le salon ne retient aucun frais.'
                  : 'Tu es à plus de 24 h du rendez-vous. Aucun frais ne s’applique.'}
          </Text>
          {owing && quote.receipt ? (
            <Text variant="caption" color={theme.color.text.muted}>
              {quote.receipt}
            </Text>
          ) : null}
          {withFee && quote.extraction ? (
            <Text variant="caption" color={theme.color.text.muted}>
              {quote.extraction
                ? cancellationReceipt(quote.extraction, gstNumber, qstNumber, taxNumbersPlaceholder)
                : null}
            </Text>
          ) : null}
          <Button
            label={withFee ? 'Confirmer l’annulation' : 'Annuler le rendez-vous'}
            variant={withFee ? 'destructive' : 'primary'}
            onPress={onConfirm}
            loading={loading}
            fullWidth
          />
          <Button label="Garder le rendez-vous" variant="ghost" onPress={onClose} fullWidth />
        </>
      ) : null}
    </BottomSheet>
  );
}
