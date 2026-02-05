import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(request: Request) {
    try {
        const { email, projectTitle, inviterName, inviteLink } = await request.json();

        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }

        // Configure Transporter
        // If env vars are not set, we'll log to console for development
        const smtpConfig = {
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: false, // true for 465, false for other ports
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
                message: 'Mock email sent (Check server console). Configure SMTP for real emails.'
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

        // Send Email
        const info = await transporter.sendMail({
            from: process.env.EMAIL_FROM || process.env.SMTP_FROM || '"Taskel" <noreply@taskel.app>',
            to: email,
            subject: `Invitation to join ${projectTitle} on Taskel`,
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2>You've been invited!</h2>
                    <p><strong>${inviterName}</strong> has invited you to collaborate on the project <strong>"${projectTitle}"</strong> using Taskel.</p>
                    <p>To accept the invitation, please log in or sign up with this email address (${email}).</p>
                    <div style="margin: 32px 0;">
                        <a href="${inviteLink}" style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                            Join Project
                        </a>
                    </div>
                    <p style="color: #666; font-size: 14px;">Or paste this link in your browser: <br>${inviteLink}</p>
                </div>
            `,
        });

        console.log('Email sent info:', info.messageId);

        return NextResponse.json({ success: true, message: 'Email sent successfully' });
    } catch (error) {
        console.error('Email send error:', error);
        return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
    }
}
