// Wikipedia API helpers (CORS-enabled, no key required).

const API = "https://en.wikipedia.org/w/api.php";

export type WikiSummary = {
  title: string;
  extract: string;
  thumbnail?: string;
};

export type Difficulty = "easy" | "normal" | "hard";

const apiUrl = (params: Record<string, string>) => {
  const usp = new URLSearchParams({ origin: "*", format: "json", ...params });
  return `${API}?${usp.toString()}`;
};

const isBadTitle = (title: string) =>
  /\b(disambiguation|List of|Index of|Outline of)\b/i.test(title) ||
  title.length > 60;

/** Get a random "good" article title — biased away from disambig/list pages. */
export async function getRandomTitle(): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const url = apiUrl({
      action: "query",
      list: "random",
      rnnamespace: "0",
      rnlimit: "1",
      rnfilterredir: "nonredirects",
    });
    const res = await fetch(url);
    const json = await res.json();
    const title: string | undefined = json?.query?.random?.[0]?.title;
    if (!title) continue;
    if (isBadTitle(title)) continue;
    return title;
  }
  return "Anime";
}

/** Pageviews for the previous full day (UTC). */
function pageviewsDate(): { year: string; month: string; day: string } {
  const d = new Date(Date.now() - 36 * 60 * 60 * 1000); // ~1.5 days back, safer
  return {
    year: String(d.getUTCFullYear()),
    month: String(d.getUTCMonth() + 1).padStart(2, "0"),
    day: String(d.getUTCDate()).padStart(2, "0"),
  };
}

let topCache: string[] | null = null;
/** Most-viewed Wikipedia articles for yesterday (cached per session). */
async function getTopArticles(): Promise<string[]> {
  if (topCache) return topCache;
  const { year, month, day } = pageviewsDate();
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${year}/${month}/${day}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("pageviews failed");
    const json = await res.json();
    const items: { article: string }[] = json?.items?.[0]?.articles ?? [];
    topCache = items
      .map((x) => x.article.replace(/_/g, " "))
      .filter(
        (t) =>
          !/^(Main_Page|Special:|Wikipedia:|Portal:|File:)/i.test(t) &&
          !isBadTitle(t)
      );
    return topCache;
  } catch {
    topCache = [];
    return topCache;
  }
}

/** Difficulty-aware target picker. */
export async function getTitleForDifficulty(
  difficulty: Difficulty
): Promise<string> {
  if (difficulty === "easy") {
    const top = await getTopArticles();
    if (top.length) {
      // Pick from the top 200 popular articles.
      const pool = top.slice(0, 200);
      return pool[Math.floor(Math.random() * pool.length)];
    }
    return getRandomTitle();
  }
  if (difficulty === "hard") {
    // Filter random titles by low-ish pageviews (rejection sampling).
    for (let i = 0; i < 5; i++) {
      const t = await getRandomTitle();
      const views = await getMonthlyViews(t).catch(() => 99999);
      if (views < 1500) return t;
    }
    return getRandomTitle();
  }
  return getRandomTitle();
}

/** Approximate last-30-days views for a title via per-article daily endpoint. */
async function getMonthlyViews(title: string): Promise<number> {
  const end = new Date();
  const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(
      d.getUTCDate()
    ).padStart(2, "0")}`;
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(
    title.replace(/ /g, "_")
  )}/daily/${fmt(start)}/${fmt(end)}`;
  const res = await fetch(url);
  if (!res.ok) return 99999;
  const json = await res.json();
  const items: { views: number }[] = json?.items ?? [];
  return items.reduce((a, b) => a + (b.views || 0), 0);
}

/** Deterministic hash → number in [0, n). */
function seededIndex(seed: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % n;
}

/** Today's date string (UTC) for daily challenge seeding. */
export function dailySeed(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Deterministic start + target for the day, drawn from popular articles. */
export async function getDailyPair(): Promise<{ start: string; target: string }> {
  const top = await getTopArticles();
  const pool = top.slice(0, 500);
  if (pool.length < 2) {
    // Fallback: deterministic-ish from a curated list.
    const fallback = [
      "Anime", "Pizza", "Albert Einstein", "Photosynthesis", "Mount Everest",
      "Roman Empire", "Octopus", "Jazz", "Quantum mechanics", "Coffee",
      "Renaissance", "Volcano", "Salvador Dalí", "Origami", "Black hole",
    ];
    const seed = dailySeed();
    const a = seededIndex(seed + "-a", fallback.length);
    let b = seededIndex(seed + "-b", fallback.length);
    if (b === a) b = (b + 1) % fallback.length;
    return { start: fallback[a], target: fallback[b] };
  }
  const seed = dailySeed();
  const a = seededIndex(seed + "-start", pool.length);
  let b = seededIndex(seed + "-target", pool.length);
  if (b === a) b = (b + 1) % pool.length;
  return { start: pool[a], target: pool[b] };
}

/** Get a short summary for showing the goal. */
export async function getSummary(title: string): Promise<WikiSummary> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    title.replace(/ /g, "_")
  )}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`summary failed: ${res.status}`);
  const json = await res.json();
  return {
    title: json.title ?? title,
    extract: json.extract ?? "",
    thumbnail: json.thumbnail?.source,
  };
}

/** Fetch parsed HTML for an article. Returns canonical title + html. */
export async function getArticleHtml(
  title: string
): Promise<{ title: string; html: string }> {
  const url = apiUrl({
    action: "parse",
    page: title,
    prop: "text|displaytitle",
    redirects: "1",
    formatversion: "2",
  });
  const res = await fetch(url);
  const json = await res.json();
  if (json?.error) throw new Error(json.error.info || "parse failed");
  const html: string = json?.parse?.text ?? "";
  const canonical: string = json?.parse?.title ?? title;
  return { title: canonical, html };
}

/** Normalise a title for comparison ("Some_Title" / "some title" -> "some title"). */
export function normaliseTitle(t: string): string {
  return decodeURIComponent(t).replace(/_/g, " ").trim().toLowerCase();
}

/** Fetch the top-level (non-hidden) Wikipedia categories for a title. */
export async function getCategories(title: string, limit = 12): Promise<string[]> {
  const url = apiUrl({
    action: "query",
    titles: title,
    prop: "categories",
    cllimit: String(limit),
    clshow: "!hidden",
    formatversion: "2",
    redirects: "1",
  });
  try {
    const res = await fetch(url);
    const json = await res.json();
    const pages = json?.query?.pages ?? [];
    const cats = pages[0]?.categories ?? [];
    return cats
      .map((c: { title: string }) => c.title.replace(/^Category:/, ""))
      .filter((c: string) => !/articles|wikipedia|stub|cs1|use \w+ dates|pages /i.test(c))
      .slice(0, limit);
  } catch (e) {
    console.error("getCategories", e);
    return [];
  }
}

/** Fetch a sample of articles that link TO the given title (good stepping stones). */
export async function getBacklinks(title: string, limit = 10): Promise<string[]> {
  const url = apiUrl({
    action: "query",
    list: "backlinks",
    bltitle: title,
    blnamespace: "0",
    blfilterredir: "nonredirects",
    bllimit: "50",
    formatversion: "2",
  });
  try {
    const res = await fetch(url);
    const json = await res.json();
    const links: { title: string }[] = json?.query?.backlinks ?? [];
    const filtered = links
      .map((l) => l.title)
      .filter((t) => !isBadTitle(t));
    // Shuffle for variety, then trim.
    for (let i = filtered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
    }
    return filtered.slice(0, limit);
  } catch (e) {
    console.error("getBacklinks", e);
    return [];
  }
}

/**
 * Resolve a free-text query to a real Wikipedia article title.
 * Uses the search API + page summary to confirm the page exists.
 * Throws if nothing reasonable is found.
 */
export async function resolveTitleFromQuery(query: string): Promise<string> {
  const q = query.trim();
  if (!q) throw new Error("Please enter a word.");

  // 1. Try search API (best match).
  const searchUrl = apiUrl({
    action: "query",
    list: "search",
    srsearch: q,
    srlimit: "5",
    srnamespace: "0",
  });
  const res = await fetch(searchUrl);
  const json = await res.json();
  const hits: { title: string }[] = json?.query?.search ?? [];
  const candidate = hits.find((h) => !isBadTitle(h.title)) ?? hits[0];
  if (!candidate) throw new Error(`No Wikipedia article found for "${q}".`);

  // 2. Confirm via summary endpoint (returns canonical title, follows redirects).
  try {
    const sum = await getSummary(candidate.title);
    return sum.title;
  } catch {
    return candidate.title;
  }
}
