#!/usr/bin/env python3
"""
Voice-tell gate: runs the voice engine's AI-writing checks on generated artifacts, never on in-thread conversation.
Hooks fire on tool calls, so a Write/Edit or an external send is checked, while Claude talking in the thread is not.
(Drafts Claude shows in the chat are checked by voice-draft-gate.py, a Stop hook next to this file that imports
analyze() from here, so both gates use one word list and one scorer.)

Two tiers, matched to whether the action can be undone:
  - FILE WRITES (PostToolUse on Write|Edit|MultiEdit, prose files only): NUDGE. The file isn't external yet, so a list
    of the tells and fixes is enough. A file in a drafts/ folder, or with "draft" in its name, is checked at any
    length; other files from 400 characters.
  - EXTERNAL SENDS (PreToolUse on the send tools in SEND_SUFFIXES: chat messages, email, shared documents and slides,
    comments, pull request and issue bodies): BLOCK on the block tier, NUDGE below it. A sent message can't be taken back.

Block tier (sends only): a block word or block phrase from the lexicon below (seamless, synergy, utilize, "it's worth
noting", ...) or one of its inflected forms, a sentence that opens "As <Company>" in company voice ("As Globex, we
...") or with a listed company name, a critical structure from your overlay (<prefix>-struct-*), a phrase your
overlay marks critical (a TEAM_PHRASES hit), and any failure of the scorer or the normalizer. Dual-use words with a
real technical sense (leverage, robust, ecosystem, end-to-end, "north star") only nudge, and so does everything
softer, including "As <Name>" for a name that isn't a listed company. The lexicon (FULL_EXEMPT, NUDGE_WORDS,
BLOCK_WORDS, BLOCK_PHRASES, BLOCK_FORMS, NUDGE_FORMS, COMPANY_NAMES) is yours to tune: move a word between tiers if
the gate is too strict or too loose for you.

Your company names: ~/.claude/voice/company-names.txt ($CLAUDE_CONFIG_DIR/voice/ when that is set, or the file
VOICE_COMPANY_NAMES names). One name per line, up to four words; blank lines and # lines are skipped; a line starting
with ! is a name that is never a company (an event or a product you write about). A missing file means the built-in
COMPANY_NAMES only; a file that can't be read adds a warning to the hook's message and never blocks a send for it.
Template: ~/.claude/tools/onboarding/templates/company-names.example.txt.

Scope. It catches known shapes: a tell no pattern lists gets through. It reads words, phrases and the structures your
overlay defines, not page layout. A send that doesn't go through an MCP tool its matcher reaches (a shell command such
as `gh pr create --body`) is not checked.

It runs ~/.claude/tools/aiscore.mjs (the scorer /voice-check uses) and ~/.claude/tools/text-normalize.mjs, so there is
one definition of a tell.

History (2026-10-02 to 2026-10-03):
  D1  A failure of the scorer or the normalizer (throw, bad output, missing fields, timeout, node missing), or an
      exception inside this hook, DENIES a send and puts a visible warning on a file write (the write already
      happened). Unreadable hook input exits 2, Claude Code's blocking code, because the tier can't be told. Earlier
      versions carried on with the word list alone. The scorer timeout is 20 s.
  D2  The scorer's HTML reduction and emphasis scans run in linear time; a page of unclosed tags used to push the
      scorer past its timeout. A timeout fails closed anyway.
  D3  The word list also runs on the canonical text and the rendered view from text-normalize.mjs (invisible and tag
      characters, look-alike letters, NFKC, HTML entities, inline tags and comments, combining marks), so none of
      those can hide a banned word. The extra passes can only add hits.
  D4  A read marker (read, get, list, ...) counts only as a whole word of the tool's own name, so
      manage_spreadsheet_comment is a send; and overlay structures and phrases are read under any issue prefix.
  D5  A send that is only a banned word ("seamless") is scanned, not skipped as an ID, and so is one that only starts
      with a link. The input is walked with an explicit stack down to HARVEST_MAX_DEPTH levels and HARVEST_MAX_NODES
      values; past either limit a send is denied and a write gets a warning. Inline fragments a destination renders as
      one run (chat rich-text pieces, document inserts) are also read joined.
  D6  "As <Name>" at the start of a sentence: a send is denied for company voice or a listed company; any other name
      nudges. Attribution ("As Dana said"), roles ("As CEO"), pronouns, months and the stock openers ("As of", "As
      soon as", "As such") stay silent. The per-user names file is read as described above.
  D7  Inflected forms of the banned words (BLOCK_FORMS, NUDGE_FORMS): a form real writers almost never use blocks like
      its base ("delves", "holistically"); one they use nudges ("seamlessly", "utilized").
  D8  A draft file (a drafts/ folder, or "draft" in the file name) is checked at any length.
  D9  Company voice is read more closely both ways (an appositive before the as-clause's own verb is not company
      voice; an aside, a dash pair or an adverb before "we" still is), and the send gate also reads the flat view the
      draft gate reads (backticks dropped, whitespace runs one space), so the two gates agree. Messages name no file
      outside the tools folder.
  D10 An abbreviated legal suffix with its period ("As Globex Inc., we ...") is company voice and blocks; before a
      capital the period still ends the sentence.
Env overrides (tests and copies): VOICE_AISCORE, VOICE_NORMALIZE (script paths), VOICE_SCORER_TIMEOUT (seconds),
VOICE_COMPANY_NAMES (the names file).
Source: ~/.claude/tools/hook/voice-tell-gate.py (setup.sh installs it in ~/.claude/hooks/scripts).
Tests: ~/.claude/tools/hook-tests/voice-tell-gate.test.py. Docs: docs/voice/ in the starter kit.
"""
import html
import json
import os
import re
import subprocess
import sys
import unicodedata

AISCORE = os.environ.get("VOICE_AISCORE") or os.path.expanduser("~/.claude/tools/aiscore.mjs")
NORMALIZER = os.environ.get("VOICE_NORMALIZE") or os.path.expanduser("~/.claude/tools/text-normalize.mjs")
try:  # seconds; the override is for tests (a hung stand-in shouldn't cost 20 s a case)
    SCORER_TIMEOUT = float(os.environ.get("VOICE_SCORER_TIMEOUT") or 20)
except ValueError:
    SCORER_TIMEOUT = 20.0
if not 0 < SCORER_TIMEOUT <= 40:  # also catches NaN; keeps both calls under Claude Code's 60 s hook timeout
    SCORER_TIMEOUT = 20.0
# Claude Code's default hook timeout is 60 s; both calls together stay well under it.
NORMALIZER_TIMEOUT = min(SCORER_TIMEOUT, 10.0)

FILE_TOOLS = {"Write", "Edit", "MultiEdit"}
PROSE_EXT = (".html", ".htm", ".md", ".mdx", ".txt", ".rtf", ".docx")

# External-send / publish tools (suffix-matched — the mcp__server__ prefix varies by server, so
# one entry covers every server prefix, mcp__github__ or any other).
# Widened to cover "the best we can with what we have" — every prose-bearing egress the connected
# MCP servers expose. Intentional exclusions: GitHub FILE pushes (create_or_update_file/push_files)
# carry code, where a prose scanner false-positives, and any prose file is already caught at
# local-write time; Sheets/Drive-file writes are data/binary, not the prose surface.
SEND_SUFFIXES = (
    # Slack — messages + canvases (create AND update = publishing content)
    "slack_send_message", "slack_send_message_draft", "slack_schedule_message",
    "slack_create_canvas", "slack_update_canvas",
    # Gmail
    "send_gmail_message", "draft_gmail_message",
    # Google Docs — create / import / every edit path
    "create_doc", "import_to_google_doc", "batch_update_doc", "insert_doc_elements",
    "modify_doc_text", "find_and_replace_doc", "update_doc_headers_footers",
    # Google Slides
    "create_presentation", "import_to_google_slides", "batch_update_presentation",
    # Google Forms
    "create_form", "batch_update_form",
    # Comments (prose to colleagues on a shared doc/deck/sheet)
    "manage_document_comment", "manage_presentation_comment", "manage_spreadsheet_comment",
    # GitHub and other git servers — PR / issue / review PROSE bodies (not file pushes)
    "create_pull_request", "create_issue", "add_issue_comment", "create_pull_request_review",
    "update_pull_request", "update_issue", "add_comment_to_pending_review",
    "add_reply_to_pull_request_comment", "pull_request_review_write",
)
# Never treat a read/search/list/get as a send even if a suffix substring collides. Each marker is a whole word of
# the tool's own name (the part after the last "__"), so "spreadsheet" and a server named "research" don't count (D4a).
NOT_SEND = ("read", "search", "list", "get", "fetch", "download", "poll", "branch")

# Keys whose string values are plumbing, not prose — never scan them.
SKIP_KEYS = {
    "channel", "channel_id", "thread_ts", "ts", "user", "user_id", "url", "link", "id", "file_id",
    "path", "file_path", "owner", "repo", "head", "base", "branch", "sha", "name", "to", "cc",
    "bcc", "recipient", "email", "token", "cursor", "type", "mimetype", "filetype", "old_string",
}
# Strings that are plumbing by shape: one or more URLs and nothing else, a number/date/time, or an ID-like token. The URL
# form used to match any string that STARTED with http(s)://, which skipped a whole message that opened with a link
# (D5a). A URL is printable ASCII with no < > " ' and no HTML entity (D5d), so markup, &nbsp; or a blank-looking character
# that isn't whitespace to Python ends it and the rest is scanned.
_URL = re.compile(r"https?://(?:[!#-%(-;=?-~]|&(?![#A-Za-z][A-Za-z0-9]*;))+")
_NUMERIC = re.compile(r"^[\d.\-:/]+$")
_TOKEN = re.compile(r"^[A-Za-z0-9_]{8,}$")
_LONE_WORD = re.compile(r"(_{0,2})([A-Za-z]+)\1")  # a bare word, optionally in paired _emphasis_ the canonical view strips
# The walk's limits (D5b). Real tool inputs nest well under 20 levels and hold a few thousand values at most.
HARVEST_MAX_DEPTH = 100
HARVEST_MAX_NODES = 200_000

# ── Banned-word lexicon ──────────────────────────────────────────────────────
# Why a lexicon here and not only aiscore: the generic detector scores single
# slop words near 0 on SHORT text (a chat message, a PR body), which is exactly
# the outbound surface this gate guards, so the gate carries the words itself.
#   • FULL_EXEMPT  never flagged in an overlay phrase hit (your own product or
#                  project names, for example). Empty by default.
#   • NUDGE_WORDS  flagged, never blocked (a real technical/literal sense exists).
#   • BLOCK_WORDS/PHRASES  marketing slop with no technical use: block on send.
# Tunable: move a word between sets if the gate proves too aggressive or too loose.
FULL_EXEMPT = set()
NUDGE_WORDS = {
    "leverage", "robust", "landscape", "ecosystem", "innovative", "nuanced", "disruptive",
    "foster", "pivotal", "unlock", "empower", "facilitate", "unpack", "learnings",
    "north star", "end-to-end", "full-stack", "deep-dive", "double-click", "circle back",
}
BLOCK_WORDS = {
    "delve", "streamline", "seamless", "utilize", "solutioning", "ideation", "synergy",
    "paradigm", "transformative", "groundbreaking", "spearhead", "bolster", "fortify",
    "underpin", "underpinning", "cornerstone", "linchpin", "tapestry", "multifaceted",
    "holistic", "cutting-edge", "game-changing", "best-in-class", "world-class",
    "state-of-the-art", "mission-critical", "next-generation", "low-hanging fruit",
    "table stakes",
}
# Inflected forms (D7, 2026-10-02). Each candidate form was counted in the control sets (docs with the form: 19,870
# public documents plus private sets) and in the AI drafts. A form blocks like its base when real writers almost never
# use it (at most 2 public docs and 3 private ones, the human false-positive budget's margins); otherwise it nudges. -ise spellings take their -ize twin's decision (the corpora are mostly US
# English, so a low British count isn't evidence the form is rare). "tapestries" nudges by judgment (the plural is
# nearly always the literal wall hanging). Forms of the nudge words nudge. Table: the decision log (docs/voice), D16.
BLOCK_FORMS = {
    "delves", "streamlines", "synergistic", "synergize", "synergizes", "synergized", "synergizing", "synergise",
    "synergised", "transformatively", "ground-breaking", "spearheads", "spearheading", "bolstered", "fortifies",
    "fortifying", "underpinned", "underpinnings", "cornerstones", "linchpins", "lynchpin", "lynchpins", "multi-faceted",
    "holistically", "game changing", "game-changer", "game-changers", "game changer", "game changers", "best in class",
    "mission critical", "low hanging fruit",
    # D9 (review of D7): derivations the first pass missed, 0 public docs and at most 1 private doc each
    "synergistically", "seamlessness", "lower-hanging fruit", "lowest-hanging fruit", "lower hanging fruit",
    "lowest hanging fruit",
}
NUDGE_FORMS = {
    "delved", "delving", "streamlined", "streamlining", "seamlessly", "utilizes", "utilized", "utilizing", "utilization",
    "utilise", "utilises", "utilised", "utilising", "utilisation", "synergies", "paradigms", "spearheaded", "bolsters",
    "bolstering", "fortified", "underpins", "tapestries", "cutting edge", "world class", "state of the art",
    "next generation", "next-gen", "table-stakes",
    # forms of the nudge words
    "leverages", "leveraged", "leveraging", "robustly", "robustness", "landscapes", "ecosystems", "innovatively",
    "fosters", "fostered", "fostering", "unlocks", "unlocked", "unlocking", "empowers", "empowered", "empowering",
    "empowerment", "facilitates", "facilitated", "facilitating", "unpacks", "unpacked", "unpacking", "north stars",
    "deep dive", "deep dives", "deep-dives", "double-clicks", "double-clicked", "double-clicking", "circling back",
    "circled back", "circles back",
}
BLOCK_WORDS |= BLOCK_FORMS
NUDGE_WORDS |= NUDGE_FORMS
BLOCK_PHRASES = [re.compile(p, re.I) for p in (
    r"in today[’']?s rapidly evolving", r"it[’']?s worth noting", r"well[- ]positioned(?:[- ]to\b)?",  # D7: with or without "to"
    r"uniquely positioned", r"ushering in a new era", r"actionable insights?",
    r"in an era of", r"move the needle",
    r"it was worth noting", r"(?:ushers?|ushered) in a new era", r"(?:moves|moved|moving) the needle\b",  # D7 forms
)]
NUDGE_PHRASES = [re.compile(p, re.I) for p in (
    r"it is worth noting",  # D7: 10 public docs, so a nudge (the contraction stays a block)
)]
_WORD_RE = {w: re.compile(r"\b" + re.escape(w) + r"\b", re.I) for w in (BLOCK_WORDS | NUDGE_WORDS)}

# ── The "As [Company]" opener (D5c, 2026-10-02; widened and narrowed by the D5 review, D5f) ──────────────────────────
# The lexicon bans starting a sentence with "As [Company]...". A hit is "As" (or "AS") + a capitalized name at the start of a sentence:
# the start of the text, a line or a list item, or after . ! ? … : ; or a spaced dash (and any closing quote or bracket).
# The name is one to four capitalized words ("As Globex", "As Acme Corp", "As AWS", "As eBay", "As 3M", "As Ørsted"); an
# "&" may join them and one line break may wrap them.
_SP = r"[^\S\r\n]"  # a space on the line: tab, NBSP, a thin space (an &nbsp; renders as one)
_AS_HEAD = re.compile(r"(?<![^\W_])A[sS]" + _SP + "+")  # "_As" (Slack italics) too: "_" is not a letter here (D9)
_AS_TOKEN = re.compile(r"[^\W_][\w'’\-]*")
_AS_GAP = re.compile(_SP + r"*\n" + _SP + r"*(?:&" + _SP + r"+)?|" + _SP + r"+(?:&" + _SP + r"+)?")  # between name words: spaces, an "&", one line wrap
_AS_TITLE = re.compile(r"(?:Mr|Mrs|Ms|Dr|Prof|St|Saint)\.?" + _SP + r"+(?=\S)")  # "As Dr. Lee", "As St. Augustine": a person
_AS_TECH = {"2d", "3d", "4k", "8k", "3g", "4g", "5g", "2fa", "ph"}  # digit-led or lower-upper words that aren't names
# A block tag starts a new line where it renders; the rendered view turns it into a space, so this check reads the text
# with block tags as line breaks and entities decoded ("https://...<p>As&nbsp;Globex, we ...").
_BLOCK_TAG = re.compile(r"<\s*/?\s*(?:p|br|div|li|ul|ol|h[1-6]|tr|td|th|table|blockquote|section|article|header|footer"
                        r"|hr|pre)\b[^<>]{0,200}>", re.I)
_SLACK_LINK = re.compile(r"<(?:https?://|mailto:)[^<>|\s]*\|([^<>\n]{1,200})>")  # Slack <url|label>: read the label
_MD_LINK = re.compile(r"\[([^\[\]\n]{1,200})\]\([^()\s]{1,500}\)")  # markdown [label](url): read the label
_BARE_URL = re.compile(r"<?https?://[^\s<>]{1,2000}>?")  # any other link reads as a space, so "As Guido said <url>" is a citation
# Not a company when the first word is one of these (compared lowercase): pronouns, articles and determiners, the stock
# openers ("As of", "As soon as", "As such", "As expected", "As noted"), months, days, seasons, reporting periods, AI/ML
# terms ("As AI agents take on more work" is a generic opener, not "As [Company]"; the rule is about companies, so it is
# left to the scorer), "As Prepared" (a speech header) and "As FYI". Event names are per-user ("!" lines, D6c).
_AS_NOT_COMPANY = set("""
    i we you he she they it me us him them one this that these those my our your his her its their some each every any
    all both most many much more few no a an the of soon far long well such if though to for with per yet so opposed as
    is was are were be always ever usual before after part expected noted mentioned discussed described shown seen
    stated promised planned agreed requested needed required applicable previously above below follows following
    prepared introduced amended revised adopted enrolled engrossed filed passed fyi sr jr
    january february march april may june july august september october november december
    monday tuesday wednesday thursday friday saturday sunday today tomorrow tonight yesterday
    winter spring summer fall autumn
    ai ml llm llms genai
""".split())
# Roles: "As CEO, she...", "As Account Executive for the renewal", "As SEs, we", "As Rick's assistant". Any word of the
# name counts (a hyphenated word by its parts, "BDFL-Delegate"), and so does a plural ("SEs", "PMs", "CEOs").
_AS_ROLES = set("""
    ceo cfo cio cmo cto coo cro ciso cpo cso evp svp vp avp rvp gm md pm pmm tpm em dri se ae sdr bdr csm am
    head director manager chair chairman chairwoman president founder cofounder co-founder owner lead principal senior
    chief member admin administrator engineer architect editor author host intern judge governor senator mayor secretary
    minister commissioner professor speaker captain coach ambassador attorney officer counsel executive dean assistant
    delegate user customer partner rep representative consultant analyst developer designer scientist researcher student
    teacher parent leader steward sponsor champion advisor adviser liaison coordinator specialist strategist contributor
    maintainer reviewer approver treasurer trustee deputy fellow volunteer moderator organizer seller buyer lender borrower
    licensee licensor guarantor tenant landlord contractor vendor supplier
""".split())
# A firm name may end in a plural role word ("Globex Partners", "Initech Advisors"); there it names the company.
_AS_FIRM = {"partners", "advisors", "advisers", "consultants", "associates", "developers", "designers"}
_AS_PERIOD = re.compile(r"^(?:q[1-4]|h[12]|fy\d{2,4})$")
# Attribution: "As Dana said", "As Gartner reports", "As Marc has been saying for years", "As Larry can attest to". A
# citation is not speaking as the company. It counts when a reporting verb comes within the first five words of the
# clause (before any , . ; : ! ? or blank line; "has been", "email below" may come first), with no subject pronoun before
# it, and nothing after it but the clause's end, a preposition, an adverb or a pronoun. A verb with an object ("As Globex
# shares its roadmap") is not attribution.
_AS_ATTRIB = set("""
    said says say saying noted notes note noting wrote writes write written writing reported reports report reporting
    argued argues argue arguing told tells tell telling explained explains explain mentioned mentions mention
    suggested suggests suggest observed observes observe described describes describe discussed discusses discuss
    asked asks ask warned warns warn predicted predicts predict stated states claimed claims recalled recalls remarked
    remarks insisted insists advised advises recommended recommends shared shares showed shows shown found finds framed
    frames quipped joked commented comments speculated speculates emphasized emphasizes stressed stresses admitted admits
    conceded concedes acknowledged acknowledges confirmed confirms titled called calls call dubbed termed taught teaches
    indicated indicates indicate requested requests request flagged flags flag highlighted highlights highlight agreed
    agrees agree proposed proposes propose knows know knew replied replies reply responded responds answered answers
    posted posts post reminded reminds remind attest attests attested recounted recounts outlined outlines summarized
    summarizes added adds clarified clarifies cautioned cautions concluded concludes announced announces promised
    promises expected expects feared fears hoped hopes thought thinks believes believed understood understands learned
    learnt illustrated illustrates detailed details testified wondered guessed assumed demonstrated demonstrates
    discovered discovers documented documents informed
""".split())
# Speech and naming verbs read as a citation whatever follows them: "As Craig said don't ...", "As Kurt Vonnegut titled one".
_AS_SPEECH = {"said", "says", "wrote", "writes", "replied", "replies", "quipped", "joked", "remarked", "titled", "called",
              "dubbed", "termed"}
_AS_SUBJ = {"we", "i", "you", "they", "he", "she", "it", "our", "my", "your", "their"}
_AS_AFTER_VERB = set("""
    in on at by during for to about from with over after before earlier last yesterday today this that below above here
    there recently previously out it us me you them him her so too once already again back then up many years often
    repeatedly best well elsewhere publicly privately we i they he she
""".split())
_AS_CUT = re.compile(r"[,.;:!?]|\n[ \t]*\n")  # a wrapped line (one newline) doesn't end the clause; a blank line does
_AS_APPOSITIVE = re.compile(r"(?:a|an|the|who|which|my|our|his|her|their|your|its|one)\b(?:[^,;!?\n]|\n(?![ \t]*\n)){0,100}?,\s*",
                            re.I)  # may wrap one line: ", a\ndesigner in Tucson, notes"
_AS_NAME_LIST = re.compile(r"(?:[ \t]*,[ \t]*[A-Z][\w'’\-]*)*[ \t]*,?[ \t]+(?:and|&)[ \t]+(I|me|we|[A-Z][\w'’\-]*)\b")
_AS_ASIDE = re.compile(r"@[\w.\-]+|[ \t]*\([^()\n]{0,100}\)")  # an email domain or a bracketed aside right after the name
_AS_OPENS = " \t*_~\"'“‘([>"  # may sit between a sentence boundary and "As": spaces, emphasis, an opening quote or bracket
_AS_CLOSES = "\"'”’)]*_~"      # may sit between a stop and the spaces before "As"
_AS_STOPS = ".!?…:;"
_AS_LINE_MARKS = "-•+–—◦‣▪∙·#"  # list bullets and heading marks at the start of a line; a spaced dash also mid-line
_AS_NUMBERED = re.compile(r"(?:\d{1,3}[.)]|\(\d{1,3}\)|\(?[A-Za-z][.)])$")  # "1." "1)" "(1)" "a)" "(a)"
_AS_SHORTCODE = re.compile(r":[a-z0-9_+\-]{1,40}:$")  # a Slack :shortcode:
_SMALL_WORDS = set("a an the and but or nor for so yet to in on at of by with from as vs via into per off up out over".split())

# ── Company names (D6) ─────────────────────────────────────────────────────────────────────────────────────────────
# Large companies whose name in the opener blocks a send whatever follows it. Generic on purpose: no customer and no
# product name; you add your own in the per-user file (D6c). Checked against the control corpora for English-word
# collisions (the decision log in docs/voice, D15).
COMPANY_NAMES = (
    "Google", "Alphabet", "Microsoft", "Amazon", "AWS", "Apple", "Meta", "Facebook", "OpenAI", "Anthropic", "Oracle",
    "SAP", "IBM", "Adobe", "ServiceNow", "Workday", "HubSpot", "Snowflake", "Databricks", "Nvidia", "Intel", "Cisco",
)
NAMES_FILE_DEFAULT = "~/.claude/voice/company-names.txt"  # under $CLAUDE_CONFIG_DIR when that is set (D9)
NAMES_MAX_BYTES = 256 * 1024
NAMES_MAX = 5000
_CORP_SUFFIX = {"inc", "corp", "corporation", "co", "company", "ltd", "limited", "llc", "plc", "gmbh", "ag", "incorporated"}
_CORP_TAIL = re.compile(r"(?:,?" + _SP + r"*(?:Inc|Corp|Co|Ltd|LLC|plc|GmbH|AG)\.?)(?=[\s,;:!?)]|$)", re.I)  # ", Inc."
# The period after a suffix the name parse read as a word ("As Globex Inc., we", "As Acme Co. our team") belongs to the
# name when the clause goes on after it: a separator or a lowercase word. Before a capital it still ends the sentence
# ("As Globex Inc. We ship ..."), as it did before (D10a).
_SUFFIX_DOT_GOES_ON = re.compile(_SP + r"*(?:[,;:—–…]|--|-(?=" + _SP + r")|([^\W\d_]))")


def _suffix_dot_goes_on(text, i):
    """True when the text from i (just after a suffix's period) goes on with a separator or a lowercase word."""
    m = _SUFFIX_DOT_GOES_ON.match(text, i)
    return bool(m) and (m.group(1) is None or m.group(1).islower())
_FIRST_PERSON = re.compile(r"(we|our|ours|us|i|my|me)(?:['’](?:re|ve|ll|d|m))?(?![\w'’])", re.I)


def _name_key(words):
    """The comparable form of a name: lowercase words, a possessive and trailing corporate suffixes dropped."""
    ws = [re.sub(r"['’]s?$", "", w.replace("’", "'")).lower() for w in words]
    ws = [w.rstrip(".") if w.rstrip(".") in _CORP_SUFFIX else w for w in ws]
    while len(ws) > 1 and ws[-1] in _CORP_SUFFIX:
        ws.pop()
    return " ".join(w for w in ws if w)


_NAMES = None  # (listed keys, never-company keys, warning or None), read once per process


def names_file_default():
    """The per-user names file: $CLAUDE_CONFIG_DIR/voice/company-names.txt when Claude Code's config dir is moved,
    else ~/.claude/voice/company-names.txt (D9: getting-started puts it there)."""
    base = os.environ.get("CLAUDE_CONFIG_DIR")
    return os.path.join(base, "voice", "company-names.txt") if base else NAMES_FILE_DEFAULT


def company_names():
    """(listed, silent, warning). listed: the built-in COMPANY_NAMES plus the per-user file's names; silent: the file's
    "!" names; warning: why the file couldn't be read fully, or None. A missing file is not a warning (D6c)."""
    global _NAMES
    if _NAMES is not None:
        return _NAMES
    listed = {_name_key(n.split()) for n in COMPANY_NAMES}
    silent, warning, long_names = set(), None, 0
    path = os.path.expanduser(os.environ.get("VOICE_COMPANY_NAMES") or names_file_default())
    try:
        with open(path, "rb") as f:
            raw = f.read(NAMES_MAX_BYTES + 1)
        cut = len(raw) > NAMES_MAX_BYTES
        if cut:
            raw = raw[:raw.rfind(b"\n", 0, NAMES_MAX_BYTES) + 1]
        lines, n = raw.decode("utf-8").splitlines(), 0
        for line in lines:
            line = line.strip().lstrip("\ufeff")
            if not line or line.startswith("#"):
                continue
            n += 1
            if n > NAMES_MAX:
                cut = True
                break
            bang = line.startswith("!")
            key = _name_key(line.lstrip("!").split())
            if len(key.split()) > 4:  # the opener reads at most four words of a name, so this line could never match
                long_names += 1
                continue
            if key:
                (silent if bang else listed).add(key)
        notes = []
        if cut:
            notes.append(f"read only the first {min(n, NAMES_MAX):,} names of the company-names file {path} "
                         f"(the limit is {NAMES_MAX:,} names, {NAMES_MAX_BYTES // 1024} KB)")
        if long_names:
            notes.append(f"skipped {long_names} line{'s' if long_names > 1 else ''} of the company-names file {path} "
                         "longer than four words (a name is matched on at most four words)")
        warning = "; ".join(notes) or None
    except FileNotFoundError:
        pass
    except (OSError, UnicodeDecodeError) as e:
        why = e.strerror if isinstance(e, OSError) and e.strerror else type(e).__name__
        warning = f"couldn't read the company-names file {path} ({why}), so only the built-in company list was used"
    _NAMES = (frozenset(listed), frozenset(silent), warning)
    return _NAMES


# Company voice (D6a; widened and narrowed by the review of the redesign, D9). After the name: an optional run of more
# capitalized words (a name past the parser's four words), a separator (a comma, a dash, a colon, a semicolon or an
# ellipsis; a line break only right after one, so a heading's next paragraph is never read as its main clause), then
# at most one bounded aside closed the same way, and an optional adverb ("honestly", "together", "here").
_CV_MORE = re.compile(r"(?:" + _SP + r"+[A-Z][\w'’\-]*){1,3}(?=" + _SP + r"*(?:[,;:—–…]|\.\.\.|--))")
_CV_SEP = re.compile(_SP + r"*(,|;|:|—|–|--|…|\.\.\.|-(?=" + _SP + r"))" + _SP + r"*(?:\r?\n(?![ \t]*\r?\n)" + _SP + r"*)?")
_CV_WRAP = re.compile(_SP + r"*\r?\n(?![ \t]*\r?\n)" + _SP + r"*")  # one line wrap with no separator: lowercase only
_CV_ASIDE = {  # the aside's closing mark, by the separator that opened it: up to 12 words, one line wrap
    ",": re.compile(r"((?:[^,;!?\n]|\n(?![ \t]*\n)){1,120}?)" + _SP + r"*,\s*"),
    "dash": re.compile(r"((?:[^,;!?\n—–]|\n(?![ \t]*\n)){1,120}?)" + _SP + r"*(?:—|–|--|-(?=" + _SP + r"))\s*"),
}
_CV_ADVERB = re.compile(r"(?:here|today|now|together|too|also|again|then|still|already|collectively|ourselves|"
                        r"first|overall|[a-z]+ly)\b,?" + _SP + r"*")
_CV_COORD = re.compile(r"(?:\b(?i:and|or)\b|&)" + _SP + r"+(?:I\b|(?i:me|we|the|an?|other|our|my|their|his|her|its|some|"
                       r"many|all|several|both)\b|[A-Z][\w'’.\-]*)")  # a capital means a name: case-sensitive there
# The word after a possessive appositive's closing comma ("As Dana, our new AE, ramps up"): one of these continues a
# first-person main clause ("As Globex, our team ships on Fridays, and ..."); any other lowercase word is the as-clause's
# own verb, so "our new AE" was an appositive, not the main clause.
_CV_CLAUSE_GO = set("""
    and but or nor so yet then which who whom whose that the a an this these those it its they he she you we i our my
    their his her your every each all some no not plus both as while when where because since if though although unless
    until from with without for to in on at by of into after before during over under through rather instead including
    especially even just also too there here now today
""".split())


def _coordinated(aside):
    """True when the aside is a list of subjects with its own verb ("the AE and the SE finish the deck"), as in an
    ordinary as-clause, rather than an appositive ("a leader in data and AI"): a coordinator followed by "I", a
    determiner or a name, with three or more words after it."""
    for m in _CV_COORD.finditer(aside):
        if len(re.findall(r"[^\W_][\w'’.\-]*", aside[m.start():])) >= 4:
            return True
    return False


def _first_person(r):
    """The first-person word r starts with, or None. An all-caps US or ME counts only on an all-caps line ("As Globex,
    US sales grew" is the country)."""
    fp = _FIRST_PERSON.match(r)
    if not fp:
        return None
    w = fp.group(1)
    if w in ("US", "ME") and not r.split("\n", 1)[0].isupper():
        return None
    return fp


def _company_voice(after, words=()):
    """True when what follows the name opens a first-person main clause (D6a, D9): "we ...", ", our team ...",
    ", a leader in widgets, we ...", ", founded in 1985, we ...", " — a widget leader — we ...", ", honestly, we ...".
    Not when the first person is a possessive that opens an appositive followed by the as-clause's own verb ("As Dana,
    our new AE, ramps up"), when the aside is a list of subjects with its own verb ("As 18F, the U.S. Digital Service
    and other agencies develop these resources, we ..."), or across a blank line. Bounded: every step reads a fixed
    window of after."""
    sep = _CV_SEP.match(after)  # the common shapes first: "As Globex, we ..." and "As Globex we ..."
    fp = _first_person(after[sep.end():] if sep else after[len(after) - len(after.lstrip(" \t")):])
    if fp and fp.group(1).lower() not in ("our", "my"):
        return True
    p = 0
    more = _CV_MORE.match(after)
    if more and words and not any(w.lower() in _SMALL_WORDS - {"of", "and"} for w in list(words) + more.group(0).split()):
        p = more.end()  # "As Globex Widget Holdings Group International, we ..."
    pre = re.match(_SP + r"+(?=(?:here|today|now|together|too|also|again|still|already|collectively|[a-z]+ly)\b)", after[p:])
    if pre:
        adv = _CV_ADVERB.match(after, p + pre.end())
        if adv:
            p = adv.end() - len(adv.group(0)) + len(adv.group(0).rstrip(", \t"))  # "As Globex here, we ..."
    sep = _CV_SEP.match(after, p)
    starts = []
    if sep:
        q = sep.end()
        starts.append(q)
        kind = "," if sep.group(1) == "," else ("dash" if sep.group(1) in ("—", "–", "--", "-") else None)
        if kind:
            a = _CV_ASIDE[kind].match(after, q)
            if a and len(a.group(1).split()) <= 12 and not _coordinated(a.group(1)):
                starts.append(a.end())  # ", founded in 1985, we" / " — a widget leader — we"
    else:
        q = p + re.match(_SP + r"*", after[p:]).end()
        if after[q:q + 1] not in "\r\n":
            starts.append(q)  # "As Globex we ...", "As Globex, together we"
        else:
            wrap = _CV_WRAP.match(after, p)
            if wrap and re.match(r"(?:we|our|us|i|my|me)\b", after[wrap.end():]):
                starts.append(wrap.end())  # "As Globex\nwe ..." (a hard-wrapped line, lowercase only)
    for k, q in enumerate(starts):
        r = after[q:]
        if not _first_person(r):
            adv = _CV_ADVERB.match(r)
            if adv:
                r = r[adv.end():]  # ", honestly we" / ", together we"
        fp = _first_person(r)
        if not fp:
            continue
        if k == 0 and fp.group(1).lower() in ("our", "my") and sep and sep.group(1) == ",":
            a = _CV_ASIDE[","].match(r)
            if a and len(a.group(1).split()) <= 8:
                nxt = re.match(r"[^\W\d_][\w'’\-]*", r[a.end():])
                if nxt and nxt.group(0)[0].islower() and nxt.group(0).lower() not in _CV_CLAUSE_GO:
                    continue  # "As Dana, our new AE, ramps up, ...": an appositive, then the as-clause's own verb
        return True
    return False


def _decor(c):
    """A character that may sit in front of "As" without ending the look back: spaces, emphasis, an opening quote or
    bracket, an emoji or other symbol, or an invisible format character."""
    return c in _AS_OPENS or c in "︎️" or unicodedata.category(c) in ("So", "Sk", "Cf")


def _sentence_start(text, i):
    """2 when position i (where "As" begins) starts the text, a line or a list item; 1 when it starts a sentence inside
    a line; 0 otherwise. The look back crosses only the decoration, list marks and stops in front of this "As", a run no
    other match shares, so the total work stays linear however long the runs are."""
    j = i - 1
    emoji = False  # an emoji or :shortcode: crossed on the way back, with a space between it and "As"
    while j >= 0:
        if _decor(text[j]):
            emoji = emoji or (unicodedata.category(text[j]) == "So" and text[j + 1:i].strip(" \t\u00a0\ufe0f") != text[j + 1:i])
            j -= 1
            continue
        if text[j] == ":" and j > 0:  # a :shortcode: emoji
            m = _AS_SHORTCODE.search(text, max(0, j - 41), j + 1)
            if m:
                emoji = emoji or text[j + 1:i].strip(" \t") != text[j + 1:i]
                j = m.start() - 1
                continue
        break
    if j < 0 or text[j] in "\n\r":
        return 2
    if j == i - 1:  # "As" glued to the character before it, as in "end.As"
        return 0
    if emoji:  # "Hey team 👋 As Globex, ...", "Thanks :tada: As Globex, ...": in chat an emoji ends the sentence (D9)
        return 1
    if text[j] in _AS_LINE_MARKS:  # "- As", "## As", "◦ As" at a line start; " — As" mid-line
        k = j
        while k >= 0 and text[k] in _AS_LINE_MARKS:
            k -= 1
        b = k
        while b >= 0 and text[b] in " \t":
            b -= 1
        if b < 0 or text[b] in "\n\r":
            return 2
        return 1 if text[j] in "-–—" and k < j and text[k] in " \t" else 0
    m = _AS_NUMBERED.search(text, max(0, j - 5), j + 1)  # "1) As", "(a) As" at a line start
    if m:
        b = m.start() - 1
        while b >= 0 and text[b] in " \t":
            b -= 1
        if b < 0 or text[b] in "\n\r":
            return 2
    while j >= 0 and text[j] in _AS_CLOSES:  # ." or .) before the space
        j -= 1
    return 1 if j >= 0 and text[j] in _AS_STOPS else 0


def _name_word(w):
    """A word that can be part of a company name: a capital first ("Globex", "AWS", "Ørsted"), lowercase then capital
    ("eBay"), or digits with a capital ("3M", "1Password")."""
    c = w[0]
    if c.isupper():
        return True
    if c.isdigit():
        return any(ch.isupper() for ch in w) and w.lower() not in _AS_TECH
    return c.islower() and len(w) > 1 and w[1].isupper() and w.lower() not in _AS_TECH


def _as_name(text, pos):
    """(words, end) of the capitalized name starting at pos, or None. At most four words, so it's bounded."""
    if _AS_TITLE.match(text, pos):
        return None
    words, end, p = [], pos, pos
    while len(words) < 4:
        m = _AS_TOKEN.match(text, p)
        if not m or not _name_word(m.group(0)):
            break
        w, end = m.group(0), m.end()
        if len(w) == 1 and text[end:end + 1] == ".":  # an initial with its period ("William O. Douglas")
            w, end = w + ".", end + 1
        words.append(w)
        g = _AS_GAP.match(text, end)
        if not g:
            break
        p = g.end()
    return (words, end) if words else None


def _is_role(w):
    w = w.lower().rstrip(".")
    return any(x in _AS_ROLES or (x.endswith("s") and x[:-1] in _AS_ROLES) for x in [w] + w.split("-"))


def _attribution(clause):
    """True when clause (the words after the name, up to the first cut) reads as a citation (see _AS_ATTRIB)."""
    words = re.findall(r"[a-z]+", clause.lower())
    for k, w in enumerate(words[:5]):
        n = words[k + 1] if k + 1 < len(words) else ""
        if w in _AS_SUBJ:
            return False
        if w in ("put", "puts", "saw", "sees"):
            return n == "it"
        if w in ("pointed", "points"):
            return n == "out"
        if w in _AS_ATTRIB:
            return w in _AS_SPEECH or n == "" or n in _AS_AFTER_VERB
    return False


def _heading(text, start):
    """True when the line that starts at start is a Title Case heading: three or more words, every one capitalized or a
    small word, and no closing . ! ? (an ellipsis is fine). Reads at most one line of 240 characters."""
    stop = len(text)
    for nl in ("\n", "\r"):
        k = text.find(nl, start, start + 241)
        if k != -1:
            stop = min(stop, k)
    if stop - start > 240:
        return False
    line = text[start:stop].rstrip()
    if line.endswith(("!", "?")) or (line.endswith(".") and not line.endswith("..")):
        return False
    words = re.findall(r"[^\W\d_][\w'’\-]*", line)
    if len(words) < 2 or not all(w[0].isupper() or w.lower() in _SMALL_WORDS for w in words):
        return False
    under = re.match(r"\r?\n[ \t]*([=\-~^*#_])\1{2,}[ \t]*(?:\r?\n|$)", text[stop:stop + 242])  # a setext or RST underline
    return len(words) >= 3 or line.isupper() or bool(under)


def as_openers(text):
    """Every "As <Name>" sentence opener in text, as (matched "As Name" string, "block" or "nudge") pairs (D5c, D5f, D6).
    block: company voice or a listed company; nudge: any other name the opener shape matched. Linear: one pass of a
    regex, then per match a bounded name parse, a look back over its own run, and a bounded look ahead."""
    text = _BARE_URL.sub(" ", _MD_LINK.sub(r"\1", html.unescape(_BLOCK_TAG.sub("\n", _SLACK_LINK.sub(r"\1", text)))))
    listed_names, silent_names, _ = company_names()
    hits = []
    for m in _AS_HEAD.finditer(text):
        parsed = _as_name(text, m.end())
        if not parsed:
            continue
        words, end = parsed
        tail = _CORP_TAIL.match(text, end)  # "Acme Inc." / "Oracle, Inc." belongs to the name
        if tail and tail.group(0):
            end = tail.end()
        elif words[-1].lower() in _CORP_SUFFIX and text[end:end + 1] == "." and _suffix_dot_goes_on(text, end + 1):
            end += 1  # "As Globex Inc., we ...": the suffix's period, not a sentence end (D10a)
        kind = _sentence_start(text, m.start())
        if not kind:
            continue
        hit = "As " + " ".join(words)
        key = _name_key(words)
        listed = key in listed_names and key not in silent_names  # a "!" line takes a built-in name off the list (D9)
        first = re.split(r"['’]", words[0], maxsplit=1)[0].rstrip(".").lower()
        if not listed:  # not a name at all: a pronoun, a stock opener, a month, a period, a role, a title
            if first in _AS_NOT_COMPANY or _AS_PERIOD.match(first):
                continue
            if any(_is_role(w) for w in words) and not (len(words) > 1 and words[-1].lower() in _AS_FIRM):
                continue
        after = text[end:end + 200]
        while True:  # an email domain or a bracketed aside right after the name doesn't end it
            a = _AS_ASIDE.match(after)
            if not a or not a.group(0):
                break
            after = after[a.end():]
        role = re.match(r"\s+([a-z]+)", after) if words[-1].endswith(("'s", "’s")) else None
        if not listed and role and _is_role(role.group(1)):  # "As Rick's assistant, ..." speaks as a role
            continue
        if listed or _company_voice(after, words):  # D6a: no exemption below excuses these (D6b)
            hits.append((hit, "block"))
            continue
        if key in silent_names or (kind == 2 and _heading(text, m.start())):
            continue
        nl = _AS_NAME_LIST.match(after)  # "As Sam and I ...", "As Dana, Sam and I ...", "As Priya and Sam agreed"
        if nl:
            if nl.group(1) in ("I", "me", "we"):
                continue
            after = after[nl.end():]
        comma = re.match(r"\s*,\s*", after)
        if comma:  # "As Globex, ...": a main clause right after the comma is the opener, unless it's an appositive
            rest = after[comma.end():]
            ap = _AS_APPOSITIVE.match(rest)
            if not ap and re.match(r"(?:who|which)\b", rest, re.I):  # an unclosed ", who ... says": read the sentence
                sentence = re.split(r"[.!?](?:\s|$)|\n[ \t]*\n", rest[:200], maxsplit=1)[0].lower()
                if _AS_SPEECH & set(re.findall(r"[a-z]+", sentence)):
                    continue
            if not ap:
                hits.append((hit, "nudge"))
                continue
            if re.findall(r"[a-z]+", ap.group(0).lower())[-1:] and \
                    re.findall(r"[a-z]+", ap.group(0).lower())[-1] in _AS_ATTRIB:  # ", who ... with 18F says,"
                continue
            after = rest[ap.end():]  # ", a developer in D.C., puts it" -> read what follows the appositive
        if _attribution(_AS_CUT.split(after[:120], maxsplit=1)[0]):
            continue
        hits.append((hit, "nudge"))
    return hits


def as_company_openers(text):
    """The openers that block a send (company voice or a listed company), as "As Name" strings (D6)."""
    return [h for h, k in as_openers(text) if k == "block"]


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def is_send_tool(name: str) -> bool:
    low = name.lower()
    own = set(re.findall(r"[a-z0-9]+", low.rsplit("__", 1)[-1]))
    if own & set(NOT_SEND):
        return False
    return any(low.endswith(s) or ("__" + s) in low or s in low for s in SEND_SUFFIXES)


class Unscannable(Exception):
    """The tool input is past the walk's depth or size limit, so it can't be scanned. str(e) says which limit."""


def _plumbing(s):
    """True for a string that is an ID, URL or number rather than prose. A lone banned word is ID-shaped too ("seamless"
    is 8 word characters), so a token that is a lexicon word, in any case, is prose (D5a)."""
    if _NUMERIC.match(s):
        return True
    toks = s.split()
    if toks and all(_URL.fullmatch(t) for t in toks):  # a link, or a list of links and nothing else (D5d)
        return True
    if _TOKEN.match(s):
        m = _LONE_WORD.fullmatch(s)
        return not (m and m.group(2).lower() in (BLOCK_WORDS | NUDGE_WORDS))
    return False


# Simulating Google Docs inserts copies the buffer once per insert, so it runs only on inputs this small (D5e).
_INSERT_SIM_MAX = (300, 100_000)  # inserts, characters


def _inline_runs(items):
    """The text a destination renders from a list of inline fragments, or [] (D5e). Two shapes: sibling dicts that carry
    a "text" string (Slack rich_text elements, joined with nothing), and one-key wrappers around such a dict (Google Docs
    {"insertText": {"location": {"index": n}, "text": ...}}), applied in order at their indexes like the API does. One
    shallow pass over the list, so the walk stays linear."""
    frags = []
    for v in items:
        if not isinstance(v, dict):
            continue
        t = v.get("text")
        if isinstance(t, str):
            frags.append((t, None))
        elif len(v) == 1:
            inner = next(iter(v.values()))
            if isinstance(inner, dict) and isinstance(inner.get("text"), str):
                loc = inner.get("location")
                idx = loc.get("index") if isinstance(loc, dict) else None
                frags.append((inner["text"], int(idx) if _is_num(idx) else None))
    if len(frags) < 2:
        return []
    runs = ["".join(t for t, _ in frags)]
    if any(i is not None for _, i in frags):
        if len(frags) <= _INSERT_SIM_MAX[0] and sum(len(t) for t, _ in frags) <= _INSERT_SIM_MAX[1]:
            buf, base = "", next(i for _, i in frags if i is not None)
            for t, i in frags:
                at = len(buf) if i is None else max(0, min(len(buf), i - base))
                buf = buf[:at] + t + buf[at:]
            runs.append(buf)
        else:  # too many to simulate: inserts at one index read back to front
            runs.append("".join(t for t, _ in reversed(frags)))
    return runs


def harvest(obj):
    """Collect prose-ish strings from a tool_input in document order, skipping plumbing keys/IDs/URLs. Walks with an
    explicit stack, so a deep payload can't hit Python's recursion limit; raises Unscannable past HARVEST_MAX_DEPTH
    levels or HARVEST_MAX_NODES values (D5b). Linear in the size of the input. Also reads a dict key that has whitespace
    in it, and the inline runs of a fragment list (D5e). A list under a plumbing key ("to": [...]) passes the skip only
    to items with no whitespace in them, so prose in a list there is still read."""
    out, nodes = [], 0
    stack = [(obj, None, 0, False)]
    while stack:
        o, key, depth, in_list = stack.pop()
        nodes += 1
        if nodes > HARVEST_MAX_NODES:
            raise Unscannable(f"the tool input holds more than {HARVEST_MAX_NODES:,} values")
        if depth > HARVEST_MAX_DEPTH:
            raise Unscannable(f"the tool input is nested more than {HARVEST_MAX_DEPTH} levels deep")
        if isinstance(o, str):
            t = o.strip()
            if key in SKIP_KEYS and not (in_list and any(ch.isspace() for ch in t)):
                continue
            if len(t) >= 3 and not _plumbing(t):
                out.append(t)
        elif isinstance(o, dict):
            for k, v in reversed(list(o.items())):
                stack.append((v, k, depth + 1, False))
                if isinstance(k, str) and any(ch.isspace() for ch in k.strip()):  # prose as a key (D5e)
                    stack.append((k, None, depth + 1, False))
        elif isinstance(o, list):
            if key not in SKIP_KEYS:
                for run in reversed(_inline_runs(o)):
                    stack.append((run, None, depth + 1, False))
            stack.extend((v, key, depth + 1, True) for v in reversed(o))
    return out


class GateError(Exception):
    """The scorer or the normalizer couldn't give a usable answer. str(e) is a short cause for the message."""


_ERR_LINE = re.compile(r"^(?:[A-Za-z_$][\w$]*)?(?:Error|Exception)\b")  # node's "Error: ..." / "SyntaxError: ..." line


def _node(script, args, text, timeout, what):
    """Run `node script args` with text on stdin; return stdout. Any failure raises GateError."""
    data = text.encode("utf-8", "replace")  # a lone surrogate from JSON becomes "?" instead of crashing
    try:
        p = subprocess.run(["node", script, *args], input=data, capture_output=True, timeout=timeout)
    except FileNotFoundError:
        raise GateError("node not found on PATH")
    except subprocess.TimeoutExpired:
        raise GateError(f"{what} timed out after {timeout:g} s")
    except OSError as e:
        raise GateError(f"couldn't start {what}: {e.strerror or e}")
    if p.returncode != 0:
        err = [ln.strip() for ln in p.stderr.decode("utf-8", "replace").splitlines() if ln.strip()]
        why = next((ln for ln in err if _ERR_LINE.match(ln)), err[-1] if err else "")
        raise GateError(f"{what} exited {p.returncode}" + (f": {why[:120]}" if why else ""))
    return p.stdout.decode("utf-8", "replace")


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf")


def scan(text: str):
    """Run the shared aiscore scanner and return its JSON dict. Raises GateError if it can't run or its
    output lacks what analyze() reads: a numeric score and voice.issues as a list of {type, ...}."""
    out = _node(AISCORE, ["-", "--json"], text, SCORER_TIMEOUT, "aiscore")
    lines = [ln for ln in out.strip().splitlines() if ln.strip().startswith("{")]
    if not lines:
        raise GateError("aiscore printed no JSON" if out.strip() else "aiscore printed nothing")
    try:
        data = json.loads(lines[-1])
    except ValueError:
        raise GateError("aiscore printed invalid JSON")
    if not isinstance(data, dict):
        raise GateError("aiscore JSON is not an object")
    if not _is_num(data.get("score")):
        raise GateError("aiscore JSON has no numeric score")
    jv = data.get("voice")
    if not isinstance(jv, dict) or not isinstance(jv.get("issues"), list):
        raise GateError("aiscore JSON has no voice.issues list")
    for i in jv["issues"]:
        if not isinstance(i, dict) or not isinstance(i.get("type"), str) or \
                any(k in i and not isinstance(i[k], str) for k in ("text", "severity", "fix")):
            raise GateError("aiscore JSON has a malformed issue")
    return data


def canonical(text: str):
    """The two normalized views of the text, via the text-normalize.mjs CLI: (canonical, rendered). canonical is what the
    overlay's word scan reads (canonicalForScan); rendered is what a reader sees (renderedView: markup rendered, entities
    decoded, combining marks dropped, small capitals and confusable letters folded). Raises GateError on any failure,
    including a missing view or an answer for a different number of code points than sent."""
    sent = text.encode("utf-8", "replace").decode("utf-8")
    out = _node(NORMALIZER, ["--json"], text, NORMALIZER_TIMEOUT, "text-normalize")
    try:
        data = json.loads(out)
    except ValueError:
        raise GateError("text-normalize printed invalid JSON" if out.strip() else "text-normalize printed nothing")
    if not isinstance(data, dict) or not isinstance(data.get("canonical"), str):
        raise GateError("text-normalize JSON has no canonical text")
    if not isinstance(data.get("rendered"), str):
        raise GateError("text-normalize JSON has no rendered text")
    if data.get("inputCodePoints") != len(sent):
        raise GateError("text-normalize read a different text than was sent")
    return data["canonical"], data["rendered"]


# Hangul fillers render as blanks but count as letters, so "Our\u3164seamless" has no word boundary (D5d). The lexicon
# also reads every view with them as spaces; that view only adds hits.
_FILLER_AS_SPACE = dict.fromkeys(map(ord, "\u115f\u1160\u3164\uffa0"), " ")
_EXEMPT_RE = {w: re.compile(r"\b" + re.escape(w) + r"\b", re.I) for w in FULL_EXEMPT}
# Overlay issue kinds under any ISSUE_PREFIX (voice-, a two-part prefix such as jane-doe-, any other), D4.
_STRUCT_TYPE = re.compile(r"^[a-z0-9_]+(?:-[a-z0-9_]+)*?-struct(?:-|$)")
_PHRASE_TYPE = re.compile(r"^[a-z0-9_]+(?:-[a-z0-9_]+)*?-phrase$")
_PREFIX_OF_KIND = re.compile(r"^[a-z0-9_]+(?:-[a-z0-9_]+)*?-(?=(?:phrase|word|probe)$)")  # shown as [phrase], [word]


def _verdict(snippet):
    """block / nudge / exempt / unknown for a matched word or phrase snippet."""
    for rx in _EXEMPT_RE.values():
        if rx.search(snippet):
            return "exempt"
    if any(_WORD_RE[w].search(snippet) for w in BLOCK_WORDS) or any(rx.search(snippet) for rx in BLOCK_PHRASES):
        return "block"
    if any(_WORD_RE[w].search(snippet) for w in NUDGE_WORDS) or any(rx.search(snippet) for rx in NUDGE_PHRASES):
        return "nudge"
    return "unknown"


_AS_BREAK = re.compile(r"(?<![^\W_])A[sS]" + _SP + r"*\r?\n")  # "As" at a line end: the flat view may join a name to it


def flat_view(text):
    """The text the way it reads once rendered or pasted: backticks dropped and every run of whitespace one space, so
    "table\nstakes", "sea`m`less", "As `Globex`, we" and "As\nGlobex, we" read as they render (D9). The draft gate
    reads the same view, so the two gates agree on these shapes."""
    return re.sub(r"\s+", " ", text.replace("`", ""))


def lexicon(text, opener_kinds=("block", "nudge"), multi_only=False):
    """The lexicon scan: the curated word/phrase authority.
    Catches the vocabulary aiscore's overlay omits on SHORT outbound text. opener_kinds limits which "As <Name>"
    openers are reported (none: the check isn't run): the flat view reports only blocks, because joining lines loses
    the heading exemption. multi_only reads only the entries with a space in them (the flat view of a text with no
    backtick can't change a one-word match)."""
    crit, soft = [], []
    for w in sorted(BLOCK_WORDS):
        if multi_only and " " not in w:
            continue
        if _WORD_RE[w].search(text):
            crit.append({"type": "hard-ban", "text": f'"{w}"', "severity": "critical",
                         "fix": "banned word — cut it"})
    for rx in BLOCK_PHRASES:
        m = rx.search(text)
        if m:
            crit.append({"type": "hard-ban", "text": f'"{m.group(0)}"', "severity": "critical",
                         "fix": "banned phrase — cut it"})
    for hit, kind in dict.fromkeys(as_openers(text) if opener_kinds else ()):  # D5c, D6
        if kind not in opener_kinds:
            continue
        name = hit[3:]
        if kind == "block":
            crit.append({"type": "hard-ban", "text": f'"{hit}"', "severity": "critical",
                         "fix": f'banned opener: drop "As" and lead with the subject ("{name} does X")'})
        else:
            soft.append({"type": "soft-ban", "text": f'"{hit}"', "severity": "medium",
                         "fix": f'"As <Name>" opener: consider leading with the subject ("{name} ...")'})
    for w in sorted(NUDGE_WORDS):
        if multi_only and " " not in w:
            continue
        if _WORD_RE[w].search(text):
            soft.append({"type": "soft-ban", "text": f'"{w}"', "severity": "medium",
                         "fix": "dual-use — confirm the literal/product sense, else cut"})
    for rx in NUDGE_PHRASES:  # D7
        m = rx.search(text)
        if m:
            soft.append({"type": "soft-ban", "text": f'"{m.group(0)}"', "severity": "medium",
                         "fix": "common in real writing, but usually cuttable: say the thing"})
    return crit, soft


def analyze(text):
    """Combine the aiscore scan (structures + generic score) with the curated banned-word
    lexicon, returning (crit, soft, score, failures). The lexicon is the authority on WORD/PHRASE
    block-vs-nudge; aiscore owns the couching/candor STRUCTURES and the generic score.
    The overlay's own word hits (<prefix>-word) are deliberately dropped: the lexicon
    curates dual-use vocabulary (end-to-end, ecosystem) to nudge instead of block. Overlay
    phrase hits (<prefix>-phrase) go through the same curation, so a phrase the lexicon
    doesn't list still nudges rather than vanish, and one the overlay marks critical blocks.
    The lexicon runs on the text as given AND on its canonical form and its rendered view (2026-10-02,
    D3), so a look-alike letter, an invisible character, an HTML entity, an inline tag or comment, or
    a combining mark can't hide a banned word; the extra passes only add hits. `failures` lists what couldn't run (scorer, normalizer); the caller fails
    closed on any (2026-10-02, D1). With no failures the result is exactly what it was before,
    plus any word the canonical pass reveals."""
    failures = []
    try:
        data = scan(text)
    except GateError as e:
        data, failures = None, failures + [("scorer", str(e))]
    try:
        views = canonical(text)
    except GateError as e:
        views, failures = (), failures + [("normalizer", str(e))]
    jv = (data or {}).get("voice", {}) or {}
    score = int((data or {}).get("score", 0) or 0)
    crit, soft = [], []
    for i in (jv.get("issues", []) or []):
        typ = i.get("type", "")
        critical = i.get("severity", "") == "critical"
        if _STRUCT_TYPE.search(typ):  # any overlay prefix: voice-struct-*, jane-doe-struct-*, ... (D4)
            (crit if critical else soft).append(i)
        elif _PHRASE_TYPE.search(typ):
            v = _verdict(i.get("text", ""))
            if v == "block" or (v != "exempt" and critical):  # a TEAM_PHRASES hit is critical
                crit.append(i)
            elif v != "exempt":
                soft.append(i)
        # <prefix>-word: ignored — the lexicon below is the curated word authority; <prefix>-cadence-*: not read here
    lc, ls = lexicon(text)
    crit += lc
    soft += ls
    views = tuple(views) + tuple(v.translate(_FILLER_AS_SPACE) for v in (text, *views))  # D5d
    for view in dict.fromkeys(v for v in views if v != text):  # each distinct view once
        cc, cs = lexicon(view)
        crit += cc
        soft += cs
    flat = flat_view(text)
    if flat != text:  # D9: one more view, read as it renders; it only adds words and opener blocks
        tick = "`" in text  # only a backtick can change a one-word match or hide a name; else only line breaks matter
        opener = tick or _AS_BREAK.search(text)
        cc, cs = lexicon(flat, opener_kinds=("block",) if opener else (), multi_only=not tick)
        crit += cc
        soft += cs
    # dedupe by normalized matched text; a crit hit suppresses a duplicate soft hit
    seen, dcrit, dsoft = set(), [], []
    for i in crit:
        k = _norm(i.get("text", ""))
        if k and k in seen:
            continue
        seen.add(k)
        dcrit.append(i)
    for i in soft:
        k = _norm(i.get("text", ""))
        if k and k in seen:
            continue
        seen.add(k)
        dsoft.append(i)
    return dcrit, dsoft, score, failures


def bullets(issues, cap=6):
    out = []
    for i in issues[:cap]:
        t = i.get("type", "")
        t = _STRUCT_TYPE.sub("", t) if _STRUCT_TYPE.search(t) else _PREFIX_OF_KIND.sub("", t)
        out.append(f'  • [{t}] {i.get("text", "")}' + (f' — {i.get("fix")}' if i.get("fix") else ""))
    if len(issues) > cap:
        out.append(f"  • …+{len(issues) - cap} more")
    return "\n".join(out)


def emit_pre_deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason,
    }}))


def emit_context(event, msg):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": event, "additionalContext": msg}}))


def _causes(failures):
    return "; ".join(cause for _, cause in failures)


def deny_unchecked(cause, hits=(), note=""):
    """Fail closed on a send: the gate couldn't check it, so it doesn't go out."""
    reason = (f"Voice gate couldn't run its scorer ({cause}), so this send is blocked rather than going out "
              "unchecked. Fix the scorer or send it yourself.")
    if hits:
        reason += "\nThe word list did run and also flagged:\n" + bullets(hits)
    emit_pre_deny(reason + note)


def warn_unchecked(path, failures, flagged=(), note=""):
    """Fail visibly on a file write: it already happened, so say what didn't run."""
    kinds = {k for k, _ in failures}
    missed = []
    if "scorer" in kinds:
        missed.append("the structure checks did not run (announced hedges, candor labels, the generic score), "
                      "only the word list did")
    if "normalizer" in kinds:
        missed.append("look-alike and invisible-character spellings weren't checked")
    if not missed:  # an exception inside the hook: nothing is known to have run
        missed.append("the voice checks did not run")
    msg = (f"VOICE GATE WARNING ({os.path.basename(path) or 'file'}): the gate couldn't run its scorer "
           f"({_causes(failures)}), so " + "; ".join(missed) + ". Check this file by hand "
           "(node ~/.claude/tools/aiscore.mjs <file>) before it ships, and fix the scorer.")
    if flagged:
        msg += "\nThe word list flagged:\n" + bullets(flagged)
    emit_context("PostToolUse", msg + note)


def deny_unscannable(cause):
    """Fail closed on a send whose input is past the walk's limits (D5b)."""
    emit_pre_deny(f"Voice gate couldn't scan this send: {cause}, past what the gate walks, so it's blocked rather than "
                  "going out unchecked. Flatten the content or send it yourself.")


def warn_unscannable(path, cause):
    """Fail visibly on a file write whose content is past the walk's limits (D5b)."""
    emit_context("PostToolUse", f"VOICE GATE WARNING ({os.path.basename(path) or 'file'}): the gate couldn't scan this "
                 f"write: {cause}, so the voice checks did not run. Check this file by hand "
                 "(node ~/.claude/tools/aiscore.mjs <file>) before it ships.")


def is_draft_path(path):
    """True for a draft file: a folder in the path named "drafts", or a file name containing "draft", in any case (D8).
    A draft is the message itself, so it's checked at any length; other files under 400 characters are skipped."""
    parts = [p for p in re.split(r"[/\\]+", str(path).lower()) if p]
    return bool(parts) and ("drafts" in parts[:-1] or "draft" in parts[-1])


def _names_note():
    """A line for the hook's message when the per-user company-names file couldn't be read fully (D6c), else ""."""
    warning = company_names()[2]
    return f"\nVoice gate note: {warning}." if warning else ""


def _text_of(v):
    """A file write's text. Claude Code sends a string; anything else is walked like a send's input (D5b)."""
    return "\n\n".join(harvest(v)) if isinstance(v, (dict, list)) else str(v)


def run(hook_input):
    tool = hook_input.get("tool_name", "")
    tin = hook_input.get("tool_input", {}) or {}

    # ── FILE WRITE → post-write nudge (prose files only) ──────────────────────
    if tool in FILE_TOOLS:
        path = str(tin.get("file_path", "")).lower()
        if not path.endswith(PROSE_EXT):
            return
        try:
            if tool == "MultiEdit":
                text = "\n\n".join(_text_of(e.get("new_string", "")) for e in tin.get("edits", []) or [])
            else:
                text = _text_of(tin.get("content", "") or tin.get("new_string", ""))
        except Unscannable as e:  # D5b: content that isn't a string and is past the walk's limits
            warn_unscannable(path, str(e))
            return
        if len(text.strip()) < (3 if is_draft_path(path) else 400):  # too small to be a real artifact, unless a draft (D8)
            return
        crit, soft, score, failures = analyze(text)
        flagged = crit + soft
        note = _names_note()
        if failures:
            warn_unchecked(path, failures, flagged, note)
            return
        if not flagged and score < 40:
            if note:
                emit_context("PostToolUse", note.strip())
            return
        head = f"AI-TELL CHECK ({os.path.basename(path)}): the voice guard flagged this generated file."
        body = bullets(flagged) if flagged else f"  • generic AI-writing score {score}/100 (elevated)"
        tail = ("Fix these before the file ships to a customer/colleague. This is a nudge, not a block — "
                "the send gate blocks the irreversible surface.")
        emit_context("PostToolUse", f"{head}\n{body}\n{tail}{note}")
        return

    # ── EXTERNAL SEND → block on critical, nudge below ────────────────────────
    if not is_send_tool(tool):
        return
    try:
        text = "\n\n".join(harvest(tin))
    except Unscannable as e:  # D5b: too deep or too big to walk, so it doesn't go out unchecked
        deny_unscannable(str(e))
        return
    if len(text.strip()) < 3:
        return
    crit, soft, score, failures = analyze(text)
    note = _names_note()

    if failures:
        deny_unchecked(_causes(failures), crit, note)
        return

    if crit:
        emit_pre_deny(
            "AI-TELL GATE blocked this send — hard tells in the outgoing content:\n"
            + bullets(crit) + "\n\n"
            "Revise the content to cut these, then resend. (Block set = hard-ban words/phrases + "
            "critical announced-hedge/candor structures.) If the flagged text is a VERBATIM quote or "
            "was authored by the user to send as-is, tell the user it was gated and let them decide — "
            "don't silently rephrase their words." + note
        )
        return

    soft_flag = soft or (score >= 40 and len(text) > 200)
    if soft_flag:
        body = bullets(soft) if soft else f"  • generic AI-writing score {score}/100 (elevated)"
        emit_context(
            "PreToolUse",
            "AI-TELL NUDGE (send allowed): softer tells in the outgoing content — consider a quick "
            f"pass before it lands with a customer/colleague:\n{body}{note}",
        )
    elif note:  # a clean send goes out; the user still learns the names file wasn't read (D6c)
        emit_context("PreToolUse", "Send allowed." + note)
    return


def main():
    # Unreadable input: the tier can't be told, so exit 2, which Claude Code treats as blocking on
    # PreToolUse (the send doesn't happen) and shows to Claude on PostToolUse. Never a silent pass.
    try:
        hook_input = json.loads(sys.stdin.read())
        if not isinstance(hook_input, dict):
            raise ValueError("not a JSON object")
    except Exception as e:
        sys.stderr.write(f"Voice gate couldn't read its hook input ({type(e).__name__}: {e}), so it blocked "
                         "this call rather than let it through unchecked.\n")
        sys.exit(2)
    try:
        run(hook_input)
    except Exception as e:  # a bug in this hook must not turn into a pass (D1)
        cause = f"internal error {type(e).__name__}: {str(e)[:120]}"
        tool = hook_input.get("tool_name")
        if hook_input.get("hook_event_name") == "PostToolUse" or (isinstance(tool, str) and tool in FILE_TOOLS):
            tin = hook_input.get("tool_input")
            path = str(tin.get("file_path", "")) if isinstance(tin, dict) else ""
            warn_unchecked(path, [("hook", cause)])
        else:
            deny_unchecked(cause)


if __name__ == "__main__":
    main()
