"use client";

import {Moon, Sun} from "@gravity-ui/icons";
import {Button} from "@heroui/react";
import {useCallback, useSyncExternalStore} from "react";

export type SilvectorTheme = "brutalism-dark" | "brutalism-light";
export type ThemeMode = SilvectorTheme;

const THEME_STORAGE_KEY = "conduit.theme";
const themeListeners = new Set<() => void>();

function notifyThemeListeners() {
  for (const listener of themeListeners) {
    listener();
  }
}

function syncDocumentTheme(theme: SilvectorTheme) {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;

  if (theme === "brutalism-light") {
    if (root.dataset.theme !== "brutalism-light") {
      root.dataset.theme = "brutalism-light";
    }
    root.classList.remove("dark", "brutalism-dark");
    root.classList.add("light", "brutalism-light");
  } else {
    if (root.dataset.theme !== "brutalism-dark") {
      root.dataset.theme = "brutalism-dark";
    }
    root.classList.remove("light", "brutalism-light");
    root.classList.add("dark", "brutalism-dark");
  }
}

function subscribeTheme(onStoreChange: () => void): () => void {
  themeListeners.add(onStoreChange);

  if (typeof window === "undefined") {
    return () => {
      themeListeners.delete(onStoreChange);
    };
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) {
      const next: SilvectorTheme =
        event.newValue === "brutalism-light" ? "brutalism-light" : "brutalism-dark";

      syncDocumentTheme(next);
      onStoreChange();
    }
  };

  const observer = new MutationObserver(() => {
    onStoreChange();
  });

  observer.observe(document.documentElement, {
    attributeFilter: ["data-theme"],
    attributes: true,
  });
  window.addEventListener("storage", handleStorage);

  return () => {
    themeListeners.delete(onStoreChange);
    observer.disconnect();
    window.removeEventListener("storage", handleStorage);
  };
}

function getThemeSnapshot(): SilvectorTheme {
  if (typeof document === "undefined") {
    return "brutalism-dark";
  }

  return document.documentElement.dataset.theme === "brutalism-light"
    ? "brutalism-light"
    : "brutalism-dark";
}

function getServerThemeSnapshot(): SilvectorTheme {
  return "brutalism-dark";
}

export function setSilvectorTheme(theme: SilvectorTheme) {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage access errors in restricted browsing contexts.
    }
  }

  syncDocumentTheme(theme);
  notifyThemeListeners();
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
}

export interface ThemeToggleProps {
  showLabel?: boolean;
}

export function ThemeToggle({showLabel = false}: ThemeToggleProps) {
  const theme = useThemeMode();
  const isDark = theme === "brutalism-dark";

  const handleToggle = useCallback(() => {
    setSilvectorTheme(isDark ? "brutalism-light" : "brutalism-dark");
  }, [isDark]);

  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  if (showLabel) {
    return (
      <Button aria-label={label} size="sm" variant="tertiary" onPress={handleToggle}>
        {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        {isDark ? "Light mode" : "Dark mode"}
      </Button>
    );
  }

  return (
    <Button isIconOnly aria-label={label} size="sm" variant="tertiary" onPress={handleToggle}>
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
