/**
 * Email Merge — Context Engineering Template
 *
 * Sends personalized emails from a Google Sheet.
 * Each row = one recipient. Columns map to merge fields
 * in the email template.
 *
 * Setup:
 *   1. Create a Sheet with columns: Email, Name, Company, Subject, (+ any custom fields)
 *   2. Set SHEET_ID below
 *   3. Edit the TEMPLATE below with your merge fields: {{Name}}, {{Company}}, etc.
 *   4. Run sendEmails() — or call via web app
 *
 * Safety:
 *   - Adds a "Sent" column and marks each row after sending
 *   - Skips rows already marked "Sent"
 *   - Respects Gmail daily quota (~1,500 for Workspace, ~100 for personal)
 */

// --- CONFIG ---
const SHEET_ID = 'YOUR_SHEET_ID_HERE';
const SHEET_TAB = 'Sheet1';
const SENDER_NAME = 'Your Name'; // Display name on sent emails
const DRY_RUN = true; // Set false to actually send. Leave true for testing.

// --- EMAIL TEMPLATE ---
// Use {{ColumnHeader}} for merge fields. Matches Sheet column headers exactly.
const SUBJECT_TEMPLATE = '{{Subject}}';
const BODY_TEMPLATE = `Hi {{Name}},

Following up on our conversation about {{Company}}'s priorities this quarter.

{{CustomMessage}}

Would {{MeetingDay}} work for a 30-minute follow-up? I'd like to walk through a few scenarios specific to your team.

Best,
${SENDER_NAME}`;

function sendEmails() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_TAB);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(function(h) { return h.toString().trim(); });
  const rows = data.slice(1);

  // Find or create "Sent" column
  var sentCol = headers.indexOf('Sent');
  if (sentCol < 0) {
    sentCol = headers.length;
    sheet.getRange(1, sentCol + 1).setValue('Sent');
  }

  const emailCol = headers.indexOf('Email');
  if (emailCol < 0) {
    Logger.log('ERROR: No "Email" column found in headers: ' + headers.join(', '));
    return;
  }

  var sentCount = 0;
  var skipCount = 0;

  rows.forEach(function(row, i) {
    // Skip if already sent
    if (row[sentCol] === 'Sent') {
      skipCount++;
      return;
    }

    const email = row[emailCol];
    if (!email || !email.toString().includes('@')) {
      return;
    }

    // Build merge map from headers
    var mergeMap = {};
    headers.forEach(function(header, j) {
      mergeMap[header] = row[j] ? row[j].toString() : '';
    });

    // Apply merge fields to template
    var subject = SUBJECT_TEMPLATE;
    var body = BODY_TEMPLATE;

    Object.keys(mergeMap).forEach(function(key) {
      var placeholder = '{{' + key + '}}';
      subject = subject.split(placeholder).join(mergeMap[key]);
      body = body.split(placeholder).join(mergeMap[key]);
    });

    if (DRY_RUN) {
      Logger.log('DRY RUN — would send to: ' + email);
      Logger.log('Subject: ' + subject);
      Logger.log('Body: ' + body.substring(0, 200) + '...');
      Logger.log('---');
    } else {
      GmailApp.sendEmail(email, subject, body, {
        name: SENDER_NAME,
        htmlBody: body.replace(/\n/g, '<br>')
      });

      // Mark as sent
      sheet.getRange(i + 2, sentCol + 1).setValue('Sent');
    }

    sentCount++;
  });

  var summary = DRY_RUN
    ? 'DRY RUN complete. Would send ' + sentCount + ' emails. Skipped ' + skipCount + ' already sent.'
    : 'Sent ' + sentCount + ' emails. Skipped ' + skipCount + ' already sent.';

  Logger.log(summary);
  return summary;
}

/**
 * Web app entry point.
 * GET request triggers the merge. Include ?dryrun=false to actually send.
 */
function doGet(e) {
  var params = e.parameter || {};
  if (params.dryrun === 'false') {
    DRY_RUN = false;
  }
  var result = sendEmails();
  return ContentService
    .createTextOutput(JSON.stringify({ result: result, dryRun: DRY_RUN }))
    .setMimeType(ContentService.MimeType.JSON);
}
