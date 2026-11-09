/** Indian GST: within the organisation's state CGST + SGST, otherwise IGST (the API switches the same way). */
export function supplyFor(orgState: string | null, placeOfSupply: string | null): 'intra' | 'inter' | null {
  return orgState && placeOfSupply ? (orgState === placeOfSupply ? 'intra' : 'inter') : null;
}

/** The group of the same GST slab for a kind of supply (GST 18% ↔ IGST 18%), or the group itself. */
export function groupForSupply<G extends { id: string; gstSlab?: { id: string } | null; gstSlabId?: string | null; supply: string | null; archived?: boolean }>(group: G, supply: 'intra' | 'inter' | null, groups: readonly G[]): G {
  const slab = group.gstSlab?.id ?? group.gstSlabId ?? null;
  if (!supply || !slab || group.supply === supply) return group;
  return groups.find((g) => (g.gstSlab?.id ?? g.gstSlabId) === slab && g.supply === supply && !g.archived) ?? group;
}
