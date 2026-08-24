import { gatecrashConfig } from '@gatecrash/config/eslint';

// `restrictFetch` stays on: nothing in an app may construct a request to the backend (§3).
export default gatecrashConfig({ react: true });
