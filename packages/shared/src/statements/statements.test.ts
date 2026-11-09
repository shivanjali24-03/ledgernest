import { describe, expect, it } from 'vitest';
import { guessMapping, parseCsv, parseStatementAmount, parseStatementDate, statementFingerprints, statementFromCsv, statementFromOfx } from './index.js';

describe('reading bank statements', () => {
  it('splits CSV with quotes, doubled quotes, newlines in quotes and CRLF', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,"two\nlines",3\n', ',')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', 'two\nlines', '3'],
    ]);
  });
  it('reads dates however the bank writes them', () => {
    expect(parseStatementDate('04/05/2026', 'DMY')).toBe('2026-05-04');
    expect(parseStatementDate('04/05/2026', 'MDY')).toBe('2026-04-05');
    expect(parseStatementDate('4-May-26', 'DMY')).toBe('2026-05-04');
    expect(parseStatementDate('May 4, 2026', 'DMY')).toBe('2026-05-04');
    expect(parseStatementDate('2026-05-04T10:32:00', 'DMY')).toBe('2026-05-04');
    expect(parseStatementDate('04.05.2026 10:32', 'DMY')).toBe('2026-05-04');
    expect(parseStatementDate('20260504', 'DMY')).toBe('2026-05-04');
    expect(parseStatementDate('31/02/2026', 'DMY')).toBeNull();
    expect(parseStatementDate('Opening balance', 'DMY')).toBeNull();
  });
  it('reads amounts with separators, signs, brackets and Dr/Cr', () => {
    expect(parseStatementAmount('1,234.56', '.', 2)).toBe(123_456);
    expect(parseStatementAmount('1.234,56', ',', 2)).toBe(123_456);
    expect(parseStatementAmount('(1,234.56)', '.', 2)).toBe(-123_456);
    expect(parseStatementAmount('-12.5', '.', 2)).toBe(-1_250);
    expect(parseStatementAmount('₹ 2,500.00 Dr', '.', 2)).toBe(-250_000);
    expect(parseStatementAmount('2500 CR', '.', 2)).toBe(250_000);
    expect(parseStatementAmount('1 000', '.', 0)).toBe(1_000);
    expect(parseStatementAmount('12.345', '.', 2)).toBeNull();
    expect(parseStatementAmount('', '.', 2)).toBeNull();
  });
  it('finds the header under the bank’s preamble and reads an Indian bank statement', () => {
    const csv = [
      'HDFC BANK Ltd.,,,,,,',
      'Account No: 50100123456789,,,,,,',
      'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
      '04/05/26,UPI-SHARMA OFFICE SUPPLIES,000412,04/05/26,"5,900.00",,"2,10,100.00"',
      '06/05/26,NEFT CR-KUMAR LOGISTICS,UTR402918,06/05/26,,"1,18,000.00","3,28,100.00"',
      '06/05/26,NEFT CR-KUMAR LOGISTICS,UTR402918,06/05/26,,"1,18,000.00","4,46,100.00"',
      ',,,,,,',
      'Closing balance,,,,,,"4,46,100.00"',
    ].join('\n');
    const m = guessMapping(csv)!;
    expect(m).toMatchObject({ headerRows: 3, date: 0, description: 1, reference: 2, moneyOut: 4, moneyIn: 5, balance: 6, amount: null, dateFormat: 'DMY', decimal: '.' });
    const { lines, issues } = statementFromCsv(csv, m, 2);
    expect(lines.map((l) => [l.row, l.date, l.amount, l.reference])).toEqual([
      [4, '2026-05-04', -590_000, '000412'],
      [5, '2026-05-06', 11_800_000, 'UTR402918'],
      [6, '2026-05-06', 11_800_000, 'UTR402918'],
    ]);
    expect(lines[0]!.balance).toBe(21_010_000);
    // The footer has no date but a balance only: not a transaction, not an error
    expect(issues).toEqual([]);
    // Two identical lines on a day are two lines, and stay two on the next import
    expect(statementFingerprints(lines).slice(1)).toEqual(['2026-05-06|11800000|neft cr-kumar logistics|1', '2026-05-06|11800000|neft cr-kumar logistics|2']);
  });
  it('reads a European statement with semicolons, decimal commas and one signed amount', () => {
    const csv = 'Buchungstag;Verwendungszweck;Betrag\n02.05.2026;Miete Mai;-1.250,00\n15.05.2026;Zinsen;3,17\nkaputt;Fehler;12,00\n';
    const m = guessMapping(csv)!;
    expect(m).toMatchObject({ delimiter: ';', amount: 2, decimal: ',', dateFormat: 'DMY' });
    const { lines, issues } = statementFromCsv(csv, m, 2);
    expect(lines.map((l) => [l.date, l.amount])).toEqual([
      ['2026-05-02', -125_000],
      ['2026-05-15', 317],
    ]);
    expect(issues).toEqual([{ row: 4, problem: 'date', text: 'kaputt' }]);
  });
  it('reads OFX, keeping the bank’s transaction ids', () => {
    const ofx = `OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260510120000[-5:EST]<TRNAMT>-25.00<FITID>2026051001<NAME>WIRE FEE<MEMO>Outgoing wire</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260520<TRNAMT>500.00<FITID>2026052002<NAME>NORTHWIND INC</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const { lines } = statementFromOfx(ofx, 2);
    expect(lines.map((l) => [l.date, l.amount, l.description, l.fitId])).toEqual([
      ['2026-05-10', -2_500, 'WIRE FEE · Outgoing wire', '2026051001'],
      ['2026-05-20', 50_000, 'NORTHWIND INC', '2026052002'],
    ]);
    expect(statementFingerprints(lines)).toEqual(['fit:2026051001', 'fit:2026052002']);
  });
});
