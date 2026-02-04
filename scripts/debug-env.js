
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
            let value = valueParts.join('=');
            if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
            value = value.replace(/\\n/g, '\n');
            process.env[key.trim()] = value.trim();
        }
    });
}

const pk = process.env.FIREBASE_PRIVATE_KEY || '';

console.log("ProjectId:", process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
console.log("ClientEmail:", process.env.FIREBASE_CLIENT_EMAIL);
console.log("PrivateKey Length:", pk.length);
console.log("Starts with Header:", pk.startsWith('-----BEGIN PRIVATE KEY-----'));
console.log("Ends with Footer:", pk.endsWith('-----END PRIVATE KEY-----'));
console.log("Contains Newlines:", pk.includes('\n'));
console.log("First 30 chars:", pk.substring(0, 30));
console.log("Last 30 chars:", pk.substring(pk.length - 30));
