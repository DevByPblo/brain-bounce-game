// Wikipedia API helpers (CORS-enabled, no key required).

const API = "https://en.wikipedia.org/w/api.php";

export type WikiSummary = {
  title: string;
  extract: string;
  thumbnail?: string;
};

const apiUrl = (params: Record<string, string>) => {
  const usp = new URLSearchParams({ origin: "*", format: "json", ...params });
  return `${API}?${usp.toString()}`;
};

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
    if (/\b(disambiguation|List of|Index of)\b/i.test(title)) continue;
    if (title.length > 60) continue;
    return title;
  }
  return "Anime";
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
