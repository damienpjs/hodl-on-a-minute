"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/**
 * Created inside the component, not at module scope: a module-level client is
 * shared across requests on the server, which would leak one player's cached
 * state into another player's first render.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The game state is only ever a couple of seconds old and the
            // polling interval is explicit, so nothing here should be reused
            // silently.
            staleTime: 0,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
