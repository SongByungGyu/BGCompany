"use client";

import { useCallback, useEffect, useState } from "react";
import { DB_SYNC_INTERVAL_MS } from "@/lib/db-sync";
import { fetchEmployees, type EmployeeRecord } from "./api";

type UseEmployeesOptions = {
  polling?: boolean;
  intervalMs?: number;
};

export function useEmployees(options: UseEmployeesOptions = {}) {
  const { polling = false, intervalMs = DB_SYNC_INTERVAL_MS } = options;
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const records = await fetchEmployees();
      setEmployees(records);
      setError(null);
      return records;
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : "알 수 없는 오류";
      setError(message);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchEmployees()
      .then((records) => {
        if (cancelled) return;
        setEmployees(records);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const message = caught instanceof Error ? caught.message : "알 수 없는 오류";
        setError(message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!polling) return undefined;
    const intervalId = window.setInterval(() => {
      void refresh();
    }, intervalMs);
    return () => window.clearInterval(intervalId);
  }, [intervalMs, polling, refresh]);

  return { employees, isLoading, error, refresh };
}
