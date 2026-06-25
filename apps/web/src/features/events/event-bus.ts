import type { BGCompanyEvent } from "./types";

type BGCompanyEventListener = (event: BGCompanyEvent, log: BGCompanyEvent[]) => void;

export type BGCompanyEventBus = {
  publish: (event: BGCompanyEvent) => void;
  subscribe: (listener: BGCompanyEventListener) => () => void;
  getLog: () => BGCompanyEvent[];
  clear: () => void;
};

export function createBGCompanyEventBus(): BGCompanyEventBus {
  let log: BGCompanyEvent[] = [];
  const listeners = new Set<BGCompanyEventListener>();

  return {
    publish(event) {
      log = [...log, event];
      listeners.forEach((listener) => listener(event, log));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getLog() {
      return log;
    },
    clear() {
      log = [];
      listeners.forEach((listener) => listener({
        id: `EventLogCleared-${Date.now()}`,
        type: "EmployeeStatusChanged",
        timestamp: new Date().toISOString(),
        payload: { status: "대기 중", reason: "event log cleared" },
      }, log));
    },
  };
}
