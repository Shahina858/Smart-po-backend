require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./config/db');
const { checkInbox } = require('./services/gmailService');
const { extractFromPDF, parsePOItems } = require('./services/textinService');
const { matchProduct, getAllCustomerPrices, findCustomerByGmail } = require('./services/matchingService');
const { generateXLS } = require('./services/xlsService');
const { sendPONotification } = require('./services/emailService');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/outputs', express.static(path.join(__dirname, '../outputs')));

app.use('/api/po', require('./routes/po'));
app.use('/api/products', require('./routes/products'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/pricing', require('./routes/pricing'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/reports', require('./routes/reports'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Smart PO Backend running' });
});

// ── MAIN PIPELINE ──────────────────────────────────────────────────────────
async function processPO(emailData) {
  console.log(`\n📧 Processing PO from: ${emailData.from}`);

  try {
    // Step 1: Find customer
    const customer = await findCustomerByGmail(emailData.from);
    if (!customer) {
      console.log(`⚠️  Unknown sender: ${emailData.from} — skipping`);
      return;
    }
    console.log(`✅ Customer found: ${customer.name}`);

    // Step 2: Extract items FIRST so we get real PO number and date
    console.log(`🔍 Extracting items from PDF...`);
    const extractedItems = await extractFromPDF(emailData.pdfPath);
    if (!extractedItems) {
      console.log(`❌ Could not extract items from PDF`);
      return;
    }
   const parsedItems = parsePOItems(extractedItems);
    console.log(`✅ Extracted ${parsedItems.length} items from PDF`);

    // Get real PO number and date from extraction
const rawPONumber = extractedItems.po_number ? String(extractedItems.po_number) : null;
    const realPODate = extractedItems.po_date || null;

    // Pad PO number with leading zeros if numeric (e.g. 832 → 000832)
    const realPONumber = rawPONumber && !isNaN(rawPONumber)
      ? String(rawPONumber).padStart(6, '0')
      : rawPONumber;

    console.log(`📋 PO Number: ${realPONumber || 'not found'}`);
    console.log(`📅 PO Date: ${realPODate || 'not found'}`);
    // Step 3: Save PO with real number and date
    const [poResult] = await db.query(
      `INSERT INTO po_orders 
       (customer_id, po_number, po_date, status, pdf_path, gmail_message_id) 
       VALUES (?,?,?,?,?,?)`,
      [
        customer.id,
        realPONumber || `PO-${Date.now()}`,
        realPODate || new Date().toISOString().split('T')[0],
        'processing',
        emailData.pdfPath,
        emailData.messageId,
      ]
    );
    const poId = poResult.insertId;
    console.log(`✅ PO saved to DB with ID: ${poId}`);

    // Step 4: Match items + apply customer pricing
    console.log(`🔍 Matching items against product database...`);
    const matchedItems = [];
    const unmatchedItems = [];
    const priceMap = await getAllCustomerPrices(customer.id);

    for (const item of parsedItems) {
      const match = await matchProduct(item.product_name);

      if (match && match.confidence >= 60) {
        const price = priceMap[match.pcode] || match.mrp || 0;
        const total = price * item.quantity;

        await db.query(
          `INSERT INTO po_items 
           (po_id, product_name, pcode_matched, pname_matched, quantity, 
            unit_price, total_price, match_status, match_confidence) 
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            poId,
            item.product_name,
            match.pcode,
            match.pname,
            item.quantity,
            price,
            total,
            'matched',
            match.confidence,
          ]
        );

        matchedItems.push({
          product_name: item.product_name,
          pcode: match.pcode,
          pname: match.pname,
          packing: match.packing,
          quantity: item.quantity,
          unit_price: price,
          total_price: total,
          confidence: match.confidence,
        });

        console.log(`  ✅ Matched: ${item.product_name} → ${match.pname} (${match.confidence}%) @ ₹${price}`);
      } else {
        await db.query(
          `INSERT INTO po_items 
           (po_id, product_name, quantity, match_status, match_confidence) 
           VALUES (?,?,?,?,?)`,
          [poId, item.product_name, item.quantity, 'unmatched', 0]
        );
        unmatchedItems.push(item.product_name);
        console.log(`  ❌ No match: ${item.product_name}`);
      }
    }

    // Step 5: Update PO counts
    await db.query(
      `UPDATE po_orders SET 
       total_items=?, matched_items=?, unmatched_items=?, status='matched' 
       WHERE id=?`,
      [parsedItems.length, matchedItems.length, unmatchedItems.length, poId]
    );

    // Step 6: Generate XLS with real PO number and date
    console.log(`📊 Generating XLS file...`);
    const xlsResult = await generateXLS(poId, matchedItems, {
      po_number: realPONumber || `PO-${poId}`,
      po_date: realPODate || new Date().toISOString().split('T')[0],
      customer_name: customer.name,
      ccode: customer.ccode,
    });

    if (xlsResult) {
      console.log(`✅ XLS generated: ${xlsResult.filename}`);
    }

    // Step 7: Send notification
    console.log(`📧 Sending notification email...`);
    await sendPONotification({
      poId,
      customerName: customer.name,
      poNumber: realPONumber || `PO-${poId}`,
      matchedCount: matchedItems.length,
      unmatchedItems,
      xlsFilename: xlsResult?.filename || 'N/A',
    });

    await db.query(
      "UPDATE po_orders SET status='completed' WHERE id=?",
      [poId]
    );

    console.log(`\n🎉 PO ${poId} processed successfully!`);
    console.log(`   Matched: ${matchedItems.length} | Unmatched: ${unmatchedItems.length}`);

  } catch (err) {
    console.error('Pipeline error:', err.message);
  }
}

// ── GMAIL WATCHER ──────────────────────────────────────────────────────────
async function startGmailWatcher() {
  console.log('👀 Gmail watcher started — checking every 30 seconds...');

  async function check() {
    console.log(`\n[${new Date().toLocaleTimeString()}] Checking Gmail inbox...`);
    const emails = await checkInbox();

    if (emails.length === 0) {
      console.log('No new PO emails found.');
    } else {
      console.log(`Found ${emails.length} new PO email(s)!`);
      for (const email of emails) {
        const [existing] = await db.query(
          'SELECT id FROM po_orders WHERE gmail_message_id = ?',
          [email.messageId]
        );
        if (existing.length > 0) continue;
        await processPO(email);
      }
    }
  }

  await check();
  setInterval(check, 30 * 1000);
}

// ── START SERVER ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
  await startGmailWatcher();
});