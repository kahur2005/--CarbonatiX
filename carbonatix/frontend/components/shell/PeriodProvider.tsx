"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { currentPeriod, isPeriodInRange } from "@/lib/period";

const STORAGE_KEY = "smartsmelt.selectedPeriod";

type PeriodContextValue = {
  selectedPeriod: string;
  setSelectedPeriod: (period: string) => void;
};

const PeriodContext = createContext<PeriodContextValue | null>(null);

function readStoredPeriod(): string {
  if (typeof window === "undefined") return currentPeriod();
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored && isPeriodInRange(stored)) return stored;
  } catch {
    // sessionStorage unavailable — fall through
  }
  return currentPeriod();
}

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [selectedPeriod, setSelectedPeriodState] = useState(currentPeriod);

  useEffect(() => {
    setSelectedPeriodState(readStoredPeriod());
  }, []);

  function setSelectedPeriod(period: string) {
    if (!isPeriodInRange(period)) return;
    setSelectedPeriodState(period);
    try {
      sessionStorage.setItem(STORAGE_KEY, period);
    } catch {
      // ignore quota / private mode
    }
  }

  return (
    <PeriodContext.Provider value={{ selectedPeriod, setSelectedPeriod }}>
      {children}
    </PeriodContext.Provider>
  );
}

export function useSelectedPeriod(): PeriodContextValue {
  const ctx = useContext(PeriodContext);
  if (!ctx) {
    throw new Error("useSelectedPeriod must be used within PeriodProvider");
  }
  return ctx;
}
