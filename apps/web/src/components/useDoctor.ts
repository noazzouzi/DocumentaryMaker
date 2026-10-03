"use client";
// Loads /api/doctor on demand (the report probes tools and may take a few seconds).
import { useCallback, useEffect, useState } from "react";
import type { DoctorReport } from "@docmaker/engine";
import { api, errorText } from "@/lib/api";

export function useDoctor(auto = true) {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [loading, setLoading] = useState(false);
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
    if (auto) void run();
  }, [auto, run]);
  return { report, loading, error, run };
}
