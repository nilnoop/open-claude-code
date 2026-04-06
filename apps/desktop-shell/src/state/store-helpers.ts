import { createJSONStorage, type StateStorage } from "zustand/middleware";

export const appStorageKey = "open-claude-code";
const legacyPersistKey = `persist:${appStorageKey}`;

export function namespacedStorage(name: string) {
  const storageKey = namespacedKey(name);

  return createJSONStorage(
    () =>
      ({
        getItem: (key: string) => localStorage.getItem(`${storageKey}:${key}`),
        setItem: (key: string, value: string) =>
          localStorage.setItem(`${storageKey}:${key}`, value),
        removeItem: (key: string) =>
          localStorage.removeItem(`${storageKey}:${key}`),
      }) as StateStorage,
    {
      replacer: (_key, value) => value,
      reviver: (_key, value) => value,
    },
  );
}

export function namespacedKey(name: string) {
  return `${appStorageKey}:${name}`;
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function readLegacyPersistedSlice<T>(sliceName: string): T | null {
  if (!canUseStorage()) {
    return null;
  }

  const rawRoot = localStorage.getItem(legacyPersistKey);

  if (!rawRoot) {
    return null;
  }

  try {
    const root = JSON.parse(rawRoot) as Record<string, unknown>;
    const slice = root[sliceName];

    if (slice == null) {
      return null;
    }

    if (typeof slice === "string") {
      return safeParseJson(slice) as T;
    }

    return slice as T;
  } catch {
    return null;
  }
}
