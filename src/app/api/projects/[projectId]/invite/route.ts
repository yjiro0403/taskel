import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

import { requireAuth } from '@/lib/api/auth';
import { handleApiError } from '@/lib/api/errors';
import { applyRateLimit } from '@/lib/api/rateLimit';
import { parseJsonBody } from '@/lib/api/request';
import { getAppUrl } from '@/lib/api/url';
import { escapeHtml } from '@/lib/email/escape';
import { createClient } from '@/lib/supabase/server';
import { projectInviteRequestSchema } from '@/lib/validations/project';

export async function POST(request: Request, props: { params: Promise<{ projectId: string }> }) {
    try {
        const params = await props.params;
        const { projectId } = params;
        const rateLimitResponse = applyRateLimit(request, {
            key: `/api/projects/${projectId}/invite`,
            limit: 5,
            windowMs: 60_000,
        });
        if (rateLimitResponse) {
            return rateLimitResponse;
        }

        const user = await requireAuth();
        const inviterName =
            user.user_metadata?.display_name ||
            user.user_metadata?.full_name ||
            user.email ||
            'A Taskel user';
        const { email, role } = await parseJsonBody(request, projectInviteRequestSchema);
        const supabase = await createClient();

        const { data: canManageProject, error: permissionError } = await supabase.rpc('can_manage_project', {
            project_uuid: projectId,
        });

        if (permissionError) {
            throw permissionError;
        }

        if (!canManageProject) {
            return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
        }

        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('title')
            .eq('id', projectId)
            .single();

        if (projectError) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        const smtpPort = Number(process.env.SMTP_PORT) || 587;
        const hasCredentials = Boolean(
            process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
        );

        // Do not create an invitation that cannot be delivered, and never log
        // invitation tokens as a production fallback.
        if (!hasCredentials) {
            console.error('Invitation email delivery is unavailable because SMTP is not configured.');
            return NextResponse.json(
                { error: 'Invitation email delivery is not configured.' },
                { status: 503 }
            );
        }

        const smtpConfig = {
            host: process.env.SMTP_HOST,
            port: smtpPort,
            secure: process.env.SMTP_SECURE === 'true' || smtpPort === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        };
        const transporter = nodemailer.createTransport(smtpConfig);
        await transporter.verify();

        // Atomically consume a durable per-account allowance. The backing
        // table is not exposed to authenticated clients, so this cannot be
        // bypassed by deleting invitation rows or racing parallel requests.
        const { data: invitationAllowed, error: invitationLimitError } = await supabase.rpc(
            'consume_invitation_send_attempt'
        );

        if (invitationLimitError) {
            throw invitationLimitError;
        }

        if (!invitationAllowed) {
            return NextResponse.json(
                { error: 'Too many invitations. Try again later.' },
                { status: 429, headers: { 'Retry-After': '3600' } }
            );
        }

        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: invitation, error: insertError } = await supabase
            .from('invitations')
            .insert({
                project_id: projectId,
                email,
                role: role || 'member',
                inviter_id: user.id,
                status: 'pending',
                expires_at: expiresAt,
                is_reusable: false,
            })
            .select('id')
            .single();

        if (insertError) {
            throw insertError;
        }

        const joinLink = `${getAppUrl()}/join?token=${invitation.id}`;
        const projectTitle = (project.title || 'Untitled Project').replace(/[\r\n]+/g, ' ');
        const safeInviterName = escapeHtml(inviterName);
        const safeInviterEmail = escapeHtml(user.email || 'verified Taskel account');
        const safeProjectTitle = escapeHtml(projectTitle);
        const safeEmail = escapeHtml(email);
        const safeJoinLink = escapeHtml(joinLink);

        try {
            await transporter.sendMail({
                from: process.env.EMAIL_FROM || process.env.SMTP_FROM || '"Taskel" <noreply@taskel.app>',
                to: email,
                subject: `Invitation to join ${projectTitle} on Taskel`,
                html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2>You've been invited!</h2>
                    <p><strong>${safeInviterName}</strong> (${safeInviterEmail}) has invited you to collaborate on the project <strong>"${safeProjectTitle}"</strong> using Taskel.</p>
                    <p>To accept the invitation, please click the button below:</p>
                    <div style="margin: 32px 0;">
                        <a href="${safeJoinLink}" style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                            Join Project
                        </a>
                    </div>
                    <p style="color: #666; font-size: 14px;">Or paste this link in your browser: <br>${safeJoinLink}</p>
                    <p style="color: #666; font-size: 14px;">Please sign in or sign up with this email address: ${safeEmail}</p>
                </div>
            `,
            });
        } catch (deliveryError) {
            const { error: cleanupError } = await supabase
                .from('invitations')
                .delete()
                .eq('id', invitation.id)
                .eq('inviter_id', user.id)
                .eq('status', 'pending');

            if (cleanupError) {
                console.error('Failed to remove an undelivered invitation:', cleanupError);
            }

            throw deliveryError;
        }

        return NextResponse.json({ success: true, message: 'Invitation sent' });
    } catch (error) {
        return handleApiError('Error sending invitation', error);
    }
}
