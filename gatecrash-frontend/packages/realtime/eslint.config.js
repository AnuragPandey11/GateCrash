import { gatecrashConfig } from '@gatecrash/config/eslint';

// `react: true` — this package ships a provider and hooks, so the react-hooks rules apply here
// exactly as they do in an app.
export default gatecrashConfig({ react: true });
