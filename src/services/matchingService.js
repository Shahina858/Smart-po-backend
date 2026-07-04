const db = require('../config/db');

async function matchProduct(productName) {
  if (!productName) return null;

  const name = productName.trim().toUpperCase();

  // Try 0: Check alias table FIRST — 100% accuracy for known mappings
  const [alias] = await db.query(
    'SELECT pa.pcode, pa.pname, p.packing, p.manufacturer, p.stock, p.mrp FROM product_aliases pa LEFT JOIN products p ON pa.pcode = p.pcode WHERE UPPER(pa.hospital_name) = ?',
    [name]
  );
  if (alias.length > 0) return { ...alias[0], confidence: 100 };

  // Try 1: exact match
  const [exact] = await db.query(
    'SELECT * FROM products WHERE UPPER(pname) = ?', [name]
  );
  if (exact.length > 0) return { ...exact[0], confidence: 100 };

  // Try 2: DB name contains search term
  if (name.length >= 6) {
    const [contains] = await db.query(
      'SELECT * FROM products WHERE UPPER(pname) LIKE ?', [`%${name}%`]
    );
    if (contains.length > 0) return { ...contains[0], confidence: 85 };
  }

  // Try 3: search contains DB name
  const [reverse] = await db.query(
    'SELECT * FROM products WHERE ? LIKE CONCAT("%", UPPER(pname), "%") AND LENGTH(pname) >= 6',
    [name]
  );
  if (reverse.length > 0) return { ...reverse[0], confidence: 75 };

  // Try 4: brand + strength number
  const cleaned = name
    .replace(/\b(MG|MCG|ML|GM|TAB|TABLET|CAP|CAPSULE|INJ|INJECTION|SYR|SYRUP|SACHET|POWDER|DROPS|CREAM|GEL|OINTMENT|SOLUTION|SUSPENSION)\b/g, '')
    .replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').filter(w => w.length > 2);
  const numMatch = name.match(/[\d.]+/g);

  if (words.length >= 1) {
    if (numMatch && numMatch.length > 0) {
      const [brandNum] = await db.query(
        'SELECT * FROM products WHERE UPPER(pname) LIKE ? AND UPPER(pname) LIKE ? LIMIT 1',
        [`%${words[0]}%`, `%${numMatch[0]}%`]
      );
      if (brandNum.length > 0) return { ...brandNum[0], confidence: 72 };
    }

    if (words.length >= 2) {
      const [twoWords] = await db.query(
        'SELECT * FROM products WHERE UPPER(pname) LIKE ? AND UPPER(pname) LIKE ? LIMIT 1',
        [`%${words[0]}%`, `%${words[1]}%`]
      );
      if (twoWords.length > 0) return { ...twoWords[0], confidence: 70 };
    }

    if (words[0].length >= 5) {
      const [single] = await db.query(
        'SELECT * FROM products WHERE UPPER(pname) LIKE ? LIMIT 1',
        [`%${words[0]}%`]
      );
      if (single.length > 0) return { ...single[0], confidence: 60 };
    }
  }

  return null;
}

// Get price for a specific product for a customer this month
async function getProductPrice(customerId, pcode) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const [rows] = await db.query(
    `SELECT price FROM customer_pricing 
     WHERE customer_id=? AND pcode=? AND month=? AND year=?`,
    [customerId, pcode, month, year]
  );

  return rows.length > 0 ? parseFloat(rows[0].price) : null;
}

// Get all prices for a customer this month
async function getAllCustomerPrices(customerId) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const [rows] = await db.query(
    `SELECT pcode, price FROM customer_pricing 
     WHERE customer_id=? AND month=? AND year=?`,
    [customerId, month, year]
  );

  // Return as object: { pcode: price }
  const priceMap = {};
  rows.forEach(r => { priceMap[r.pcode] = parseFloat(r.price); });
  return priceMap;
}

async function findCustomerByGmail(gmailAddress) {
  const emailMatch = gmailAddress.match(/<(.+)>/) || [null, gmailAddress];
  const email = emailMatch[1].trim().toLowerCase();

  const [rows] = await db.query(
    'SELECT * FROM customers WHERE LOWER(gmail) = LOWER(?)', [email]
  );
  return rows.length > 0 ? rows[0] : null;
}

module.exports = { matchProduct, getProductPrice, getAllCustomerPrices, findCustomerByGmail };