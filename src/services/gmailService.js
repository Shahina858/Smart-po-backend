const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, '../../gmail-credentials.json');
const TOKEN_PATH = path.join(__dirname, '../../gmail-token.json');

function getAuth() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

// Check inbox for new PO emails with PDF attachments
async function checkInbox() {
  try {
    const auth = getAuth();
    const gmail = google.gmail({ version: 'v1', auth });

    const res = await gmail.users.messages.list({
      userId: 'me',
q: 'has:attachment filename:pdf newer_than:7d',     maxResults: 10,
    });

    const messages = res.data.messages || [];
    const results = [];

    for (const msg of messages) {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
      });

      const headers = full.data.payload.headers;
      const from = headers.find(h => h.name === 'From')?.value || '';
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const date = headers.find(h => h.name === 'Date')?.value || '';

      // Find PDF attachments
      const parts = full.data.payload.parts || [];
      const pdfParts = parts.filter(p =>
        p.filename && p.filename.toLowerCase().endsWith('.pdf')
      );

      for (const part of pdfParts) {
        const attRes = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: msg.id,
          id: part.body.attachmentId,
        });

        const pdfData = Buffer.from(attRes.data.data, 'base64');
        const filename = `po_${Date.now()}_${part.filename}`;
        const savePath = path.join(__dirname, '../../uploads', filename);
        fs.writeFileSync(savePath, pdfData);

        results.push({
          messageId: msg.id,
          from,
          subject,
          date,
          pdfPath: savePath,
          filename,
        });
      }

      // Mark email as read
      await gmail.users.messages.modify({
        userId: 'me',
        id: msg.id,
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    }

    return results;
  } catch (err) {
    console.error('Gmail check error:', err.message);
    return [];
  }
}

// Send notification email to team
async function sendNotification({ to, subject, htmlBody }) {
  try {
    const auth = getAuth();
    const gmail = google.gmail({ version: 'v1', auth });

    const message = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      htmlBody,
    ].join('\n');

    const encoded = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded },
    });

    console.log(`✅ Email sent to ${to}`);
    return true;
  } catch (err) {
    console.error('Email send error:', err.message);
    return false;
  }
}

module.exports = { checkInbox, sendNotification };