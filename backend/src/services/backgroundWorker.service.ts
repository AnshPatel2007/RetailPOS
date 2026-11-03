import { BackgroundJob } from '@prisma/client';
import { processNextBackgroundJob, JobOutcome } from './jobQueue.service';
import { deliverWebhookJob } from './webhook.service';
import { deliverEmailJob } from './queuedEmail.service';
import { generateExportJob } from './queuedExport.service';
import { logger } from '../utils/logger';
export async function executeBackgroundJob(job: BackgroundJob): Promise<JobOutcome> {
  if (job.kind === 'WEBHOOK') return deliverWebhookJob(job);
  if (job.kind === 'EMAIL') return deliverEmailJob(job);
  if (job.kind === 'EXPORT') return generateExportJob(job);
  return { status: 'FAILED', code: 'UNSUPPORTED_JOB_KIND' };
}
let running = false;
export function startBackgroundWorker() {
  if (process.env.BACKGROUND_WORKER_DISABLED === 'true' || process.env.NODE_ENV === 'test') return;
  const timer = setInterval(() => {
    if (running) return; running = true;
    void (async () => { for (let n = 0; n < 5; n++) if (!await processNextBackgroundJob(executeBackgroundJob)) break; })()
      .catch(() => logger.error('Background worker failed; stored jobs remain available for recovery'))
      .finally(() => { running = false; });
  }, 5000);
  timer.unref();
}
