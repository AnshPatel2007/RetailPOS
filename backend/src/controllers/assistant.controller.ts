import { Request, Response } from 'express';
import { asyncHandler } from '../utils/errorHandler';
import { generalAssistantAnswer, validateAssistantInput, withAssistantProvider } from '../services/assistant.service';

export const assistantHelp = asyncHandler(async (req: Request, res: Response) => {
  const input = validateAssistantInput(req.body);
  const answer = await withAssistantProvider(req, res, (client, signal) => generalAssistantAnswer(input, client, signal));
  res.json({ success: true, data: { answer } });
});
