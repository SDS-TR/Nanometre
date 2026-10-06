import { useState } from 'react';
import { View } from 'react-native';
import { useAsync } from '../hooks/useAsync';
import { useAppState } from '../providers/AppState';
import { useTheme } from '../theme';
import { Button } from './Button';
import { CarteAvis } from './CarteAvis';
import { LoadingBlock, StateMessage } from './StateView';
import { Text } from './Text';

export function PanneauAvis({ moderate }: { moderate: boolean }) {
  const theme = useTheme();
  const { user, repo } = useAppState();
  const reviews = useAsync((repository) => repository.listStaffReviews(), [user?.id]);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(id: string, status: 'publie' | 'masque' | 'en_attente') {
    setError(null);
    try {
      await repo.moderateReview(id, status);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Modération impossible.');
    }
  }

  if (reviews.status === 'loading' && !reviews.data) {
    return <LoadingBlock />;
  }
  if (reviews.status === 'error') {
    return <StateMessage title={reviews.error === 'Accès refusé' ? 'Accès refusé' : 'Avis indisponibles'} body={reviews.error ?? ''} />;
  }
  return (
    <View style={{ gap: theme.space[3] }}>
      {!moderate ? (
        <Text variant="body-sm" color={theme.color.text.secondary}>
          Tes avis publiés, en lecture seule.
        </Text>
      ) : null}
      {error ? <Text variant="body-sm" color={theme.color.error.default}>{error}</Text> : null}
      {reviews.data?.map((review) => (
        <CarteAvis key={review.id} review={review}>
          {moderate ? (
            <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
              {review.status !== 'publie' ? <Button label="Publier" size="sm" onPress={() => void setStatus(review.id, 'publie')} /> : null}
              {review.status !== 'masque' ? <Button label="Masquer" size="sm" variant="secondary" onPress={() => void setStatus(review.id, 'masque')} /> : null}
            </View>
          ) : null}
        </CarteAvis>
      ))}
      {reviews.data?.length === 0 ? <Text variant="body-sm" color={theme.color.text.muted}>Aucun avis.</Text> : null}
    </View>
  );
}
