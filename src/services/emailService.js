const { sendNotification } = require('./gmailService');
require('dotenv').config();

async function sendPONotification({ poId, customerName, poNumber, matchedCount, unmatchedItems, xlsFilename }) {
  const frontendUrl = process.env.FRONTEND_URL;
  const reviewLink = `${frontendUrl}/po/review/${poId}`;

  const unmatchedList = unmatchedItems.length > 0
    ? `<ul>${unmatchedItems.map(i => `<li style="color:red">${i}</li>`).join('')}</ul>`
    : '<p style="color:green">All items matched ✅</p>';

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
      <div style="background:#0d9488;padding:20px;border-radius:8px 8px 0 0">
       <h2 style="color:white;margin:0">New Purchase Order Received</h2>
      </div>
      <div style="padding:20px;border:1px solid #e2e8f0;border-radius:0 0 8px 8px">
        <p><b>Customer:</b> ${customerName}</p>
        <p><b>PO Number:</b> ${poNumber}</p>
        <p><b>Matched Items:</b> ${matchedCount}</p>
        
        <h3 style="color:#ef4444">⚠️ Items NOT in Database (excluded from XLS):</h3>
        ${unmatchedList}
        
        <div style="text-align:center;margin:30px 0">
          <a href="${reviewLink}" 
             style="background:#0d9488;color:white;padding:12px 30px;
                    border-radius:6px;text-decoration:none;font-size:16px">
            👉 Review XLS File
          </a>
        </div>
        
        <p style="color:#64748b;font-size:12px">
          XLS File: ${xlsFilename}<br/>
          Click the button above to view, edit and download the file.
        </p>
      </div>
    </div>
  `;

  await sendNotification({
    to: process.env.GMAIL_USER,
    subject: `New PO from ${customerName} - ${matchedCount} items matched`,
    htmlBody,
  });
}

module.exports = { sendPONotification };