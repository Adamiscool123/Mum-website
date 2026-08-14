/* Transactional email via Cloudflare Email Service.
   Fails soft: if the binding is missing (local dev) or the send errors,
   we log and carry on — email must never break a paid booking. */

import { utcIsoToLocalHHMM } from './time.js';

const FROM = { email: 'bookings@areumwellness.com', name: 'AREUM Wellness London' };
const REPLY_TO = 'contact@areumwellness.com';
const ADDRESS = '69 Kensington Church Street, London W8 4BG';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function niceDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London',
  });
}

/** Shared shell so every email looks like the brand. */
function shell(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F7F3EB;">
<div style="max-width:520px;margin:0 auto;padding:32px 20px;font-family:Georgia,'Times New Roman',serif;color:#1E1B16;">
  <div style="text-align:center;padding:26px 0 22px;background:#0B0A09;border-radius:14px 14px 0 0;">
    <div style="color:#F4EFE6;font-size:22px;letter-spacing:0.35em;">AREUM</div>
    <div style="color:#B3935F;font-size:10px;letter-spacing:0.3em;margin-top:6px;">WELLNESS LONDON</div>
  </div>
  <div style="background:#FFFFFF;border:1px solid rgba(30,27,22,0.1);border-top:0;border-radius:0 0 14px 14px;padding:30px 28px;">
    <h1 style="font-size:22px;font-weight:normal;margin:0 0 16px;">${title}</h1>
    ${bodyHtml}
    <p style="font-size:12px;color:#6E655A;margin:26px 0 0;line-height:1.7;">
      AREUM Wellness London · ${ADDRESS}<br>
      Need to rearrange? Reply to this email or call the clinic — free cancellation up to 24 hours before your visit.
    </p>
  </div>
</div></body></html>`;
}

export async function sendEmail(env, ctx, message) {
  const doSend = async () => {
    if (!env.EMAIL) { console.log('EMAIL binding absent — would send:', message.subject, '→', message.to); return; }
    try {
      await env.EMAIL.send({ from: FROM, replyTo: REPLY_TO, ...message });
    } catch (e) {
      console.log('Email send failed:', e.code || '', e.message);
    }
  };
  if (ctx && ctx.waitUntil) ctx.waitUntil(doSend()); else await doSend();
}

/* ---------- templates ---------- */

export function bookingConfirmationEmail(to, clientName, startsAtIso, itemNames, amountPence) {
  const date = niceDate(startsAtIso);
  const time = utcIsoToLocalHHMM(startsAtIso);
  const items = itemNames.join(', ');
  return {
    to,
    subject: 'Booking confirmed — ' + date + ' at ' + time,
    html: shell('Your booking is confirmed', `
      <p style="line-height:1.8;margin:0 0 14px;">Dear ${esc(clientName)},</p>
      <p style="line-height:1.8;margin:0 0 18px;">We look forward to welcoming you.</p>
      <table style="width:100%;font-size:15px;line-height:2;">
        <tr><td style="color:#6E655A;">Treatments</td><td align="right">${esc(items)}</td></tr>
        <tr><td style="color:#6E655A;">Date</td><td align="right">${date}</td></tr>
        <tr><td style="color:#6E655A;">Time</td><td align="right">${time}</td></tr>
        <tr><td style="color:#6E655A;">Paid</td><td align="right">£${(amountPence / 100).toLocaleString('en-GB')}</td></tr>
        <tr><td style="color:#6E655A;">Where</td><td align="right">${ADDRESS}</td></tr>
      </table>
      <p style="line-height:1.8;margin:18px 0 0;">Please arrive a few minutes early. The clinic is a shoe-free space — see you soon.</p>`),
    text: `Dear ${clientName},\n\nYour booking is confirmed.\n\nTreatments: ${items}\nDate: ${date}\nTime: ${time}\nPaid: £${(amountPence / 100)}\nWhere: ${ADDRESS}\n\nNeed to rearrange? Reply to this email or call the clinic — free cancellation up to 24 hours before your visit.\n\nAREUM Wellness London`,
  };
}

export function bookingReminderEmail(to, clientName, startsAtIso, itemNames) {
  const date = niceDate(startsAtIso);
  const time = utcIsoToLocalHHMM(startsAtIso);
  return {
    to,
    subject: 'See you tomorrow at ' + time,
    html: shell('A gentle reminder', `
      <p style="line-height:1.8;margin:0 0 14px;">Dear ${esc(clientName)},</p>
      <p style="line-height:1.8;margin:0 0 14px;">Just a reminder of your visit tomorrow:</p>
      <table style="width:100%;font-size:15px;line-height:2;">
        <tr><td style="color:#6E655A;">Treatments</td><td align="right">${esc(itemNames.join(', '))}</td></tr>
        <tr><td style="color:#6E655A;">Date</td><td align="right">${date}</td></tr>
        <tr><td style="color:#6E655A;">Time</td><td align="right">${time}</td></tr>
        <tr><td style="color:#6E655A;">Where</td><td align="right">${ADDRESS}</td></tr>
      </table>
      <p style="line-height:1.8;margin:18px 0 0;">Drink plenty of water beforehand and allow a few minutes to settle in.</p>`),
    text: `Dear ${clientName},\n\nA reminder of your visit tomorrow.\n\nTreatments: ${itemNames.join(', ')}\nDate: ${date}\nTime: ${time}\nWhere: ${ADDRESS}\n\nAREUM Wellness London`,
  };
}

export function membershipWelcomeEmail(to, clientName, tierName, sessionsPerMonth, pricePence) {
  return {
    to,
    subject: 'Welcome to AREUM — your ' + tierName + ' membership is active',
    html: shell('Welcome to AREUM', `
      <p style="line-height:1.8;margin:0 0 14px;">Dear ${esc(clientName)},</p>
      <p style="line-height:1.8;margin:0 0 18px;">Your <strong>${esc(tierName)}</strong> membership is now active.</p>
      <table style="width:100%;font-size:15px;line-height:2;">
        <tr><td style="color:#6E655A;">Includes</td><td align="right">${sessionsPerMonth} Essential IV${sessionsPerMonth > 1 ? 's' : ''} + ${sessionsPerMonth} injection${sessionsPerMonth > 1 ? 's' : ''} every month</td></tr>
        <tr><td style="color:#6E655A;">Monthly</td><td align="right">£${(pricePence / 100).toLocaleString('en-GB')}</td></tr>
      </table>
      <p style="line-height:1.8;margin:18px 0 0;">Book your visits any time on our website or with the clinic — your sessions are waiting.</p>`),
    text: `Dear ${clientName},\n\nYour ${tierName} membership is now active — ${sessionsPerMonth} Essential IV${sessionsPerMonth > 1 ? 's' : ''} + ${sessionsPerMonth} injection${sessionsPerMonth > 1 ? 's' : ''} every month.\n\nBook your visits any time on our website or with the clinic.\n\nAREUM Wellness London`,
  };
}

export function packageConfirmationEmail(to, clientName, packageName, sessionsTotal, expiresMonths) {
  return {
    to,
    subject: 'Your programme is ready — ' + packageName,
    html: shell('Your programme is ready', `
      <p style="line-height:1.8;margin:0 0 14px;">Dear ${esc(clientName)},</p>
      <p style="line-height:1.8;margin:0 0 18px;">Thank you — your purchase is confirmed.</p>
      <table style="width:100%;font-size:15px;line-height:2;">
        <tr><td style="color:#6E655A;">Programme</td><td align="right">${esc(packageName)}</td></tr>
        <tr><td style="color:#6E655A;">Sessions</td><td align="right">${sessionsTotal}</td></tr>
        <tr><td style="color:#6E655A;">Valid for</td><td align="right">${expiresMonths} months</td></tr>
      </table>
      <p style="line-height:1.8;margin:18px 0 0;">Book each session whenever suits you — online or with the clinic.</p>`),
    text: `Dear ${clientName},\n\nYour purchase is confirmed.\n\nProgramme: ${packageName}\nSessions: ${sessionsTotal}\nValid for: ${expiresMonths} months\n\nBook each session whenever suits you — online or with the clinic.\n\nAREUM Wellness London`,
  };
}
