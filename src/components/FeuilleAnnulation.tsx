import { formatCad } from '../domain';
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
};

export function FeuilleAnnulation({ visible, quote, onClose, onConfirm, loading, gstNumber, qstNumber }: Props) {
  const theme = useTheme();
  const withFee = Boolean(quote?.feeApplies);
  return (
    <BottomSheet visible={visible} onClose={onClose} title={withFee ? 'Annulation tardive' : 'Annulation gratuite'}>
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
              : 'Tu es à plus de 24 h du rendez-vous. Aucun frais ne s’applique.'}
          </Text>
          {withFee && quote.extraction ? (
            <Text variant="caption" color={theme.color.text.muted}>
              {`Frais d'annulation tardive ${formatCad(quote.feeCents)} (TPS ${formatCad(quote.extraction.gstCents)}, TVQ ${formatCad(quote.extraction.qstCents)} incluses). TPS ${gstNumber}. TVQ ${qstNumber}.`}
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
