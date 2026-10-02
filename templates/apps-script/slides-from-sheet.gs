/**
 * Slides from Sheet — Context Engineering Template
 *
 * Reads rows from a Google Sheet and creates a Slides deck
 * with one slide per row. Each slide gets a title and body
 * populated from the Sheet columns.
 *
 * Setup:
 *   1. Create a Sheet with headers: Company, Headline, Details
 *   2. Set SHEET_ID and DECK_ID below
 *   3. Run createDeck()
 *
 * Columns:
 *   A: Company name (becomes slide title)
 *   B: Headline (subtitle or key message)
 *   C: Details (body text — bullet points separated by |)
 */

// --- CONFIG ---
const SHEET_ID = 'YOUR_SHEET_ID_HERE';
const DECK_ID = 'YOUR_DECK_ID_HERE'; // leave empty to create a new deck
const SHEET_TAB = 'Sheet1';

function createDeck() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_TAB);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1).filter(row => row[0]); // skip empty rows

  let deck;
  if (DECK_ID) {
    deck = SlidesApp.openById(DECK_ID);
  } else {
    deck = SlidesApp.create('Account Briefing — ' + new Date().toLocaleDateString());
  }

  // Remove default blank slide if creating new
  if (!DECK_ID && deck.getSlides().length === 1) {
    deck.getSlides()[0].remove();
  }

  rows.forEach(function(row) {
    const company = row[0];
    const headline = row[1];
    const details = row[2];

    const slide = deck.appendSlide(SlidesApp.PredefinedLayout.TITLE_AND_BODY);
    const shapes = slide.getShapes();

    // Title
    shapes[0].getText().setText(company);

    // Body — split on | for bullet points
    const bodyText = details ? details.toString().split('|').join('\n') : '';
    const fullBody = headline + '\n\n' + bodyText;
    shapes[1].getText().setText(fullBody);

    // Style the title
    shapes[0].getText().getTextStyle()
      .setFontSize(28)
      .setBold(true);

    // Style the headline (first line of body)
    if (headline) {
      shapes[1].getText().getRange(0, headline.length).getTextStyle()
        .setFontSize(18)
        .setBold(true);
    }
  });

  Logger.log('Deck created: ' + deck.getUrl());
  return deck.getUrl();
}

/**
 * Web app entry point — call via HTTP GET to trigger deck creation.
 * Returns the deck URL as JSON.
 */
function doGet(e) {
  const url = createDeck();
  return ContentService
    .createTextOutput(JSON.stringify({ url: url, status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
