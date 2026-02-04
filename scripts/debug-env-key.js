
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    let privateKeyRaw = "";
    envConfig.split('\n').forEach(line => {
        if (line.startsWith('FIREBASE_PRIVATE_KEY=')) {
            privateKeyRaw = line.split('FIREBASE_PRIVATE_KEY=')[1];
        }
    });

    console.log("--- DEBUGGING PRIVATE KEY ---");
    console.log("Raw length:", privateKeyRaw.length);
    console.log("Starts with quote:", privateKeyRaw.startsWith('"'));
    console.log("Ends with quote:", privateKeyRaw.trim().endsWith('"'));

    // Simulate what dotenv/shell does? 
    let processed = privateKeyRaw.trim();
    if (processed.startsWith('"') && processed.endsWith('"')) {
        processed = processed.slice(1, -1);
    }

    // Check for literal \n characters
    const hasLiteralSlashN = processed.includes('\\n');
    console.log("Has literal \\n characters:", hasLiteralSlashN);

    // Check for real newlines
    const hasRealNewlines = processed.includes('\n');
    console.log("Has real newlines:", hasRealNewlines);

    // Try to fix it and see what it looks like
    const fixed = processed.replace(/\\n/g, '\n');
    console.log("Fixed key start:", fixed.substring(0, 50));
    console.log("Fixed key line count:", fixed.split('\n').length);
} else {
    console.log("No .env.local found");
}
