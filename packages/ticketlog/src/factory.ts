import { BrowserTicketLogProvider } from "./browser/browserProvider.js";
import { OfficialApiTicketLogProvider } from "./officialApiProvider.js";
import type { TicketLogProvider, TicketLogProviderHooks } from "./provider.js";
import { SimulationTicketLogProvider } from "./simulationProvider.js";

export function createTicketLogProvider(hooks: TicketLogProviderHooks = {}): TicketLogProvider {
  switch (process.env.TICKETLOG_PROVIDER_MODE) {
    case "browser":
      return new BrowserTicketLogProvider(hooks);
    case "api":
    case "ticketlog-api":
    case "official-api":
      return new OfficialApiTicketLogProvider(
        process.env.TICKETLOG_API_ENABLE_BROWSER_FALLBACK === "false" ? undefined : new BrowserTicketLogProvider(hooks),
      );
    case "simulation":
    default:
      return new SimulationTicketLogProvider();
  }
}
