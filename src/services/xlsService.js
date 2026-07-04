const XLSX = require('xlsx');
const path = require('path');
const db = require('../config/db');

async function generateXLS(poId, matchedItems, poData) {
  try {
    const rows = matchedItems.map((item, index) => ({
      PCODE:    item.pcode || item.pcode_matched || '',
      PNAME:    item.pname || item.pname_matched || item.product_name,
      PACKING:  item.packing || '',
      QTY:      item.quantity,
      ORDNO:    poData.po_number || '',
      ORDDT:    poData.po_date || '',
      CCODE:    poData.ccode || '',
      CUSTOMER: poData.customer_name || '',
      COUNTER:  index + 1,
      REMARK:   '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PO Items');

    const filename = `PO_${poData.po_number || poId}_${Date.now()}.xlsx`;
    const outputPath = path.join(__dirname, '../../outputs', filename);
    XLSX.writeFile(wb, outputPath);

    await db.query('UPDATE po_orders SET xls_path=? WHERE id=?', [outputPath, poId]);

    return { outputPath, filename };
  } catch (err) {
    console.error('XLS generation error:', err.message);
    return null;
  }
}

module.exports = { generateXLS };