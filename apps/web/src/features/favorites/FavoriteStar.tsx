// The favourite star (CROSS-DOMAIN B.18 `FavoriteStar`): records (record header), views, notes and templates. Outline
// while not a favourite ("Add to favorites"), filled yellow when it is ("Remove from favorites"); toggles optimistically.
import type { FavoriteType } from '@agentic-crm/contracts';
import { IconButton, type IconButtonProps } from '@agentic-crm/ui';
import { useFavoriteToggle } from './data';
import * as s from './favorites.css';

export interface FavoriteStarProps {
  favoriteType: FavoriteType;
  targetId: string;
  /** Records: their object (id or api slug). */
  entityDefinitionId?: string;
  size?: IconButtonProps['size'];
  /** Keep the star visible (else callers may show it on hover only while not a favourite). */
  className?: string;
}

export function FavoriteStar({ favoriteType, targetId, entityDefinitionId, size = 28, className }: FavoriteStarProps) {
  const { isFavorite, toggle } = useFavoriteToggle({ favoriteType, targetId, entityDefinitionId });
  const label = isFavorite ? 'Remove from favorites' : 'Add to favorites';
  return (
    <IconButton
      icon="favorite"
      aria-label={label}
      aria-pressed={isFavorite}
      tooltip={label}
      size={size}
      className={`${isFavorite ? s.starOn : s.starOff} ${className ?? ''}`}
      data-favorite={isFavorite || undefined}
      data-testid="favorite-star"
      onPress={toggle}
    />
  );
}
