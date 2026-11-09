import type { AttachableDocument, AttachmentType } from '@ledgernest/shared';

export interface Attachment {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
}

/** Files kept with invoices, bills, payments and bank transactions. Live and demo both implement it. */
export interface AttachmentsApi {
  list(documentType: AttachableDocument, documentId: string): Promise<Attachment[]>;
  add(documentType: AttachableDocument, documentId: string, file: { fileName: string; type: AttachmentType; data: string }): Promise<Attachment[]>;
  file(documentType: AttachableDocument, documentId: string, attachmentId: string, inline?: boolean): Promise<{ blob: Blob; filename: string }>;
  remove(documentType: AttachableDocument, documentId: string, attachmentId: string): Promise<void>;
}
