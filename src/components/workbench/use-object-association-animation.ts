"use client";
import { useEffect, useRef } from "react";
import "./object-association-animation.css";

type Point = { x: number; y: number };
/** Sample a quadratic arc so all supported browsers use the same placement motion. */
export function associationArcFrames(from: Point, to: Point): Keyframe[] {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const control = { x: (from.x + to.x) / 2, y: Math.max(24, Math.min(from.y, to.y) - Math.min(180, distance * .3)) };
  return Array.from({ length: 25 }, (_, index) => {
    const t = index / 24, remaining = 1 - t;
    const x = remaining * remaining * from.x + 2 * remaining * t * control.x + t * t * to.x;
    const y = remaining * remaining * from.y + 2 * remaining * t * control.y + t * t * to.y;
    return { offset: t, transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1 - .28 * t})`, opacity: t < .8 ? 1 : 1 - (t - .8) * 3 };
  });
}

/** Decorative feedback only; object association never waits for animation completion. */
export function useObjectAssociationAnimation(scope: string) {
  const active = useRef<(() => void) | null>(null);
  useEffect(() => () => { active.current?.(); }, [scope]);
  return (source: HTMLButtonElement, count: number) => {
    active.current?.();
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (count < 1 || motion.matches || !source.isConnected) return;
    if (typeof source.animate !== "function") return;
    const start = source.getBoundingClientRect();
    if (!start.width) return;
    let chip: HTMLSpanElement | undefined;
    let flight: Animation | undefined, landing: Animation | undefined;
    const cleanup = () => {
      if (active.current === cleanup) active.current = null;
      window.cancelAnimationFrame(frame);
      if (flight) { flight.onfinish = null; flight.oncancel = null; flight.cancel(); }
      if (landing) { landing.onfinish = null; landing.oncancel = null; landing.cancel(); }
      chip?.remove();
      window.removeEventListener("resize", cleanup);
      motion.removeEventListener("change", cleanup);
    };
    active.current = cleanup;
    window.addEventListener("resize", cleanup);
    motion.addEventListener("change", cleanup);
    // React first commits the new association list; measure its final location on the next frame.
    const frame = window.requestAnimationFrame(() => {
      const target = Array.from(source.closest(".object-layout")?.querySelectorAll<HTMLElement>("[data-association-target]") ?? [])
        .find(element => !element.closest("[hidden]") && element.getClientRects().length > 0);
      if (!source.isConnected || !target || motion.matches) { cleanup(); return; }
      const end = target.getBoundingClientRect();
      if (!end.width) { cleanup(); return; }
      chip = document.createElement("span");
      chip.className = "object-association-flight";
      chip.setAttribute("aria-hidden", "true");
      chip.textContent = "▤ +" + count;
      document.body.appendChild(chip);
      try {
        flight = chip.animate(associationArcFrames(
          { x: start.x + start.width / 2, y: start.y + start.height / 2 },
          { x: end.x + end.width / 2, y: end.y + end.height / 2 },
        ), { duration: 620, easing: "ease-in-out", fill: "forwards" });
        flight.oncancel = cleanup;
        flight.onfinish = () => {
          chip?.remove();
          if (!target.isConnected || motion.matches) { cleanup(); return; }
          landing = target.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)", color: "var(--ee-primary)" }, { transform: "scale(1)" }], { duration: 240 });
          landing.onfinish = cleanup;
          landing.oncancel = cleanup;
        };
      } catch { cleanup(); }
    });
  };
}
