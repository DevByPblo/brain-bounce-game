import { useEffect, useMemo, useRef } from "react";
import { normaliseTitle } from "@/lib/wiki";

type Props = {
  html: string;
  targetTitle?: string;
  onNavigate: (title: string) => void;
  /** When true, hides all text content; only images, infobox, captions remain. */
  imagesOnly?: boolean;
};

/**
 * Renders Wikipedia parsed HTML preserving its native layout (infobox, images,
 * tables, captions). Internal article links are rewritten to drive in-game
 * navigation; external/non-article links become plain text.
 */
export const WikiArticle = ({
  html,
  targetTitle = "",
  onNavigate,
  imagesOnly = false,
}: Props) => {
  const ref = useRef<HTMLDivElement>(null);

  const processed = useMemo(() => {
    if (typeof window === "undefined") return html;
    const doc = new DOMParser().parseFromString(html, "text/html");

    // Always strip: script/style, edit chrome, references markers, navboxes,
    // and other non-article furniture.
    doc
      .querySelectorAll(
        [
          "script",
          "style",
          ".mw-editsection",
          ".reference",
          "sup.reference",
          ".reflist",
          ".navbox",
          ".vertical-navbox",
          ".sistersitebox",
          ".ambox",
          ".metadata",
          ".noprint",
          ".mw-empty-elt",
          ".hatnote",
          ".mbox-small",
          ".portal",
          ".plainlinks",
          ".mw-references-wrap",
          "#toc",
          ".toc",
          "div.printfooter",
          "div.catlinks",
          // Strip "External links", "References", "See also", "Notes"
          // by hiding sections that follow these h2s — done after.
        ].join(", ")
      )
      .forEach((el) => el.remove());

    // Rewrite image URLs that start with "//" → "https://"
    doc.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src");
      if (src && src.startsWith("//")) img.setAttribute("src", "https:" + src);
      const srcset = img.getAttribute("srcset");
      if (srcset) {
        img.setAttribute(
          "srcset",
          srcset.replace(/(^|,\s*)\/\//g, "$1https://")
        );
      }
      img.setAttribute("loading", "lazy");
      img.setAttribute("decoding", "async");
    });

    // Drop everything from the "References" / "External links" / "See also" h2 onward.
    const stopHeadings = ["References", "External links", "See also", "Notes", "Bibliography", "Further reading"];
    const headlines = doc.querySelectorAll("h2 .mw-headline, h2");
    headlines.forEach((h) => {
      const id =
        (h as HTMLElement).id ||
        (h.parentElement as HTMLElement | null)?.id ||
        h.textContent?.trim() ||
        "";
      if (stopHeadings.some((s) => id.toLowerCase().includes(s.toLowerCase()))) {
        // Remove this h2 (or its parent h2) and all subsequent siblings.
        const h2 = h.tagName === "H2" ? h : h.closest("h2");
        if (!h2) return;
        let n: ChildNode | null = h2;
        while (n) {
          const next: ChildNode | null = n.nextSibling;
          n.parentNode?.removeChild(n);
          n = next;
        }
      }
    });

    const target = normaliseTitle(targetTitle);

    doc.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href") || "";
      const m = href.match(/^\/wiki\/([^#?]+)$/);
      if (!m || m[1].includes(":")) {
        // Strip non-article links (replace with span)
        const span = doc.createElement("span");
        span.innerHTML = a.innerHTML;
        if (a.className) span.className = a.className;
        a.replaceWith(span);
        return;
      }
      const title = decodeURIComponent(m[1]).replace(/_/g, " ");
      a.setAttribute("href", `#${title}`);
      a.setAttribute("data-wiki-title", title);
      if (target && normaliseTitle(title) === target) {
        a.classList.add("target-link");
      }
    });

    return doc.body.innerHTML;
  }, [html, targetTitle]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const handler = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a[data-wiki-title]") as
        | HTMLAnchorElement
        | null;
      if (!a) return;
      e.preventDefault();
      const title = a.getAttribute("data-wiki-title");
      if (title) onNavigate(title);
    };
    root.addEventListener("click", handler);
    // Reset scroll: the article's own scroller AND the window (mobile layouts).
    root.scrollTo?.({ top: 0 });
    window.scrollTo({ top: 0, behavior: "auto" });
    return () => root.removeEventListener("click", handler);
  }, [processed, onNavigate]);

  return (
    <div
      ref={ref}
      className={`wiki-article overflow-y-auto h-full px-6 md:px-10 py-8 ${
        imagesOnly ? "wiki-article--images-only" : ""
      }`}
      dangerouslySetInnerHTML={{ __html: processed }}
    />
  );
};
