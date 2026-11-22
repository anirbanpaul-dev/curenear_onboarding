import nodemailer, { type Transporter } from 'nodemailer';
import type { Logger } from 'pino';

/** The SMTP interface the worker sends notification email through. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailService {
  send(message: EmailMessage): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  from: string;
  user?: string | undefined;
  password?: string | undefined;
}

/** Mailpit in development, any SMTP relay in production. */
export function createSmtpEmailService(config: SmtpConfig, logger: Logger): EmailService {
  let transporter: Transporter | null = null;

  function getTransporter(): Transporter {
    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.port === 465,
        ...(config.user && config.password
          ? { auth: { user: config.user, pass: config.password } }
          : {}),
      });
    }
    return transporter;
  }

  return {
    async send(message) {
      await getTransporter().sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      logger.info({ to: message.to, subject: message.subject }, 'email_sent');
    },
  };
}

/** Tests and local runs without SMTP capture what would have been sent. */
export function createMemoryEmailService(): EmailService & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}
