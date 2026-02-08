
import { NextResponse } from 'next/server';
import { getAuth, getDb } from '@/lib/firebaseAdmin';
import { Invitation } from '@/types';
import nodemailer from 'nodemailer';

export async function POST(request: Request, props: { params: Promise<{ projectId: string }> }) {
    try {
        const params = await props.params;
        const { projectId } = params;
        const authHeader = request.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const token = authHeader.split('Bearer ')[1];

        let inviterId;
        let inviterName = 'A Taskel user'; // Fallback

        try {
            const decodedToken = await getAuth().verifyIdToken(token);
            inviterId = decodedToken.uid;
            inviterName = decodedToken.name || decodedToken.email || 'A Taskel user';
        } catch (authError) {
            console.error('Auth verification failed:', authError);
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { email, role } = await request.json();

        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }

        const db = getDb();

        // Verify Project
        const projectRef = db.collection('projects').doc(projectId);
        const projectSnap = await projectRef.get();
        if (!projectSnap.exists) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        const projectData = projectSnap.data();
        if (!projectData) {
            return NextResponse.json({ error: 'Project data missing' }, { status: 500 });
        }

        const userRole = projectData.roles?.[inviterId];
        const isOwner = projectData.ownerId === inviterId;

        if (!isOwner && userRole !== 'owner' && userRole !== 'admin') {
            return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
        }

        // Create Invitation
        const inviteId = crypto.randomUUID();
        const now = Date.now();
        const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days

        const invitation: Invitation = {
            id: inviteId,
            projectId,
            email,
            role: role || 'member',
            inviterId,
            status: 'pending',
            createdAt: now,
            expiresAt,
            isReusable: false
        };

        await db.collection('invitations').doc(inviteId).set(invitation);

        // Generate Join Link
        const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'https://taskel.vercel.app';
        const joinLink = `${origin}/join?token=${inviteId}`;
        const projectTitle = projectData.title || 'Untitled Project';

        // Send Email
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
            console.log('--- MOCK EMAIL SEND ---');
            console.log(`To: ${email}`);
            console.log(`Link: ${joinLink}`);
            console.log('-----------------------');
            // Allow success even if mock
        } else {
            const transporter = nodemailer.createTransport(smtpConfig);
            await transporter.verify();
            await transporter.sendMail({
                from: process.env.EMAIL_FROM || process.env.SMTP_FROM || '"Taskel" <noreply@taskel.app>',
                to: email,
                subject: `Invitation to join ${projectTitle} on Taskel`,
                html: `
                    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2>You've been invited!</h2>
                        <p><strong>${inviterName}</strong> has invited you to collaborate on the project <strong>"${projectTitle}"</strong> using Taskel.</p>
                        <p>To accept the invitation, please click the button below:</p>
                        <div style="margin: 32px 0;">
                            <a href="${joinLink}" style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                                Join Project
                            </a>
                        </div>
                        <p style="color: #666; font-size: 14px;">Or paste this link in your browser: <br>${joinLink}</p>
                    </div>
                `,
            });
        }

        return NextResponse.json({ success: true, message: 'Invitation sent' });

    } catch (error) {
        console.error('Error sending invitation:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
