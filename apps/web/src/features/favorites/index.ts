// Favorites (BACKLOG 3.17; CROSS-DOMAIN B.18): the star for records, views, notes and templates, and the sidebar
// section with folders and drag and drop.
export { addFavorite, removeFavoriteByTarget, useFavorites, useFavoriteToggle } from './data';
export { FavoriteStar, type FavoriteStarProps } from './FavoriteStar';
export { FavoritesSection, useOpenFavorite } from './FavoritesSection';
