import { randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupFile,
  sniffLogoType,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
type Tx = Prisma.TransactionClient;
type Row = Record<string, unknown>;
type Column = {
  name: string;
  udt: string;
  nullable: boolean;
  hasDefault: boolean;
};
type ForeignKey = {
  table: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
};

/** Tables that stay behind: people and access, secrets, the audit trail, and files that can be made again */
const LEFT_OUT = new Set([
  'memberships',
  'invitations',
  'api_keys',
  'webhook_endpoints',
  'webhook_deliveries',
  'approval_requests',
  'audit_logs',
  'report_deliveries',
]);
/** Organisation columns that belong to the new organisation, not the backup */
const OWN_ORG_COLUMNS = new Set([
  'id',
  'name',
  'slug',
  'status',
  'created_at',
  'updated_at',
]);
const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;
const refuse = (message: string, reason: string, extra: object = {}) =>
  new BadRequestException({ message, details: { reason, ...extra } });

/**
 * Backups: an organisation's books out as one JSON file, and back in as a new organisation. Tables, columns and
 * foreign keys come from the database's own catalogue, so new tables are included without changes here.
 * Restoring renews every id (in foreign keys, in id columns without one, and inside JSON), checks the file
 * holds together before writing, and writes it all in one transaction: posted entries are posted again into
 * open periods, then the periods closed as they were.
 */
@Injectable()
export class BackupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async catalogue(db: Tx | PrismaService) {
    const cols = await db.$queryRaw<
      {
        table_name: string;
        column_name: string;
        udt_name: string;
        is_nullable: string;
        column_default: string | null;
      }[]
    >`
      SELECT table_name, column_name, udt_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`;
    const columns = new Map<string, Column[]>();
    for (const c of cols) {
      const list = columns.get(c.table_name) ?? [];
      list.push({
        name: c.column_name,
        udt: c.udt_name,
        nullable: c.is_nullable === 'YES',
        hasDefault: c.column_default !== null,
      });
      columns.set(c.table_name, list);
    }
    const fks = await db.$queryRaw<
      { table: string; cols: string[]; ref_table: string; ref_cols: string[] }[]
    >`
      SELECT cl.relname AS "table", array_agg(att.attname::text ORDER BY u.ord) AS cols, fcl.relname AS ref_table, array_agg(fatt.attname::text ORDER BY u.ord) AS ref_cols
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_class fcl ON fcl.oid = con.confrelid
      JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS u(k, fk, ord) ON true
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.k
      JOIN pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = u.fk
      WHERE con.contype = 'f' AND cl.relnamespace = 'public'::regnamespace
      GROUP BY con.oid, cl.relname, fcl.relname`;
    const tables = [...columns.keys()].filter(
      (t) =>
        !LEFT_OUT.has(t) &&
        columns.get(t)!.some((c) => c.name === 'organization_id'),
    );
    const foreignKeys: ForeignKey[] = fks.map((f) => ({
      table: f.table,
      columns: f.cols,
      refTable: f.ref_table,
      refColumns: f.ref_cols,
    }));
    return { columns, tables, foreignKeys };
  }

  /** Each column as JSON can carry it: big numbers and decimals as text, bytes as base64, times as ISO text */
  private selectList(cols: Column[]) {
    return cols
      .map((c) =>
        ['int8', 'numeric'].includes(c.udt)
          ? `${q(c.name)}::text AS ${q(c.name)}`
          : c.udt === 'bytea'
            ? `encode(${q(c.name)}, 'base64') AS ${q(c.name)}`
            : q(c.name),
      )
      .join(', ');
  }

  async export(ctx: Ctx): Promise<BackupFile> {
    const organizationId = ctx.tenant.organizationId;
    const { columns, tables } = await this.catalogue(this.prisma);
    const out: BackupFile['tables'] = {};
    for (const t of tables.sort()) {
      const rows = await this.prisma.$queryRawUnsafe<{ r: Row }[]>(
        `SELECT to_jsonb(s) AS r FROM (SELECT ${this.selectList(columns.get(t)!)} FROM ${q(t)} WHERE organization_id = $1::uuid) s`,
        organizationId,
      );
      if (rows.length) out[t] = rows.map((x) => x.r);
    }
    const [org] = await this.prisma.$queryRawUnsafe<{ r: Row }[]>(
      `SELECT to_jsonb(s) AS r FROM (SELECT ${this.selectList(columns.get('organizations')!)} FROM organizations WHERE id = $1::uuid) s`,
      organizationId,
    );
    const organization = Object.fromEntries(
      Object.entries(org!.r).filter(
        ([k]) => !OWN_ORG_COLUMNS.has(k) || k === 'name',
      ),
    );
    await this.audit.record({
      action: 'org.backup.export',
      actorId: ctx.actor.userId,
      organizationId,
      entityType: 'organization',
      entityId: organizationId,
      after: {
        tables: Object.keys(out).length,
        rows: Object.values(out).reduce((s, r) => s + r.length, 0),
      },
      req: ctx.req,
    });
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      source: { organizationId, name: String(org!.r.name) },
      organization,
      tables: out,
    };
  }

  /** A parameter placeholder cast to its column's type */
  private placeholder(n: number, c: Column) {
    if (c.udt === 'bytea') return `decode($${n}, 'base64')`;
    const type = c.udt.startsWith('_')
      ? `${/^[a-z0-9_]+$/.test(c.udt.slice(1)) ? c.udt.slice(1) : q(c.udt.slice(1))}[]`
      : /^[a-z0-9_]+$/.test(c.udt)
        ? c.udt
        : q(c.udt);
    return `$${n}::${type}`;
  }
  private param(v: unknown, c: Column) {
    if (v === null || v === undefined) return null;
    if (c.udt === 'json' || c.udt === 'jsonb') return JSON.stringify(v);
    return v;
  }

  /** Checks the file against this database before anything is written; returns what it found to write */
  private check(
    b: BackupFile,
    cat: Awaited<ReturnType<BackupsService['catalogue']>>,
  ) {
    if (b.version > BACKUP_VERSION)
      throw refuse(
        'This backup comes from a newer LedgerNest. Update this one first.',
        'backup_too_new',
      );
    const problems: string[] = [];
    for (const [t, rows] of Object.entries(b.tables)) {
      const cols = cat.columns.get(t);
      if (!cols || !cat.tables.includes(t)) {
        problems.push(`Unknown table ${t}`);
        continue;
      }
      const known = new Set(cols.map((c) => c.name));
      for (const k of new Set(rows.flatMap((r) => Object.keys(r))))
        if (!known.has(k)) problems.push(`Unknown column ${t}.${k}`);
      for (const c of cols)
        if (
          !c.nullable &&
          !c.hasDefault &&
          rows.some((r) => r[c.name] === undefined)
        )
          problems.push(`Missing ${t}.${c.name}`);
    }
    // Every reference must lead to a row in the file (or to the organisation, or to a person)
    const ids = new Map(
      Object.entries(b.tables).map(([t, rows]) => [
        t,
        new Set(rows.map((r) => String(r.id))),
      ]),
    );
    for (const fk of cat.foreignKeys) {
      const rows = b.tables[fk.table];
      if (!rows || fk.refTable === 'organizations' || fk.refTable === 'users')
        continue;
      const col = fk.columns.find((c, i) => fk.refColumns[i] === 'id');
      if (!col) continue;
      const target = ids.get(fk.refTable);
      const dangling = rows.filter(
        (r) =>
          r[col] !== null &&
          r[col] !== undefined &&
          !target?.has(r[col] as string),
      );
      if (dangling.length)
        problems.push(
          `${dangling.length} row(s) in ${fk.table} point to missing ${fk.refTable}`,
        );
    }
    // Logos, signatures and seals must be the images they say they are, as an upload would be checked
    for (const t of ['organization_logos', 'organization_images'])
      for (const r of b.tables[t] ?? []) {
        const bytes =
          typeof r.data === 'string'
            ? Buffer.from(r.data, 'base64')
            : Buffer.alloc(0);
        const type = sniffLogoType(bytes);
        if (!type || type !== r.content_type)
          problems.push(
            `A row in ${t} isn’t the PNG, JPEG or WebP image it says it is`,
          );
      }
    // Posted entries balance
    const lines = b.tables.journal_lines ?? [];
    for (const e of (b.tables.journal_entries ?? []).filter(
      (x) => x.status === 'posted',
    )) {
      const mine = lines.filter((l) => l.entry_id === e.id);
      const dr = mine.reduce((s, l) => s + BigInt(String(l.debit)), 0n);
      const cr = mine.reduce((s, l) => s + BigInt(String(l.credit)), 0n);
      if (dr !== cr || mine.length < 2)
        problems.push(`Journal entry ${String(e.id)} doesn’t balance`);
    }
    if (problems.length)
      throw refuse(
        'This backup doesn’t hold together, so nothing was restored.',
        'backup_invalid',
        { problems: problems.slice(0, 20) },
      );
  }

  async restore(b: BackupFile, name: string | undefined, ctx: Ctx) {
    const cat = await this.catalogue(this.prisma);
    this.check(b, cat);
    const organizationId = randomUUID();
    const users = new Set(
      (await this.prisma.user.findMany({ select: { id: true } })).map(
        (u) => u.id,
      ),
    );
    // New ids for every row
    const idMap = new Map<string, string>();
    for (const rows of Object.values(b.tables))
      for (const r of rows)
        if (typeof r.id === 'string') idMap.set(r.id, randomUUID());
    idMap.set(b.source.organizationId, organizationId);
    const renew = (v: unknown): unknown =>
      typeof v === 'string'
        ? (idMap.get(v) ?? v)
        : Array.isArray(v)
          ? v.map(renew)
          : v && typeof v === 'object'
            ? Object.fromEntries(
                Object.entries(v).map(([k, x]) => [k, renew(x)]),
              )
            : v;
    const fkOf = new Map<string, ForeignKey[]>();
    for (const fk of cat.foreignKeys)
      fkOf.set(fk.table, [...(fkOf.get(fk.table) ?? []), fk]);
    const isUserColumn = (t: string, c: string) =>
      (fkOf.get(t) ?? []).some(
        (fk) => fk.refTable === 'users' && fk.columns.includes(c),
      );
    // A column's value in the new organisation
    const value = (t: string, col: Column, r: Row) => {
      const v = r[col.name];
      if (col.name === 'organization_id') return organizationId;
      if (v === null || v === undefined) return v ?? null;
      if (isUserColumn(t, col.name))
        return users.has(v as string) ? v : ctx.actor.userId;
      if (
        col.udt === 'uuid' ||
        col.udt === '_uuid' ||
        col.udt === 'json' ||
        col.udt === 'jsonb'
      )
        return renew(v);
      return v;
    };
    // Order: a table after those it can't be without; links that may be empty (or point back) are filled in afterwards
    // Links to the same table are always filled in afterwards; others only when needed to break a circle
    const present = Object.keys(b.tables).sort();
    const deferred = new Map<string, Set<string>>();
    const defer = (t: string, cs: string[]) =>
      deferred.set(t, new Set([...(deferred.get(t) ?? []), ...cs]));
    const needs = new Map<
      string,
      { table: string; columns: string[]; nullable: boolean }[]
    >(present.map((t) => [t, []]));
    for (const t of present) {
      const cols = cat.columns.get(t)!;
      for (const fk of fkOf.get(t) ?? []) {
        const own = fk.columns.filter((c) => c !== 'organization_id');
        if (fk.refTable === t) defer(t, own);
        else if (present.includes(fk.refTable))
          needs.get(t)!.push({
            table: fk.refTable,
            columns: own,
            nullable: own.every(
              (c) => cols.find((x) => x.name === c)?.nullable,
            ),
          });
      }
    }
    const order: string[] = [];
    const placed = new Set<string>();
    while (order.length < present.length) {
      const waiting = (t: string) =>
        needs.get(t)!.filter((n) => !placed.has(n.table));
      let next = present.find((t) => !placed.has(t) && !waiting(t).length);
      if (!next) {
        // A circle: break it where the links can be empty for now, deferring as few as possible
        next = present
          .filter((t) => !placed.has(t) && waiting(t).every((n) => n.nullable))
          .sort((x, y) => waiting(x).length - waiting(y).length)[0];
        if (!next)
          throw refuse(
            'The backup’s tables depend on each other in a circle.',
            'backup_invalid',
          );
        for (const n of waiting(next)) defer(next, n.columns);
      }
      order.push(next);
      placed.add(next);
    }
    const counts: Record<string, number> = {};
    await this.prisma.$transaction(
      async (tx) => {
        const orgCols = cat.columns
          .get('organizations')!
          .filter(
            (c) =>
              !OWN_ORG_COLUMNS.has(c.name) &&
              b.organization[c.name] !== undefined,
          );
        const slug = `restored-${organizationId.slice(0, 8)}`;
        await tx.$executeRawUnsafe(
          `INSERT INTO organizations (id, name, slug, updated_at${orgCols.map((c) => `, ${q(c.name)}`).join('')}) VALUES ($1::uuid, $2, $3, now()${orgCols.map((c, i) => `, ${this.placeholder(i + 4, c)}`).join('')})`,
          organizationId,
          name ?? `${b.source.name} (restored)`,
          slug,
          ...orgCols.map((c) => this.param(b.organization[c.name], c)),
        );
        await tx.membership.create({
          data: {
            organizationId,
            userId: ctx.actor.userId,
            builtInRole: 'owner',
          },
        });
        for (const t of order) {
          const rows = b.tables[t]!;
          const cols = cat.columns
            .get(t)!
            .filter(
              (c) =>
                rows.some((r) => r[c.name] !== undefined) ||
                c.name === 'organization_id',
            );
          const later = deferred.get(t) ?? new Set();
          for (let i = 0; i < rows.length; i += 200) {
            const chunk = rows.slice(i, i + 200);
            const params: unknown[] = [];
            const tuples = chunk.map((r) => {
              const cells = cols.map((c) => {
                let v = value(t, c, r);
                if (later.has(c.name)) v = null;
                // Entries go in as drafts and are posted once their lines are in; periods go in open
                if (t === 'journal_entries' && c.name === 'status') v = 'draft';
                if (t === 'periods' && c.name === 'status') v = 'open';
                if (
                  t === 'periods' &&
                  ['closed_at', 'closed_by_id'].includes(c.name)
                )
                  v = null;
                // Customer links belong to the original: the copy starts with none (and tokens are unique)
                if (t === 'invoices' && c.name === 'share_token') v = null;
                if (t === 'invoices' && c.name === 'share_views') v = 0;
                if (t === 'invoices' && c.name === 'share_viewed_at') v = null;
                if (t === 'contacts' && c.name === 'share_token') v = null;
                if (t === 'contacts' && c.name === 'share_views') v = 0;
                if (t === 'contacts' && c.name === 'share_viewed_at') v = null;
                if (t === 'quotes' && c.name === 'share_token') v = null;
                if (t === 'quotes' && c.name === 'share_views') v = 0;
                if (t === 'quotes' && c.name === 'share_viewed_at') v = null;
                // Balance confirmations keep their answers, but the copy's links are its own
                if (t === 'balance_confirmations' && c.name === 'token')
                  v = randomBytes(24).toString('base64url');
                params.push(this.param(v, c));
                return this.placeholder(params.length, c);
              });
              return `(${cells.join(', ')})`;
            });
            await tx.$executeRawUnsafe(
              `INSERT INTO ${q(t)} (${cols.map((c) => q(c.name)).join(', ')}) VALUES ${tuples.join(', ')}`,
              ...params,
            );
          }
          counts[t] = rows.length;
        }
        // The links left empty above
        for (const [t, columns] of deferred) {
          const cols = cat.columns.get(t)!.filter((c) => columns.has(c.name));
          for (const r of b.tables[t] ?? []) {
            const set = cols.filter(
              (c) => r[c.name] !== null && r[c.name] !== undefined,
            );
            if (!set.length) continue;
            await tx.$executeRawUnsafe(
              `UPDATE ${q(t)} SET ${set.map((c, i) => `${q(c.name)} = ${this.placeholder(i + 2, c)}`).join(', ')} WHERE id = $1::uuid`,
              idMap.get(String(r.id)),
              ...set.map((c) => this.param(value(t, c, r), c)),
            );
          }
        }
        // Posted entries posted again (every period is open for now), then the periods as they were
        for (const e of (b.tables.journal_entries ?? []).filter(
          (x) => x.status === 'posted',
        ))
          await tx.$executeRawUnsafe(
            `UPDATE journal_entries SET status = 'posted' WHERE id = $1::uuid`,
            idMap.get(String(e.id)),
          );
        const periodCols = cat.columns.get('periods')!;
        const closedBy = periodCols.find((c) => c.name === 'closed_by_id');
        for (const p of (b.tables.periods ?? []).filter(
          (x) => x.status !== 'open',
        ))
          await tx.$executeRawUnsafe(
            `UPDATE periods SET status = $2, closed_at = $3::timestamptz${closedBy ? ', closed_by_id = $4::uuid' : ''} WHERE id = $1::uuid`,
            idMap.get(String(p.id)),
            p.status,
            p.closed_at,
            ...(closedBy ? [value('periods', closedBy, p)] : []),
          );
        await this.audit.record(
          {
            action: 'org.backup.restore',
            actorId: ctx.actor.userId,
            organizationId,
            entityType: 'organization',
            entityId: organizationId,
            after: {
              from: b.source.name,
              exportedAt: b.exportedAt,
              rows: Object.values(counts).reduce((s, n) => s + n, 0),
            },
            req: ctx.req,
          },
          tx,
        );
      },
      { timeout: 300_000, maxWait: 10_000 },
    );
    await this.audit.record({
      action: 'org.backup.restore',
      actorId: ctx.actor.userId,
      organizationId: ctx.tenant.organizationId,
      entityType: 'organization',
      entityId: organizationId,
      after: { into: organizationId, from: b.source.name },
      req: ctx.req,
    });
    return {
      organizationId,
      name: name ?? `${b.source.name} (restored)`,
      rows: counts,
    };
  }
}
