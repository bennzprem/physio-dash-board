const { google } = require('googleapis');
const readline = require('readline');
require('dotenv').config({ path: '.env.local' }); // Load your .env variables

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Define the scope: We need access to manage Calendar events
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

// Generate the URL for the user to log in
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline', // Crucial: This asks for the Refresh Token
  scope: SCOPES,
});

console.log('Authorize this app by visiting this url:\n', authUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('\nEnter the code from that page here: ', async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\nSUCCESS! Here is your Refresh Token:');
    console.log('\n' + tokens.refresh_token);
    console.log('\nCopy this token and paste it into your .env.local file as GOOGLE_REFRESH_TOKEN=...');
  } catch (error) {
    console.error('Error retrieving access token', error);
  }
  rl.close();
});