import { useEffect, useMemo, useRef } from "react";
import { normaliseTitle } from "@/lib/wiki";

type Props = {
  html: string;
  targetTitle: string;
  onNavigate: (title: string) => void;
};

/**
 * Renders Wikipedia parsed HTML, filters/links to internal articles only,
 * highlights the target link, and intercepts clicks for in-game navigation.
 */
export const WikiArticle = ({ html, targetTitle, onNavigate }: Props) => {
  const ref = useRef<HTMLDivElement>(null);

  // Sanitised + rewritten HTML
  const processed = useMemo(() => {
    if (typeof window === "undefined") return html;
    const doc = new DOMParser().parseFromString(html, "text/html");

    // Remove edit links, references, navboxes, infoboxes, etc.
    doc
      .querySelectorAll(
        ".mw-editsection, .reference, sup.reference, .reflist, .navbox, .infobox, .hatnote, .thumb, figure, table, .mw-empty-elt, .metadata, .sistersitebox, .ambox, .noprint, style, script, .gallery, .toc"
      )
      .forEach((el) => el.remove());

    const target = normaliseTitle(targetTitle);

    doc.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href") || "";
      // Only allow internal article links: /wiki/Title (no ":" namespace, no "#")
      const m = href.match(/^\/wiki\/([^#?]+)$/);
      if (!m || m[1].includes(":")) {
        // Strip non-article links (replace with span)
        const span = doc.createElement("span");
        span.textContent = a.textContent || "";
        a.replaceWith(span);
        return;
      }
      const title = decodeURIComponent(m[1]).replace(/_/g, " ");
      a.setAttribute("href", `#${title}`);
      a.setAttribute("data-wiki-title", title);
      if (normaliseTitle(title) === target) {
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
    // Reset scroll on new article
    root.scrollTo?.({ top: 0 });
    return () => root.removeEventListener("click", handler);
  }, [processed, onNavigate]);

  return (
    <div
      ref={ref}
      className="wiki-article overflow-y-auto h-full px-8 py-8"
      dangerouslySetInnerHTML={{ __html: processed }}
    />
  );
};
