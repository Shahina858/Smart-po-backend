const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const Anthropic = require('@anthropic-ai/sdk');
const pdfParse = require('pdf-parse');
require('dotenv').config();

const DOCFLOW_BASE = 'https://docflow.textin.ai';
const WORKSPACE_ID = '1977689068501839872';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function extractWithClaude(text) {
  try {
    console.log('🤖 Claude fallback extraction...');
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Extract ALL product line items from this pharmaceutical purchase order.
Return ONLY a valid JSON object. No explanation. No markdown.

Return this structure:
{
  "po_number": "the PO number from the document",
  "po_date": "the PO date in YYYY-MM-DD format",
  "items": [
    {
      "product_name": "medicine/product name",
      "quantity": 10,
      "unit_price": 0,
      "hsn_code": ""
    }
  ]
}

Skip: headers, totals, tax rows. Only real products in items array.

Purchase Order Data:
${text.substring(0, 5000)}

JSON only:`,
      }],
    });

    const responseText = message.content[0].text.trim();
    console.log('🤖 Claude:', responseText.substring(0, 500));

   // Try object format first (with po_number, po_date, items)
    const objMatch = responseText.match(/\{[\s\S]*\}/);
    if (objMatch) {
      const parsed = JSON.parse(objMatch[0]);
      if (parsed.items) {
        console.log(`✅ Claude extracted ${parsed.items.length} items`);
        // Attach metadata to items array
        const items = parsed.items;
        items.po_number = parsed.po_number;
        items.po_date = parsed.po_date;
        return items;
      }
      // Fallback: array format
      const arrMatch = responseText.match(/\[[\s\S]*\]/);
      if (arrMatch) {
        const items = JSON.parse(arrMatch[0]);
        return items;
      }
    }
    console.log('❌ Could not parse Claude response');
    return null;
  } catch (err) {
    console.error('Claude error:', err.message);
    return null;
  }
}

async function extractFromPDFLocally(pdfPath) {
  try {
    const buffer = fs.readFileSync(pdfPath);
    const data = await pdfParse(buffer);
    console.log(`📄 Extracted ${data.text.length} chars`);
    console.log('Sample:', data.text.substring(0, 300));
    return data.text;
  } catch (err) {
    console.log('❌ pdf-parse error:', err.message);
    return null;
  }
}
async function extractFromPDF(pdfPath) {
  try {
    console.log(`📤 Uploading to DocFlow: ${pdfPath}`);

    const formData = new FormData();
    formData.append('file', fs.createReadStream(pdfPath), {
      filename: 'purchase_order.pdf',
      contentType: 'application/pdf',
    });

    const uploadRes = await axios.post(
      `${DOCFLOW_BASE}/api/app-api/sip/platform/v2/file/upload`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'x-ti-app-id': process.env.TEXTIN_APP_ID,
          'x-ti-secret-code': process.env.TEXTIN_SECRET,
        },
        params: { workspace_id: WORKSPACE_ID },
        timeout: 60000,
      }
    );

    console.log('Upload:', JSON.stringify(uploadRes.data).substring(0, 200));

    if (uploadRes.data?.code !== 200) {
      console.log('❌ Upload failed — Claude fallback...');
      const text = await extractFromPDFLocally(pdfPath);
      return text ? await extractWithClaude(text) : null;
    }

    const fileId = uploadRes.data?.result?.files?.[0]?.id;
    console.log(`✅ Uploaded — file_id: ${fileId}`);

    console.log('⏳ Waiting 12 seconds...');
    await new Promise(r => setTimeout(r, 12000));

    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 6000));
      console.log(`🔍 Attempt ${i + 1}...`);

      const fetchRes = await axios.get(
        `${DOCFLOW_BASE}/api/app-api/sip/platform/v2/file/fetch`,
        {
          headers: {
            'x-ti-app-id': process.env.TEXTIN_APP_ID,
            'x-ti-secret-code': process.env.TEXTIN_SECRET,
          },
          params: { workspace_id: WORKSPACE_ID, file_id: fileId },
        }
      );

      const file = fetchRes.data?.result?.files?.[0];
      if (!file) { console.log('⏳ No file yet...'); continue; }

      console.log(`Status: ${file.recognition_status}`);
      console.log(`Data keys: ${Object.keys(file.data || {}).join(', ')}`);

      // DocFlow failed — Claude fallback
      if (file.recognition_status === 4) {
        console.log('⚠️ DocFlow status=4 — switching to Claude fallback...');
        const text = await extractFromPDFLocally(pdfPath);
        return text ? await extractWithClaude(text) : null;
      }

      // DocFlow succeeded
      const hasData = file.data?.fields?.length > 0 || file.data?.tables?.length > 0;

      if (file.recognition_status === 3 || hasData) {
        console.log('✅ DocFlow extraction complete!');

        let text = '';

        if (file.data?.fields?.length > 0) {
          text += '=== HEADER ===\n';
          file.data.fields
            .filter(f => f.value)
            .forEach(f => { text += `${f.key}: ${f.value}\n`; });
          text += '\n';
        }

        if (file.data?.tables?.length > 0) {
          text += '=== PRODUCTS ===\n';
          for (const table of file.data.tables) {
            const rows = table.items || [];
            for (const row of rows) {
              if (Array.isArray(row)) {
                const firstCell = row[0]?.value || '';
                if (firstCell.includes('\t')) {
                  text += firstCell.split('\t').join(' | ') + '\n';
                } else {
                  text += row.map(c => (c.value || '').replace(/\t/g, ' ')).join(' | ') + '\n';
                }
              }
            }
          }
        }

        console.log(`📄 DocFlow text (${text.length} chars):`);
        console.log(text.substring(0, 500));

        if (text.length < 30) {
          console.log('⚠️ Not enough DocFlow data — Claude fallback...');
          const rawText = await extractFromPDFLocally(pdfPath);
          return rawText ? await extractWithClaude(rawText) : null;
        }

        return await extractWithClaude(text);
      }

      console.log('⏳ Still processing...');
    }

    // Timeout — Claude fallback
    console.log('❌ Timeout — Claude fallback...');
    const text = await extractFromPDFLocally(pdfPath);
    return text ? await extractWithClaude(text) : null;

  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
    return null;
  }
}

function parsePOItems(items) {
  if (!items || !Array.isArray(items)) return [];
  return items
    .filter(i => i.product_name && String(i.product_name).trim().length > 1)
    .map(i => ({
      product_name: String(i.product_name).trim(),
      quantity: parseInt(i.quantity) || 1,
      unit_price: parseFloat(i.unit_price) || 0,
      hsn_code: String(i.hsn_code || ''),
    }));
}

module.exports = { extractFromPDF, parsePOItems };