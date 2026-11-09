-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_custom_role_id_fkey" FOREIGN KEY ("custom_role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
