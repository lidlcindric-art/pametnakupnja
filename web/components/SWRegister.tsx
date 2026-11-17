"use client";
import { useEffect } from "react";

export default function SWRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || location.hostname === "localhost" && location.port === "3000") return;
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      // nova verzija → aktiviraj odmah pri sljedećem otvaranju
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) w.postMessage("skipWaiting");
        });
      });
    }).catch(() => {});
  }, []);
  return null;
}
