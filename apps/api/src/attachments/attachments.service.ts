import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ATTACHMENT_AUDIT_PREFIX,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_PERMISSIONS,
  MAX_ATTACHMENTS_PER_DOCUMENT,
  sniffAttachmentType,
  type AttachableDocument,
  type AttachmentType,
} from '@ledgernest/shared';
import type { Request } from 'express';
import type { Actor, Tenant } from '../access/types.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Ctx = { actor: Actor; tenant: Tenant; req: Request };
const refuse = (
  Ex: typeof ConflictException | typeof BadRequestException,
  message: string,
  reason: string,
) => new Ex({ message, details: { reason } });

/**
 * Receipts and PDFs kept with invoices, bills, payments and bank transactions. Seeing them needs the document's
 * view permission and changing them its manage one; the bytes must be the type the file claims.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private allowed(
    tenant: Tenant,
    documentType: AttachableDocument,
    need: 'view' | 'manage',
  ) {
    const p = ATTACHMENT_PERMISSIONS[documentType][need];
    if (!tenant.permissions.has(p))
      throw new ForbiddenException({
        message: 'You don’t have permission to do that.',
        details: { missing: [p] },
      });
  }

  /** The document must be the organisation's own */
  private async document(
    organizationId: string,
    documentType: AttachableDocument,
    documentId: string,
  ) {
    const where = { organizationId, id: documentId };
    const found =
      documentType === 'invoice'
        ? await this.prisma.invoice.findFirst({ where, select: { id: true } })
        : documentType === 'bill'
          ? await this.prisma.bill.findFirst({ where, select: { id: true } })
          : documentType === 'payment'
            ? await this.prisma.payment.findFirst({
                where,
                select: { id: true },
              })
            : await this.prisma.bankTransaction.findFirst({
                where,
                select: { id: true },
              });
    if (!found) throw new NotFoundException('That document doesn’t exist.');
  }

  async list(
    tenant: Tenant,
    documentType: AttachableDocument,
    documentId: string,
  ) {
    this.allowed(tenant, documentType, 'view');
    await this.document(tenant.organizationId, documentType, documentId);
    return this.prisma.documentAttachment.findMany({
      where: {
        organizationId: tenant.organizationId,
        documentType,
        documentId,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        size: true,
        createdAt: true,
      },
    });
  }

  async add(
    documentType: AttachableDocument,
    documentId: string,
    file: { fileName: string; type: AttachmentType; data: string },
    ctx: Ctx,
  ) {
    const organizationId = ctx.tenant.organizationId;
    this.allowed(ctx.tenant, documentType, 'manage');
    await this.document(organizationId, documentType, documentId);
    const bytes = Buffer.from(file.data, 'base64');
    if (!bytes.length || bytes.length > ATTACHMENT_MAX_BYTES)
      throw refuse(
        BadRequestException,
        'Attach a file under 2 MB.',
        'too_large',
      );
    if (sniffAttachmentType(bytes) !== file.type)
      throw refuse(
        BadRequestException,
        'That file isn’t the type it claims to be.',
        'type_mismatch',
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'attachments:' + documentId}))`;
      if (
        (await tx.documentAttachment.count({
          where: { organizationId, documentType, documentId },
        })) >= MAX_ATTACHMENTS_PER_DOCUMENT
      )
        throw refuse(
          ConflictException,
          `Keep it to ${MAX_ATTACHMENTS_PER_DOCUMENT} files per document.`,
          'too_many',
        );
      const a = await tx.documentAttachment.create({
        data: {
          organizationId,
          documentType,
          documentId,
          fileName: file.fileName,
          contentType: file.type,
          size: bytes.length,
          data: bytes,
          uploadedById: ctx.actor.userId,
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: `${ATTACHMENT_AUDIT_PREFIX[documentType]}.attach`,
          actorId: ctx.actor.userId,
          organizationId,
          entityType: documentType,
          entityId: documentId,
          after: {
            attachmentId: a.id,
            fileName: file.fileName,
            bytes: bytes.length,
          },
          req: ctx.req,
        },
        tx,
      );
    });
    return this.list(ctx.tenant, documentType, documentId);
  }

  async file(
    tenant: Tenant,
    documentType: AttachableDocument,
    documentId: string,
    attachmentId: string,
  ) {
    this.allowed(tenant, documentType, 'view');
    const a = await this.prisma.documentAttachment.findFirst({
      where: {
        organizationId: tenant.organizationId,
        documentType,
        documentId,
        id: attachmentId,
      },
      select: { fileName: true, contentType: true, data: true },
    });
    if (!a) throw new NotFoundException('Attachment not found.');
    return a;
  }

  async remove(
    documentType: AttachableDocument,
    documentId: string,
    attachmentId: string,
    ctx: Ctx,
  ) {
    const organizationId = ctx.tenant.organizationId;
    this.allowed(ctx.tenant, documentType, 'manage');
    const a = await this.prisma.documentAttachment.findFirst({
      where: { organizationId, documentType, documentId, id: attachmentId },
      select: { id: true, fileName: true },
    });
    if (!a) throw new NotFoundException('Attachment not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.documentAttachment.delete({ where: { id: a.id } });
      await this.audit.record(
        {
          action: `${ATTACHMENT_AUDIT_PREFIX[documentType]}.detach`,
          actorId: ctx.actor.userId,
          organizationId,
          entityType: documentType,
          entityId: documentId,
          before: { attachmentId: a.id, fileName: a.fileName },
          req: ctx.req,
        },
        tx,
      );
    });
  }
}
