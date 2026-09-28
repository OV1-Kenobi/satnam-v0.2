import { useCallback } from "react";
import { isNwcByoEnabled } from "../config/env.js";
import { NwcConnectionManager } from "../lib/nwc/connection-manager.js";

/** Phase 0: BYO NWC — paste any NIP-47 URI, no Alby SDK */
export function useNwcByo(manager: NwcConnectionManager) {
  const addByo = useCallback(async (label: string, uri: string) => {
    if (!isNwcByoEnabled()) throw new Error("nwc_byo_disabled");
    // URI stored in Vault nwc/{id}.uri by manager.addConnection
    return manager.addConnection(label, uri);
  }, [manager]);
  return { addByo, enabled: isNwcByoEnabled() };
}
