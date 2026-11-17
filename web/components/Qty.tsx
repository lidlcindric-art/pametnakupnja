"use client";
export default function Qty({ n, set, size = "md" }: { n: number; set: (q: number) => void; size?: "sm" | "md" }) {
  return (
    <span className={"stepper " + size}>
      <button onClick={(e) => { e.stopPropagation(); set(n - 1); }} aria-label="Manje">{n === 1 ? "🗑" : "−"}</button>
      <b>{n}</b>
      <button onClick={(e) => { e.stopPropagation(); set(n + 1); }} aria-label="Više">+</button>
    </span>
  );
}
