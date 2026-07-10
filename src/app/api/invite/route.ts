import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { requireAuth, handleAuthError } from '@/lib/apiAuth';
import { escapeHtml } from '@/lib/escapeHtml';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';

// 単一メールアドレスのみ許可（カンマ区切りでの一斉送信＝スパム中継を防ぐ）
const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export async function POST(request: Request) {
    try {
        // 認証必須。以前は無認証で誰でもメール送信でき、フィッシング/スパムの
        // 中継地点にされ得た（Taskel ドメイン詐称）。
        const authed = await requireAuth(request);

        // レート制限（1ユーザーあたり 10 分で 10 通まで）
        const limit = rateLimit(`invite:${authed.uid}`, 10, 10 * 60 * 1000);
        if (!limit.ok) return rateLimitResponse(limit);

        const { email, projectTitle, inviteLink } = await request.json();

        if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
            return NextResponse.json({ error: 'A single valid email is required' }, { status: 400 });
        }

        // 招待リンクは同一オリジンのみ許可（オープンリダイレクト/フィッシング防止）
        const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || '';
        if (inviteLink && origin && !String(inviteLink).startsWith(origin)) {
            return NextResponse.json({ error: 'Invalid invite link' }, { status: 400 });
        }

        // 差込値はすべてエスケープ。inviterName は認証済みトークン由来に固定。
        const safeInviter = escapeHtml(authed.name || 'A Taskel user');
        const safeProject = escapeHtml(projectTitle || 'a project');
        const safeEmail = escapeHtml(email);
        const safeLink = escapeHtml(inviteLink || '');

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

        if (!hasCredentials) {
            // 本番のログに宛先・本文・SMTP 構成を残さない（情報漏洩面の縮小）
            console.warn('SMTP credentials not configured. Invitation email skipped.');
            return NextResponse.json({
                success: true,
                message: 'SMTP not configured. Email was not sent.',
            });
        }

        const transporter = nodemailer.createTransport(smtpConfig);

        try {
            await transporter.verify();
        } catch (verifyErr) {
            console.error('SMTP Connection Failed:', verifyErr);
            return NextResponse.json({ error: 'SMTP Connection Failed. Check server logs.' }, { status: 500 });
        }

        await transporter.sendMail({
            from: process.env.EMAIL_FROM || process.env.SMTP_FROM || '"Taskel" <noreply@taskel.app>',
            to: email,
            subject: `Invitation to join ${projectTitle ?? 'a project'} on Taskel`,
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2>You've been invited!</h2>
                    <p><strong>${safeInviter}</strong> has invited you to collaborate on the project <strong>"${safeProject}"</strong> using Taskel.</p>
                    <p>To accept the invitation, please log in or sign up with this email address (${safeEmail}).</p>
                    <div style="margin: 32px 0;">
                        <a href="${safeLink}" style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                            Join Project
                        </a>
                    </div>
                    <p style="color: #666; font-size: 14px;">Or paste this link in your browser: <br>${safeLink}</p>
                </div>
            `,
        });

        return NextResponse.json({ success: true, message: 'Email sent successfully' });
    } catch (error) {
        const authErr = handleAuthError(error);
        if (authErr) return authErr;

        console.error('Email send error:', error);
        return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
    }
}
