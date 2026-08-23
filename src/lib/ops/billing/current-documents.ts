export type BillingDocumentVersion = {
  id: string;
  document_type: string;
  revision: number;
  status: string;
  created_at: string;
};

function isNewer(left: BillingDocumentVersion, right: BillingDocumentVersion) {
  if (left.revision !== right.revision) return left.revision > right.revision;
  const leftCreated = Date.parse(left.created_at) || 0;
  const rightCreated = Date.parse(right.created_at) || 0;
  if (leftCreated !== rightCreated) return leftCreated > rightCreated;
  return left.id > right.id;
}

export function selectCurrentBillingDocuments<T extends BillingDocumentVersion>(documents: T[]) {
  const currentByType = new Map<string, T>();
  for (const document of documents) {
    const current = currentByType.get(document.document_type);
    if (!current || isNewer(document, current)) currentByType.set(document.document_type, document);
  }
  return [...currentByType.values()].sort((left, right) => {
    const createdDifference = (Date.parse(right.created_at) || 0) - (Date.parse(left.created_at) || 0);
    if (createdDifference) return createdDifference;
    return right.revision - left.revision;
  });
}
