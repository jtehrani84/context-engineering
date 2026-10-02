/**
 * Sheet Data Puller — Context Engineering Template
 *
 * Exposes a Google Sheet as a JSON API endpoint.
 * Deploy as a web app and call it from Claude, middleware,
 * or any HTTP client to pull structured Sheet data.
 *
 * Setup:
 *   1. Set SHEET_ID below
 *   2. clasp push && clasp deploy
 *   3. Call the deployment URL with ?tab=Sheet1&format=records
 *
 * Query params:
 *   tab     — Sheet tab name (default: Sheet1)
 *   format  — "records" (array of objects) or "rows" (2D array)
 *   limit   — max rows to return (default: all)
 *   offset  — rows to skip (default: 0)
 *   filter  — column:value to filter on (e.g., filter=Status:Active)
 */

// --- CONFIG ---
const SHEET_ID = 'YOUR_SHEET_ID_HERE';

function doGet(e) {
  try {
    const params = e.parameter || {};
    const tabName = params.tab || 'Sheet1';
    const format = params.format || 'records';
    const limit = params.limit ? parseInt(params.limit) : null;
    const offset = params.offset ? parseInt(params.offset) : 0;
    const filter = params.filter || null;

    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(tabName);
    if (!sheet) {
      return jsonResponse({ error: 'Tab not found: ' + tabName }, 404);
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return jsonResponse({ data: [], count: 0 });
    }

    const headers = data[0].map(function(h) {
      return h.toString().trim();
    });
    var rows = data.slice(1);

    // Apply filter
    if (filter) {
      const parts = filter.split(':');
      if (parts.length === 2) {
        const colIndex = headers.indexOf(parts[0]);
        if (colIndex >= 0) {
          rows = rows.filter(function(row) {
            return row[colIndex] && row[colIndex].toString() === parts[1];
          });
        }
      }
    }

    // Apply offset and limit
    rows = rows.slice(offset);
    if (limit) {
      rows = rows.slice(0, limit);
    }

    var result;
    if (format === 'records') {
      result = rows.map(function(row) {
        var obj = {};
        headers.forEach(function(header, i) {
          obj[header] = row[i];
        });
        return obj;
      });
    } else {
      result = [headers].concat(rows);
    }

    return jsonResponse({
      data: result,
      count: result.length,
      tab: tabName,
      headers: headers
    });

  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

function jsonResponse(data, code) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Test locally — run this function to verify Sheet access.
 */
function testPull() {
  const mockEvent = { parameter: { tab: 'Sheet1', format: 'records', limit: '5' } };
  const response = doGet(mockEvent);
  Logger.log(response.getContent());
}
