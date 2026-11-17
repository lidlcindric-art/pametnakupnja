"use client";
export default function Toast({ msg }: { msg: string | null }) {
  return <div className={"toast" + (msg ? " show" : "")} role="status" aria-live="polite">{msg}</div>;
}
