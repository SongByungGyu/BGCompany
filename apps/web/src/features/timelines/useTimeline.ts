"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchTimeline, type TimelineRecord, type TimelineTargetType } from "./api";

export function useTimeline(targetType?: TimelineTargetType, targetId?: string) {
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

  return { timeline, isLoading, error, refresh };
}
