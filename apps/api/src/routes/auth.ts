import type { FastifyInstance } from 'fastify';
import { otpRequestSchema, otpVerifySchema, type OtpVerifyResponse } from '@daily-loop/shared';
import { requireUser, SESSION_COOKIE, setSessionCookie } from '../app';
import { config } from '../config';
import { HttpError, parseBody } from '../lib/http-error';
import { requestCode, verifyCode } from '../services/email-login';
import { revokeSession } from '../services/sessions';
import { getUser } from '../services/users';

export async function authRoutes(app: FastifyInstance) {
  const emailSender = () => {
    if (!app.deps.email) {
      throw new HttpError(503, 'email_unavailable', 'Email login is not available right now.');
    }
    return app.deps.email;
  };

  /** Sends a 6-digit code. Always the same answer, whether or not the email has an account. */
  app.post('/api/auth/otp/request', async (req, reply) => {
    requireUser(req);
    const sender = emailSender();
    const { email } = parseBody(otpRequestSchema, req.body);
    await requestCode(app.deps.pool, sender, {
      email,
      ip: req.ip,
      now: app.deps.clock(),
      secret: config.OTP_SECRET,
    });
    return reply.code(202).send({ sent: true });
  });

  /** Checks the code and saves progress to the email (or signs in to the account that has it). */
  app.post('/api/auth/otp/verify', async (req, reply): Promise<OtpVerifyResponse> => {
    const currentUserId = requireUser(req);
    emailSender();
    const { email, code } = parseBody(otpVerifySchema, req.body);
    const result = await verifyCode(app.deps.pool, {
      email,
      code,
      currentUserId,
      now: app.deps.clock(),
      secret: config.OTP_SECRET,
    });
    if (result.sessionToken) setSessionCookie(reply, result.sessionToken);
    return {
      user: await getUser(app.deps.pool, result.userId),
      switchedAccount: result.switchedAccount,
    };
  });

  /** Ends this session. The app also forgets its device token, so it starts again as a new guest. */
  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await revokeSession(app.deps.pool, token, app.deps.clock());
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
}
