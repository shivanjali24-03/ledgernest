import type { GstRegistrationInput } from '@ledgernest/shared';

/** Another GSTIN of the business, in another state */
export interface GstRegistration {
  id: string;
  gstin: string;
  stateCode: string;
  state: string | null;
  tradeName: string | null;
  address: Record<string, string | null> | null;
  archived: boolean;
}

export interface GstRegistrationsApi {
  list(): Promise<{ primary: { gstin: string; stateCode: string | null } | null; registrations: GstRegistration[] }>;
  create(input: GstRegistrationInput): Promise<GstRegistration>;
  archive(id: string): Promise<void>;
}
