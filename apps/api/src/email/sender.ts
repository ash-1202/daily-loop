export interface Email {
  to: string;
  subject: string;
  text: string;
}

/**
 * Where emails go. The rest of the app only knows this interface, so the provider can change
 * (Resend now; SES, Postmark or SMTP later) and tests can capture emails instead of sending them.
 */
export interface EmailSender {
  send(email: Email): Promise<void>;
}

/** Development: print the email to the server log (no account or network needed). */
export class ConsoleEmailSender implements EmailSender {
  async send(email: Email): Promise<void> {
    console.log(
      `\n📧 Email to ${email.to}\n   Subject: ${email.subject}\n   ${email.text.replace(/\n/g, '\n   ')}\n`,
    );
  }
}

/** Tests: keep emails in memory. */
export class MemoryEmailSender implements EmailSender {
  readonly sent: Email[] = [];
  async send(email: Email): Promise<void> {
    this.sent.push(email);
  }
}

/** Production: Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(email: Email): Promise<void> {
    const res = await this.fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Never include the API key or the code in errors; the status and body are enough to debug.
      throw new Error(`Resend: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
  }
}
