import { createContext, ReactNode, useContext, useEffect, useState } from "react";

import { api } from "../api/client";

export interface Branding {
  client_name: string;
  powered_by: string;
  timezone: string;
  has_logo: boolean;
  logo_url: string | null;
}

const DEFAULT_BRANDING: Branding = {
  client_name: "ProcessScout",
  powered_by: "ProcessScout",
  timezone: "America/Chicago",
  has_logo: false,
  logo_url: null,
};

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);

  useEffect(() => {
    api
      .get<Branding>("/branding", { auth: false })
      .then((data) => {
        setBranding(data);
        document.title = data.client_name;
      })
      .catch(() => {
        // fall through to defaults
      });
  }, []);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  return useContext(BrandingContext);
}
