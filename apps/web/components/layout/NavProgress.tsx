"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

export function NavProgress() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const prevPath = useRef(pathname);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const widthRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (pathname !== prevPath.current) {
      // New route resolved — finish bar
      setWidth(100);
      const t = setTimeout(() => {
        setVisible(false);
        setWidth(0);
      }, 250);
      prevPath.current = pathname;
      return () => clearTimeout(t);
    }
  }, [pathname]);

  // On click anywhere in the nav, start the bar
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("a[href]")) {
        setVisible(true);
        setWidth(15);
        // Grow slowly while waiting for route change
        let w = 15;
        widthRef.current = setInterval(() => {
          w = Math.min(w + Math.random() * 8, 85);
          setWidth(w);
        }, 400);
        timerRef.current = setTimeout(() => {
          if (widthRef.current) clearInterval(widthRef.current);
        }, 8000);
      }
    };
    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("click", handleClick);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (widthRef.current) clearInterval(widthRef.current);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        height: "2px",
        width: `${width}%`,
        background: "linear-gradient(90deg, #7c3aed, #a78bfa)",
        transition: width === 100 ? "width 0.15s ease-out" : "width 0.4s ease",
        zIndex: 9999,
        boxShadow: "0 0 8px rgba(124,58,237,0.6)",
        pointerEvents: "none",
      }}
    />
  );
}
