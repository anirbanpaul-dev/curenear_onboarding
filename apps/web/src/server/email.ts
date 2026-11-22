import nodemailer, { type Transporter } from 'nodemailer';
import { logger } from '@/lib/logger';

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

/** SMTP delivery — Mailpit in development, any SMTP relay in production. */
export function createSmtpEmailService(config: SmtpConfig): EmailService {
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
      try {
        await getTransporter().sendMail({
          from: config.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
        });
      } catch (error) {
        // Never let a mail outage turn into a different response for the caller:
        // it would leak which addresses exist.
        logger.error(
          { err: error instanceof Error ? error.message : 'unknown' },
          'email_delivery_failed',
        );
      }
    },
  };
}

/** Tests capture what would have been sent. */
export function createMemoryEmailService(): EmailService & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}
