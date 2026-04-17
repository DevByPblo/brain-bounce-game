import { useEffect, useState } from "react";
import { getFavoriteCategories } from "@/lib/categoryStats";

/**
 * Reactive list of the user's most-picked categories. Updates when
 * `recordCategoryUse` fires its `category-usage-change` event in the same
 * tab, or when localStorage changes in another tab.
 */
export function useFavoriteCategories(limit = 3): string[] {
  const [favorites, setFavorites] = useState<string[]>(() =>
    getFavoriteCategories(limit)
  );

  useEffect(() => {
    const refresh = () => setFavorites(getFavoriteCategories(limit));
    window.addEventListener("category-usage-change", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("category-usage-change", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [limit]);

  return favorites;
}
