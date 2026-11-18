import { sendEmail } from '../utils/email';
import { config } from '../config';
jest.unmock('../utils/email');

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail: (...args: unknown[]) => mockSendMail(...args) }) } }));
jest.mock('../config', () => ({ config: { nodeEnv: 'development', app: { name: 'Test POS' }, email: { user: '', pass: '', sendgridApiKey: '', from: 'test@example.test' } } }));
const message = { to: 'owner@example.test', subject: 'Daily summary', html: '<p>Private figures</p>' };

describe('Email delivery reports provider outcomes truthfully', () => {
  beforeEach(() => { config.email.user = ''; config.email.pass = ''; config.email.sendgridApiKey = ''; });
  it('refuses unconfigured development delivery instead of logging private content as success', async () => {
    await expect(sendEmail(message)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(mockSendMail).not.toHaveBeenCalled();
  });
  it('recognizes SMTP acceptance and explicit rejection', async () => {
    config.email.user = 'test'; config.email.pass = 'test';
    mockSendMail.mockResolvedValueOnce({ accepted: [message.to], rejected: [] }).mockResolvedValueOnce({ accepted: [], rejected: [message.to] });
    await expect(sendEmail(message)).resolves.toBeUndefined();
    await expect(sendEmail(message)).rejects.toMatchObject({ code: 'PROVIDER_REJECTED' });
  });
  it('treats a dropped SMTP response as uncertain without exposing provider error details', async () => {
    config.email.user = 'test'; config.email.pass = 'test'; mockSendMail.mockRejectedValue(new Error('Secret provider detail'));
    await expect(sendEmail(message)).rejects.toMatchObject({ code: 'DELIVERY_UNKNOWN', message: 'Email delivery could not be confirmed' });
  });
  it('bounds HTTPS delivery and distinguishes rejection from an uncertain server failure', async () => {
    config.email.sendgridApiKey = 'test-only';
    const send = jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('', { status: 202 })).mockResolvedValueOnce(new Response('private detail', { status: 400 })).mockResolvedValueOnce(new Response('private detail', { status: 503 }));
    await expect(sendEmail(message)).resolves.toBeUndefined();
    expect(send.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    await expect(sendEmail(message)).rejects.toMatchObject({ code: 'PROVIDER_REJECTED' });
    await expect(sendEmail(message)).rejects.toMatchObject({ code: 'DELIVERY_UNKNOWN' });
  });
});
