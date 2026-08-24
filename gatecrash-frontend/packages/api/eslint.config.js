import { gatecrashConfig } from '@gatecrash/config/eslint';

// `restrictFetch: false` — this package *is* the sanctioned place to touch the network (§3).
export default gatecrashConfig({ restrictFetch: false });
