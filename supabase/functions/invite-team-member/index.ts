import { serve } from '../_shared/serve.ts';
import { handleInviteRequest, runtimeFromEnv } from './handler.ts';

serve((req) => handleInviteRequest(req, runtimeFromEnv()));
