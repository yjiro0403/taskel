
const https = require('https');

console.log("Testing connectivity to accounts.google.com...");

const req = https.request({
    hostname: 'accounts.google.com',
    port: 443,
    path: '/',
    method: 'GET'
}, (res) => {
    console.log(`✅ Status Code: ${res.statusCode}`);
    console.log("Connectivity check pass.");
});

req.on('error', (e) => {
    console.error(`❌ Connectivity Error: ${e.message}`);
});

req.end();
