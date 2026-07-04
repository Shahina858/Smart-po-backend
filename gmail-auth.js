 
const { google } = require('googleapis');
const fs = require('fs');
const readline = require('readline');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify'
];

const CREDENTIALS_PATH = './gmail-credentials.json';
const TOKEN_PATH = './gmail-token.json';

async function authenticate() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  
  const oAuth2Client = new google.auth.OAuth2(
    client_id, client_secret, redirect_uris[0]
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('\n✅ Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('After login, paste the code here: ', async (code) => {
    rl.close();
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    console.log('\n✅ Gmail token saved to gmail-token.json');
    console.log('✅ Gmail authentication complete!');
  });
}

authenticate();