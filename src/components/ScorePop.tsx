import { useEffect, useState } from "react";

type Pop = { id: number; text: string; x: number; y: number };

let popQueue: ((p: Pop) => void) | null = null;
let nextId = 1;

/**
 * Trigger a floating "+N" popup anywhere on the screen.
 * Pass screen coordinates (clientX/clientY).
 */
export function scorePop(text: string, x?: number, y?: number) {
  const px = x ?? window.innerWidth / 2;
  const py = y ?? window.innerHeight / 2;
  popQueue?.({ id: nextId++, text, x: px, y: py });
}

export const ScorePopHost = () => {
  const [pops, setPops] = useState<Pop[]>([]);

  useEffect(() => {
    popQueue = (p) => {
      setPops((cur) => [...cur, p]);
      setTimeout(
        () => setPops((cur) => cur.filter((x) => x.id !== p.id)),
        1200
      );
    };
    return () => {
      popQueue = null;
    };
  }, []);

  return (
    <>
      {pops.map((p) => (
        <div
          key={p.id}
          className="score-pop"
          style={{ left: p.x, top: p.y }}
        >
          {p.text}
        </div>
      ))}
    </>
  );
};
