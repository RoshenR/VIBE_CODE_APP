import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

export function getTransporter(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? '' }
      : undefined,
    // En développement, MailHog ne présente pas de certificat valide.
    tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
  });

  return transporter;
}

export async function sendMail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer; cid: string }[];
  headers?: Record<string, string>;
}): Promise<void> {
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM ?? 'Les Nuits de la Garonne <billetterie@localhost>',
    ...params,
  });
}
