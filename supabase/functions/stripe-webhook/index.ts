import { serve } from '../_shared/serve.ts';
import { handleWebhookRequest, runtimeFromEnv } from './handler.ts';

serve((req) => handleWebhookRequest(req, runtimeFromEnv()));
