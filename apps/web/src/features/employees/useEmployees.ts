"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchEmployees, type EmployeeRecord } from "./api";

export function useEmployees() {
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

  return { employees, isLoading, error, refresh };
}
