import * as admin from 'firebase-admin';

function formatPrivateKey(key: string) {
    return key.replace(/\\n/g, '\n');
}

export function initAdmin() {
    if (!admin.apps.length) {
        // Preferred: Use GOOGLE_APPLICATION_CREDENTIALS if set (handled by applicationDefault)
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            try {
                admin.initializeApp({
                    credential: admin.credential.applicationDefault(),
                    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, // Explicitly set project ID just in case
                });
                console.log("Firebase Admin initialized via GOOGLE_APPLICATION_CREDENTIALS");
                return;
            } catch (error) {
                console.error("Firebase Admin Init Error (Application Default):", error);
                // Fallthrough to try manual method if this fails? usually fatal.
                throw error;
            }
        }

        if (process.env.FIREBASE_PRIVATE_KEY) {
            if (!process.env.FIREBASE_CLIENT_EMAIL) {
                // Warn but don't crash during build if possible, or throw
                throw new Error('Missing FIREBASE_CLIENT_EMAIL');
            }
            try {
                admin.initializeApp({
                    credential: admin.credential.cert({
                        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
                        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                        privateKey: formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY),
                    }),
                });
            } catch (error) {
                console.error('Firebase Admin Init Error (Cert):', error);
                // Throwing here might crash build if called
                throw error;
            }
        } else {
            admin.initializeApp({
                credential: admin.credential.applicationDefault(),
            });
        }
    }
}

export function getDb() {
    initAdmin();
    return admin.firestore();
}

export function getAuth() {
    initAdmin();
    return admin.auth();
}
