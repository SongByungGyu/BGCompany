"use client";

import { useCallback, useEffect, useState } from "react";
import { DB_SYNC_INTERVAL_MS } from "@/lib/db-sync";
import { fetchTimeline, type TimelineRecord, type TimelineTargetType } from "./api";

type UseTimelineOptions = {
  polling?: boolean;
  intervalMs?: number;
};

export function useTimeline(targetType?: TimelineTargetType, targetId?: string, options: UseTimelineOptions = {}) {
  const { polling = false, intervalMs = DB_SYNC_INTERVAL_MS } = options;
  const [timeline, setTimeline] = useState<TimelineRecord[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(targetType));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!targetType) {
      setTimeline([]);
      setIsLoading(false);
      setError(null);
      return [];
    }
    setIsLoading(true);
    try {
      const records = await fetchTimeline({ targetType, targetId });
      setTimeline(records);
      setError(null);
      return records;
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : "알 수 없는 오류";
      setError(message);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [targetType, targetId]);

  useEffect(() => {
    let cancelled = false;
    if (!targetType) {
      Promise.resolve().then(() => {
        if (cancelled) return;
        setTimeline([]);
        setIsLoading(false);
        setError(null);
      });
      return () => { cancelled = true; };
    }
    fetchTimeline({ targetType, targetId })
      .then((records) => {
        if (cancelled) return;
        setTimeline(records);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const message = caught instanceof Error ? caught.message : "알 수 없는 오류";
        setTimeline([]);
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [targetType, targetId]);

  useEffect(() => {
    if (!polling || !targetType) return undefined;
    const intervalId = window.setInterval(() => {
      void refresh();
    }, intervalMs);
    return () => window.clearInterval(intervalId);
  }, [intervalMs, polling, refresh, targetType]);

  return { timeline, isLoading, error, refresh };
}
