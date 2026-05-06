"use client";

import { useEffect, useRef } from "react";

export function useWakeLock(active: boolean) {
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    if (!active) {
      if (wakeLockRef.current !== null) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      return;
    }

    let isMounted = true;

    const requestWakeLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
          
          wakeLockRef.current.addEventListener("release", () => {
            if (isMounted && active && document.visibilityState === "visible") {
              // Re-acquire when visibility changes back (handled below)
            }
          });
        }
      } catch (err) {
        console.error("Wake Lock request failed:", err);
      }
    };

    const handleVisibilityChange = () => {
      if (wakeLockRef.current !== null && document.visibilityState === "visible" && active) {
        requestWakeLock();
      }
    };

    if (active) {
      requestWakeLock();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (wakeLockRef.current !== null) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [active]);
}
