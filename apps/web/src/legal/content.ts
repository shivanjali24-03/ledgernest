/**
 * The privacy notice and terms of use, written to describe what this software actually does. They are kept in
 * English (the language of record); the page says so to Hindi and Marathi readers. Whoever runs LedgerNest sets their
 * name and a contact address with VITE_OPERATOR_NAME and VITE_CONTACT_EMAIL, and should have them reviewed for their
 * own service before relying on them.
 */

export type LegalBlock = string | string[];
export interface LegalSection {
  heading: string;
  body: LegalBlock[];
}
export interface LegalDocument {
  updated: string;
  sections: LegalSection[];
}

export const operator = () => ((import.meta.env.VITE_OPERATOR_NAME as string | undefined)?.trim() || 'the organisation that runs this LedgerNest service');
export const contactEmail = () => (import.meta.env.VITE_CONTACT_EMAIL as string | undefined)?.trim() || null;

export function privacyNotice(): LegalDocument {
  const who = operator();
  const contact = contactEmail();
  return {
    updated: '10 November 2026',
    sections: [
      {
        heading: 'Who is responsible',
        body: [
          `This service is run by ${who}. For your own account (your name, email address and how you sign in), ${who} decides why and how it is used, and is the Data Fiduciary under India’s Digital Personal Data Protection Act, 2023.`,
          'For the books an organisation keeps here (its customers, vendors, invoices, bills, payments and bank lines), that organisation decides what is recorded and why. The service processes those records on its behalf.',
        ],
      },
      {
        heading: 'What is collected',
        body: [
          [
            'Your account: name, email address, preferred language, your password (stored only as an Argon2 hash, never as typed) and, if you turn on two-factor sign-in, its secret (encrypted) and your recovery codes (stored only as hashes).',
            'Sign-in records: when you signed in, the internet address and the browser and device it came from, so you can see where you are signed in and sign other devices out.',
            'What organisations enter: company details and GSTIN, customers’ and vendors’ names, addresses, GSTINs, phone numbers and email addresses, and the accounting documents themselves.',
            'An audit trail of changes (who did what, and when), which accounting records need.',
            'Emails sent from the service at your request (invoices, statements, reminders, confirmations): who they went to and when.',
          ],
        ],
      },
      {
        heading: 'Why it is used',
        body: [
          [
            'To provide the accounting service you signed up for.',
            'To keep accounts secure: sign-in, two-factor codes, lockout after repeated wrong passwords, and alerts about sessions.',
            'To send the documents and messages you ask it to send.',
            'To meet legal duties, such as keeping books of account.',
          ],
          'It is not used for advertising, it is not sold, and no tracking or analytics cookies are set.',
        ],
      },
      {
        heading: 'Links that open without signing in',
        body: [
          'When an organisation shares an invoice, a customer account or a balance confirmation, anyone with that link can see what it shows (for example, what is owed and the invoice PDF). The links are long random codes, are not listed by search engines, and the organisation can turn them off at any time.',
        ],
      },
      {
        heading: 'Who else handles it',
        body: [
          `${who} uses providers to host the service, store its database and send email. They handle data only to provide those services. Nothing is shared with anyone else unless the law requires it.`,
        ],
      },
      {
        heading: 'Cookies and storage in your browser',
        body: [
          'One cookie keeps you signed in (it cannot be read by scripts on the page). Your browser also keeps your language, theme and similar preferences, and, in the demo, the sample data you change.',
        ],
      },
      {
        heading: 'How long it is kept',
        body: [
          'Accounting records are kept while the organisation uses the service. Indian law generally requires books of account to be kept for at least eight years (and GST records for 72 months after the annual return is due), so organisations should keep exports or backups for that long.',
          'When an Owner deletes an organisation, its records are erased. When you delete your account, your name and email address are removed and you can no longer sign in; entries you made stay in the organisation’s books, credited to “Deleted user”, because the books must stay complete.',
        ],
      },
      {
        heading: 'Your rights',
        body: [
          [
            'See the personal data held about you, and correct it (your profile and settings).',
            'Have it erased (Delete my account), where the law doesn’t require it to be kept.',
            'Withdraw consent you gave, for example by turning off emails you asked for.',
            'Nominate someone to act for you, and have a grievance addressed.',
          ],
          contact ? `To use any of these, or to raise a grievance, write to ${contact}. You may also approach the Data Protection Board of India.` : `To use any of these, or to raise a grievance, contact ${who}. You may also approach the Data Protection Board of India.`,
        ],
      },
      {
        heading: 'Security',
        body: ['Passwords are hashed, two-factor sign-in is available (and Owners can require it), sessions can be ended from any device, access follows each person’s role, and changes are recorded. Use a strong password and turn on two-factor sign-in.'],
      },
      {
        heading: 'Children',
        body: ['The service is for businesses and is not meant for anyone under 18.'],
      },
      {
        heading: 'Changes',
        body: ['If this notice changes in a way that matters, the date above changes and signed-in users are told.'],
      },
    ],
  };
}

export function termsOfUse(): LegalDocument {
  const who = operator();
  const contact = contactEmail();
  return {
    updated: '10 November 2026',
    sections: [
      { heading: 'The service', body: [`LedgerNest is accounting software for small businesses, provided by ${who}. By signing in you agree to these terms.`] },
      {
        heading: 'Your books are yours',
        body: ['Each organisation owns what it records. You can take it out at any time: backups, CSV and Excel exports, PDFs and a Tally export. Deleting an organisation erases its records.'],
      },
      {
        heading: 'Tax and filing',
        body: [
          'The service prepares returns and files to upload (GSTR-1, GSTR-3B figures, GSTR-2B matching, e-invoice and e-way bill JSON, TDS figures) from what you record, using the rules as they stood when it was built. It does not file anything with the government for you. Check figures before filing, and ask a professional where you are unsure; due dates and rates can be changed by notification.',
        ],
      },
      {
        heading: 'Your account',
        body: ['Keep your password to yourself, use two-factor sign-in, and tell your organisation’s Owner if you think someone else has signed in as you. Owners and Admins decide who in their organisation can see and do what.'],
      },
      {
        heading: 'Fair use',
        body: [['Don’t use the service to break the law, to send unwanted messages, or to try to reach other organisations’ data.', 'Don’t try to disrupt or overload the service, or get around its limits and security.']],
      },
      {
        heading: 'Availability',
        body: ['The service is offered as it is. Care is taken to keep it running and your data safe, but it can’t be promised to be free of interruptions or errors. Keep your own backups.'],
      },
      {
        heading: 'Liability',
        body: [`As far as the law allows, ${who} is not liable for indirect losses, lost profits or penalties that come from how the service is used, including returns filed from its figures.`],
      },
      {
        heading: 'Law',
        body: ['These terms are governed by the laws of India.'],
      },
      {
        heading: 'Contact',
        body: [contact ? `Questions about these terms: ${contact}.` : `Questions about these terms: contact ${who}.`],
      },
    ],
  };
}
