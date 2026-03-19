type GroupReceiptAccess = {
  isCurrentGroupMember: boolean;
};

type PaymentProofAccess = {
  viewerUserId: string;
  bookerUserId: string | null;
  memberUserId: string;
};

export function canViewGroupReceipt({ isCurrentGroupMember }: GroupReceiptAccess) {
  return isCurrentGroupMember;
}

export function canViewPaymentProof({
  viewerUserId,
  bookerUserId,
  memberUserId,
}: PaymentProofAccess) {
  return viewerUserId === memberUserId || viewerUserId === bookerUserId;
}
