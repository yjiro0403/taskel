import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { applyRateLimit } from '@/lib/api/rateLimit';
import { parseJsonBody } from '@/lib/api/request';
import { escapeHtml } from '@/lib/email/escape';
import { sendInvitationEmailSchema } from '@/lib/validations/invitation';

export async function POST(request: Request) {
  try {
    const rateLimitResponse = applyRateLimit(request, {
      key: '/api/invite',
      limit: 5,
      windowMs: 60_000,
    });
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    await requireAuth();

    const { email, projectTitle, inviterName, inviteLink } = await parseJsonBody(
      request,
      sendInvitationEmailSchema
    );
    const safeEmail = escapeHtml(email);
    const safeProjectTitle = escapeHtml(projectTitle);
    const safeInviterName = escapeHtml(inviterName);
    const safeInviteLink = escapeHtml(inviteLink);

    const smtpConfig = {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    };

    const hasCredentials = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;

    console.log('--- Email API Debug ---');
    console.log('Configured Host:', process.env.SMTP_HOST);
    console.log('Configured User:', process.env.SMTP_USER);
    console.log('Has Credentials:', !!hasCredentials);

    if (!hasCredentials) {
      console.log('--- MOCK EMAIL SEND ---');
      console.log(`To: ${email}`);
      console.log(`Subject: Invitation to join ${projectTitle} on Taskel`);
      console.log(`Body: Hi! ${inviterName} invited you to ${projectTitle}. Join here: ${inviteLink}`);
      console.log('-----------------------');
      console.warn('SMTP credentials not found. Email logged to console.');

      return NextResponse.json({
        success: true,
        message: 'Mock email sent (Check server console). Configure SMTP for real emails.',
      });
    }

    const transporter = nodemailer.createTransport(smtpConfig);

    try {
      await transporter.verify();
      console.log('SMTP Connection Verified');
    } catch (verifyErr) {
      console.error('SMTP Connection Failed:', verifyErr);
      return NextResponse.json({ error: 'SMTP Connection Failed. Check server logs.' }, { status: 500 });
    }

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_FROM || '"Taskel" <noreply@taskel.app>',
      to: email,
      subject: `Invitation to join ${projectTitle} on Taskel`,
      html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>You've been invited!</h2>
              <p><strong>${safeInviterName}</strong> has invited you to collaborate on the project <strong>"${safeProjectTitle}"</strong> using Taskel.</p>
              <p>To accept the invitation, please log in or sign up with this email address (${safeEmail}).</p>
              <div style="margin: 32px 0;">
                  <a href="${safeInviteLink}" style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                      Join Project
                  </a>
              </div>
              <p style="color: #666; font-size: 14px;">Or paste this link in your browser: <br>${safeInviteLink}</p>
          </div>
      `,
    });

    console.log('Email sent info:', info.messageId);

    return NextResponse.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    return handleApiError('Email send error', error, 'Failed to send email');
  }
}
