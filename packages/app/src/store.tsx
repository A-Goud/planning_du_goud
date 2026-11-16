import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { pruneOrphans, spaceSchema, type Space } from "@planning/core";
import { loadLocal, saveLocal, emptySpace } from "./storage.js";

interface Store {
  space: Space;
  ready: boolean;
  /**
   * Remplace l'espace après validation. Renvoie null si accepté,
   * sinon la liste des erreurs (l'espace n'est alors pas modifié).
   */
  commit(next: unknown): string[] | null;
  /** Remplace l'espace sans le valider (déjà validé par l'appelant, par exemple après un import). */
  replace(next: Space): void;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [space, setSpace] = useState<Space>(() => emptySpace());
  const [ready, setReady] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    void loadLocal().then((saved) => {
      if (saved) setSpace(saved);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void saveLocal(space), 400);
    return () => window.clearTimeout(timer.current);
  }, [space, ready]);

  const commit = useCallback((next: unknown): string[] | null => {
    // Retire d'abord des plannings ce qui référence une salle, une demande ou une période supprimée.
    const candidate = next as Space;
    const cleaned = Array.isArray(candidate?.plannings) ? pruneOrphans(candidate) : candidate;
    const parsed = spaceSchema.safeParse(cleaned);
    if (!parsed.success) {
      return parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")} : ${i.message}` : i.message));
    }
    setSpace(parsed.data);
    return null;
  }, []);

  const replace = useCallback((next: Space) => setSpace(next), []);

  return <StoreContext.Provider value={{ space, ready, commit, replace }}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("StoreProvider manquant");
  return s;
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
}
