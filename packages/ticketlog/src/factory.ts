import { BrowserTicketLogProvider } from "./browser/browserProvider.js";
import { OfficialApiTicketLogProvider } from "./officialApiProvider.js";
import type { TicketLogProvider, TicketLogProviderHooks } from "./provider.js";
import { SimulationTicketLogProvider } from "./simulationProvider.js";

export function createTicketLogProvider(hooks: TicketLogProviderHooks = {}): TicketLogProvider {
  switch (process.env.TICKETLOG_PROVIDER_MODE) {
    case "browser":
      return new BrowserTicketLogProvider(hooks);
    case "official-api":
      return new OfficialApiTicketLogProvider();
    case "simulation":
    default:
      return new SimulationTicketLogProvider();
  }
}
