"use client";
// Loads /api/doctor (the report probes tools and may take a few seconds); `run` re-checks on demand.
import { useCallback, useEffect, useState } from "react";
import type { DoctorReport } from "@docmaker/engine";
import { api, errorText } from "@/lib/api";

export function useDoctor(auto = true) {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [loading, setLoading] = useState(auto);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await api<DoctorReport>("/api/doctor"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!auto) return;
    let alive = true;
    api<DoctorReport>("/api/doctor")
      .then((r) => alive && setReport(r))
      .catch((e: unknown) => alive && setError(errorText(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [auto]);
  return { report, loading, error, run };
}
